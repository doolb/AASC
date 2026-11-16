#!/usr/bin/env python3
"""只搜索可见的笼外猪；每个阶段都保留图片、OCR 和动作证据。"""
import json
import math
from pathlib import Path
import shutil
import time

import cv2


def read_counters(app, image, cages, output, options):
    """每个笼体局部 OCR；重叠笼体可在同一裁剪中包含多个独立计数。"""
    if options is None:
        raise ValueError('铁笼计数需要启用 OCR')
    output.mkdir(parents=True, exist_ok=True)
    counters = []
    for index, cage in enumerate(cages, 1):
        crop, rect = app.ocr.crop_image(image, cage['bbox'])
        payload = app.ocr.request_crop(crop, output / f'cage-{index:02d}.png', options)
        numbers = []
        for box in payload.get('boxes', []):
            number = app.ocr.recognized_number(dict(payload, boxes=[box]), 'number')
            if number is not None and number['value'] > 0:
                numbers.append(number)
        attempts = []
        if not numbers:
            # 整个笼体中的栏杆可能干扰 OCR；按数字黑边再定位更小局部后重试。
            for number_index, box in enumerate(app.cage_vision.counter_boxes(image, cage), 1):
                small, small_rect = app.ocr.crop_image(image, box, max(3, round(6 * image.shape[1] / 530)))
                result = app.ocr.request_crop(small, output / f'cage-{index:02d}-number-{number_index:02d}.png', options)
                number = app.ocr.recognized_number(result, 'number')
                attempts.append({'bbox': small_rect, 'result': result, 'recognized': number})
                if number is not None and number['value'] > 0:
                    numbers.append(number)
        app.player.write_json(output / f'cage-{index:02d}.json',
                              {'bbox': rect, 'result': payload, 'recognized': numbers, 'local_attempts': attempts})
        if not numbers:
            raise ValueError('铁笼计数无法可靠识别，保留现场')
        counters.extend(number['value'] for number in numbers)
    return sorted(counters)


def exclude_lock_yellow(app, yellow, image, output, grid):
    """已确认的数字锁标（counters/locks）本身带黄色底色，将其从黄色鸭子候选排除。"""
    if not yellow:
        return yellow, []
    lock_boxes = []
    for ocr_dir in (output / 'ocr', output.parent / 'ocr'):
        res_file = ocr_dir / 'result.json'
        if res_file.exists():
            try:
                data = json.loads(res_file.read_text(encoding='utf-8'))
                for item in data.get('locks', []):
                    if 'bbox' in item:
                        lock_boxes.append(item['bbox'])
            except Exception:
                pass
        for cage_file in ocr_dir.glob('cage-*.json'):
            try:
                data = json.loads(cage_file.read_text(encoding='utf-8'))
                if 'bbox' in data:
                    lock_boxes.append(data['bbox'])
            except Exception:
                pass

    cell_pixels = grid[2] if isinstance(grid, (list, tuple)) and len(grid) >= 3 else 30.0
    tol = max(2.0, float(cell_pixels) * 1.5)

    kept, excluded = [], []
    for candidate in yellow:
        cx, cy = candidate['center']
        near_ocr = any(math.hypot(cx - (bx + bw / 2.0), cy - (by + bh / 2.0)) < tol for bx, by, bw, bh in lock_boxes)
        looks_lock = bool(hasattr(app, 'ocr') and hasattr(app.ocr, 'looks_like_lock') and app.ocr.looks_like_lock(image, candidate))
        if near_ocr or looks_lock:
            excluded.append(candidate)
        else:
            kept.append(candidate)
    return kept, excluded


def prepare(app, image, board, output, options, frames=()):
    """先定位铁笼并裁剪计数；笼内未知猪不参与点击搜索。"""
    pig_cage = app.cage_vision
    cages = pig_cage.detect(image, board)
    if not cages:
        raise ValueError('当前未识别到铁笼')
    counters = read_counters(app, image, cages, output / 'ocr', options)
    raw, _, _ = app.player.extract.identify(image, board)
    raw = [p for p in raw if not any(pig_cage.contains(c, p['center']) for c in cages)]
    # 遮挡和动画可能让单帧头部像素不足；多帧同一位置方向一致时补全。
    for pig in (p for p in raw if p['direction'] == 'unknown'):
        votes = []
        for frame in frames:
            other_cages = pig_cage.detect(frame, board)
            observed, _, _ = app.player.extract.identify(frame, board)
            candidates = [p for p in observed if not any(pig_cage.contains(c, p['center']) for c in other_cages)
                          and math.dist(p['center'], pig['center']) < 10.5 and p['direction'] != 'unknown']
            if len(candidates) == 1:
                votes.append(candidates[0]['direction'])
        if len(votes) >= 2 and len(set(votes)) == 1:
            pig['direction'] = votes[0]
            pig['direction_source'] = 'cage_outside_multiframe'
    grid = app.auto.infer_grid(raw, image.shape[1::-1])
    raw = app.player.with_grid(raw, grid)
    cage_cells = pig_cage.cells(cages, grid)
    if not cage_cells:
        raise ValueError('铁笼占格为空')
    unknown = [p for p in raw if p['direction'] == 'unknown']
    pigs = [p for p in raw if p['direction'] != 'unknown']
    static = {tuple(cell) for p in unknown for cell in p['grid']['cells']}
    occupied = {tuple(cell) for p in pigs for cell in p['grid']['cells']}
    if occupied & cage_cells or static & cage_cells:
        raise ValueError('铁笼轮廓与笼外猪占格冲突')
    yellow = app.auto.find_yellow_ducks(image, board)
    yellow = [p for p in yellow if not any(pig_cage.contains(c, p['center']) for c in cages)]
    yellow, excluded_locks = exclude_lock_yellow(app, yellow, image, output, grid)
    if excluded_locks:
        # 锁标可能遮住整只猪；仅排除黄色候选会让搜索把真实阻挡当成空格。
        # 在支持可靠重建锁猪占格及倒计时前，保留证据并停止。
        app.player.write_json(output / 'cage-lock-candidates.json', {'candidates': excluded_locks})
        raise ValueError('铁笼关卡含未建模锁猪候选，保留现场等待复核')
    yellow, _ = app.filter_yellow_candidates(yellow, grid, raw)
    # 笼外小黄鸭按已验证规则参与求解：转换为网格格子并传入搜索器。
    duck_grid_cells = []
    if yellow:
        try:
            duck_grid_cells = [list(cell) for cell in sorted(app.duck_cells(yellow, grid))]
        except ValueError as error:
            raise ValueError(f'铁笼关卡笼外鸭子网格位置异常: {error}') from error
        app.player.write_json(output / 'cage-ducks.json', {'ducks': duck_grid_cells, 'candidates': yellow})
        print(f'铁笼阶段：识别到 {len(duck_grid_cells)} 只笼外小黄鸭，格子 {duck_grid_cells}', flush=True)
    markers = app.small_blue_markers(image, board)
    if any(not any(pig_cage.contains(c, (x + w/2, y + h/2)) for c in cages) for x, y, w, h in markers):
        raise ValueError('铁笼关卡混合蓝色特殊物件，需复核')
    data = {'grid': list(grid), 'board': list(board), 'pigs': pigs, 'locks': {},
            'ducks': duck_grid_cells,
            'blockers': [list(c) for c in sorted(cage_cells | static)],
            'cage_cells': [list(c) for c in sorted(cage_cells)], 'cage_unknown': unknown,
            'cage_counters': counters}
    app.player.write_json(output / 'cage-layout.json', {'cages': [pig_cage.public(c) for c in cages],
                          'unknown': unknown, **data})
    return data, counters[0]


def confirm_open(app, executor, adapter, data, action, board, output, wait, options):
    """计数为一时点击已验证的离场猪，确认笼体消失和笼外位置再继续。"""
    pigs, grid = data['pigs'], data['grid']
    state, directions = app.player.solver.prepare(pigs, grid[3], grid[4])
    state = list(state)
    image = adapter.capture()
    matched = executor.match_cage_frame(image, board, pigs, state, directions, grid,
                                        data['cage_cells'], data['cage_unknown'])
    target = matched.get(tuple(action['from'])) if matched else None
    if target is None or not action['exited']:
        raise ValueError('开笼动作与当前棋盘不一致')
    app.save_or_error(output / 'before-open.png', image)
    app.player.write_json(output / 'open-pending.json', {'action': action, 'center': target['center']})
    adapter.click(target['center'], image.shape[1::-1])
    state[action['index']] = None
    time.sleep(wait)
    stable = 0
    old_cells = {tuple(cell) for cell in data['cage_cells']}
    for _ in range(80):
        image = adapter.capture()
        current_cages = app.cage_vision.detect(image, board)
        current_cells = app.cage_vision.cells(current_cages, grid)
        if app.auto.ui_state(image) != 'unknown' or not current_cells < old_cells:
            stable = 0
            time.sleep(.5)
            continue
        observed, _, _ = app.player.extract.identify(image, board)
        selected = []
        available = list(observed)
        for index, pos in enumerate(state):
            if pos is None:
                continue
            pig = pigs[index]
            horizontal = directions[index] in ('east', 'west')
            half = (pig.get('length', 2) - 1) / 2
            center = (grid[0] + (pos[0] + (half if horizontal else 0))*grid[2],
                      grid[1] + (pos[1] + (0 if horizontal else half))*grid[2])
            candidates = [p for p in available if math.dist(p['center'], center) < grid[2]*.4]
            if len(candidates) != 1:
                selected = []
                break
            selected.append(candidates[0])
            available.remove(candidates[0])
        try:
            matched = app.player.match_expected(selected, state, directions, grid,
                                                 [p.get('length', 2) for p in pigs]) if selected or not any(state) else None
        except ValueError:
            matched = None
        if matched is not None and all(sum(math.dist(p['center'], u['center']) < grid[2]*.3 for p in available) == 1
                                       for u in data['cage_unknown']):
            stable += 1
            if stable >= 2:
                expected = sorted(value - 1 for value in data['cage_counters'] if value > 1)
                actual = read_counters(app, image, current_cages, output / 'ocr-after-open', options) if current_cages else []
                if actual != expected:
                    raise ValueError('开笼后其余铁笼计数与预期不一致')
                app.save_or_error(output / 'after-open.png', image)
                app.player.write_json(output / 'open-confirmed.json', {'action': action, 'status': 'confirmed'})
                return image
        else:
            stable = 0
        time.sleep(.5)
    app.save_or_error(output / 'open-unconfirmed.png', image)
    raise ValueError('开笼或笼外位置未能确认，保留待确认动作')


def run(app, adapter, image, board, output, options, wait=1.5, level=None, avoid_center=None):
    """有限次执行已重放的笼外阶段；计数归零前重新识别。"""
    executor = app.locked_candidate.locked_module()
    expected_counters = None
    for stage in range(1, 101):
        stage_dir = output / f'cage-stage-{stage:03d}'
        stage_dir.mkdir()
        frames = [adapter.capture() for _ in range(4)]
        data, remaining = prepare(app, image, board, stage_dir, options, frames)
        if expected_counters is not None and data['cage_counters'] != expected_counters:
            raise ValueError('铁笼计数与已确认离场数不一致')
        state, directions = app.player.solver.prepare(data['pigs'], data['grid'][3], data['grid'][4])
        for _ in range(2):
            frame = adapter.capture()
            if executor.match_cage_frame(frame, board, data['pigs'], state, directions, data['grid'],
                                         data['cage_cells'], data['cage_unknown']) is None:
                raise ValueError('笼外棋盘多帧不一致')
        print(f'铁笼阶段 {stage}：剩余 {remaining}，笼外已知猪 {len(data["pigs"])}', flush=True)
        forbidden = None
        if avoid_center is not None:
            matches = [pig for pig in data['pigs'] if math.dist(pig['center'], avoid_center) < data['grid'][2]*.35]
            if len(matches) != 1:
                raise ValueError('上次未生效的目标无法唯一匹配')
            forbidden = matches[0]['id']
        target = max(1, min(remaining - 1, len(data['pigs'])))
        try:
            solution = app.locked_candidate.solve(data, allow_partial=True, forbid_first=forbidden, target_exits=target)
        except ValueError:
            if target == 1:
                raise
            # 目标不可达或达到预算时，仍可返回已经独立验证的较短阶段。
            solution = app.locked_candidate.solve(data, allow_partial=True, forbid_first=forbidden, target_exits=1)
        prefix = []
        exits = 0
        for action in solution['actions']:
            # 避免在开笼动画中继续沿用旧棋盘；最后一只需单独核验。
            if action['exited'] and exits + 1 >= remaining:
                break
            prefix.append(action)
            exits += int(action['exited'])
        if not prefix:
            if remaining != 1 or not solution['actions'] or not solution['actions'][0]['exited']:
                raise ValueError('未找到可验证的开笼动作')
            image = confirm_open(app, executor, adapter, data, solution['actions'][0], board, stage_dir, wait, options)
            status, _ = app.run_level(adapter, output / 'after-cage-open', level, initial=image,
                                       wait_seconds=wait, ocr_options=options)
            if status == 'victory':
                victories = sorted((output / 'after-cage-open').rglob('victory.png'))
                if not victories:
                    raise ValueError('后续阶段报告胜利但缺少胜利截图')
                shutil.copyfile(victories[-1], output / 'victory.png')
            return status
        solution.update(actions=prefix, status='partial')
        try:
            status = executor.run(adapter, solution, board, stage_dir / 'play', wait=wait)
        except ValueError:
            # 只在整盘仍与点击前或点击后精确匹配时自动续接；不清楚则保留现场停止。
            result_path = stage_dir / 'play' / 'result.json'
            if not result_path.exists():
                raise
            import json
            result = json.loads(result_path.read_text(encoding='utf-8'))
            pending = result.get('pending_action')
            files = sorted((stage_dir / 'play').glob('action-*.json'))
            if pending is None or len(files) != result.get('confirmed'):
                raise
            current = adapter.capture()
            current_state, current_directions = app.player.solver.prepare(data['pigs'], data['grid'][3], data['grid'][4])
            current_state = list(current_state)
            confirmed_actions = [json.loads(file.read_text(encoding='utf-8'))['action'] for file in files]
            for action in confirmed_actions:
                current_state[action['index']] = tuple(action['to']) if action['to'] is not None else None
            before = executor.match_cage_frame(current, board, data['pigs'], current_state, current_directions,
                                               data['grid'], data['cage_cells'], data['cage_unknown'])
            following = list(current_state)
            action = pending['action']
            following[action['index']] = tuple(action['to']) if action['to'] is not None else None
            after = executor.match_cage_frame(current, board, data['pigs'], following, current_directions,
                                              data['grid'], data['cage_cells'], data['cage_unknown'])
            if (before is None) == (after is None):
                raise ValueError('待确认动作与当前画面均不能唯一对应')
            if after is not None:
                confirmed_actions.append(action)
                app.player.write_json(stage_dir / 'play' / f'action-{len(confirmed_actions):03d}.json', pending)
                avoid_center = None
                resolution = 'pending_action_confirmed'
            else:
                avoid_center = pending['observed_center']
                resolution = 'pending_action_not_applied'
            app.player.write_json(stage_dir / 'play' / 'reconciliation.json',
                                  {'status': resolution, 'confirmed': len(confirmed_actions), 'pending_action': pending})
            expected_counters = sorted(value - sum(int(a['exited']) for a in confirmed_actions)
                                       for value in data['cage_counters'])
            image = current
            continue
        if status != 'stage_complete':
            raise ValueError('铁笼阶段未确认完成')
        expected_counters = sorted(value - exits for value in data['cage_counters'])
        avoid_center = None
        image = cv2.imread(str(stage_dir / 'play' / 'stage-final.png'))
        if image is None:
            raise ValueError('铁笼阶段缺少结束画面')
    raise ValueError('铁笼阶段超过上限')
