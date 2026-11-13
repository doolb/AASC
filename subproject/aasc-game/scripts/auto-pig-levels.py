#!/usr/bin/env python3
"""按关采集、完整求解、记录有效步骤并在通关后进入下一关。"""
import argparse
import hashlib
import importlib.util
import json
import math
import random
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent

def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

player = load_module('pig_play_auto', 'play-pig-level.py')
auto = load_module('pig_auto_helpers', 'pig_level_auto.py')
fast = load_module('pig_fast_candidate', 'pig_fast_candidate.py')
# 覆盖已观察到的第二、三关棋盘；不能包含下方道具按钮。
player.extract.DEFAULT_BOARD = (74, 205, 391, 602)


def screen_point(image, x, y):
    return round(x * image.shape[1] / 530), round(y * image.shape[0] / 942)


def same_centers(first, second):
    """容忍动画带来的微小漂移，不依赖同列小猪的排序。"""
    if first is None or len(first) != len(second):
        return False
    remaining = list(second)
    for center in first:
        nearest = min(remaining, key=lambda value: math.dist(center, value))
        if math.dist(center, nearest) >= 10:
            return False
        remaining.remove(nearest)
    return True


def preserve_animal_guide(image, output):
    """双模板确认新动物说明后留证并停下，等待操作者先取证。"""
    if auto.ui_state(image) != 'animal_guide':
        raise ValueError('未确认新动物说明')
    output.mkdir(parents=True, exist_ok=True)
    path = output / 'animal-guide.png'
    if path.exists():
        raise ValueError('新动物说明证据已存在，禁止覆盖')
    save_or_error(path, image)
    player.write_json(output / 'result.json', {'status': 'new_animal_needs_review', 'screenshot': 'animal-guide.png'})


def transition_to_next(adapter, previous_header=None, evidence_dir=None):
    """只有确认成功标题和下一关按钮都存在，才进行一次浮层导航。"""
    image = None
    # 成功标题会缩放闪烁，单帧低分不代表没有成功界面；多帧等待仍严格要求双模板。
    for _ in range(12):
        image = adapter.capture()
        initial_state = auto.ui_state(image)
        if initial_state == 'victory':
            break
        if initial_state in ('reward', 'ranking'):
            if evidence_dir is None:
                raise ValueError('延迟通关弹窗需要证据目录，停止操作')
            evidence_dir.mkdir(parents=True, exist_ok=True)
            image = await_victory(adapter, evidence_dir)
            if image is None:
                raise ValueError('延迟通关弹窗未完成，停止切关')
            break
        time.sleep(0.4)
    else:
        raise ValueError('当前不是可确认的通关界面，不能点击下一关')
    adapter.click(screen_point(image, 265, 725), image.shape[1::-1])
    current = None
    stable = 0
    previous_candidates = None
    unchanged_victory = 0
    attempts = 1
    for _ in range(45):
        time.sleep(0.6)
        current = adapter.capture()
        state = auto.ui_state(current)
        if state == 'animal_guide':
            if evidence_dir is None:
                raise RuntimeError('新动物说明需要证据目录，停止操作')
            preserve_animal_guide(current, evidence_dir)
            raise RuntimeError('出现新动物说明，已留证并等待先观察新物件')
        if state in ('reward', 'ranking'):
            if evidence_dir is None:
                raise RuntimeError('延迟通关弹窗需要证据目录，停止操作')
            evidence_dir.mkdir(parents=True, exist_ok=True)
            current = await_victory(adapter, evidence_dir)
            if current is None:
                raise RuntimeError('延迟通关弹窗未完成，停止切关')
            state = 'victory'
        if state == 'victory':
            # 已观察到按钮动画期间首次点击可能未生效；连续确认相同浮层后有限重试。
            unchanged_victory += 1
            stable = 0
            if unchanged_victory >= 8 and attempts < 2:
                adapter.click(screen_point(current, 265, 725), current.shape[1::-1])
                attempts += 1
                unchanged_victory = 0
            continue
        unchanged_victory = 0
        if state != 'unknown':
            stable = 0
            continue
        if previous_header is not None and not header_changed(previous_header, current):
            stable = 0
            continue
        # 底部道具仅作为界面载入参考，绝不对其点击。
        if auto.ui_match(current, 'board_ready') < 0.9:
            stable = 0
            continue
        candidates, _, _ = player.extract.identify(current)
        if not candidates:
            stable = 0
            continue
        centers = sorted(tuple(pig['center']) for pig in candidates)
        if same_centers(previous_candidates, centers):
            stable += 1
        else:
            stable = 1
        previous_candidates = centers
        if stable < 3:
            continue
        return current
    if evidence_dir is not None and current is not None:
        # 已点击下一关但未能确认编号时保留现场，避免漏掉可能的初始布局。
        evidence_dir.mkdir(parents=True, exist_ok=True)
        save_or_error(evidence_dir / 'transition-unverified.png', current)
        player.write_json(evidence_dir / 'result.json', {'status': 'transition_unverified',
                          'screenshot': 'transition-unverified.png'})
    raise RuntimeError('下一关画面未能确认；不会重复点击')


def header_changed(previous, current):
    """比较关卡标题字符区域，防止把未切换的关卡当成新关保存。"""
    def white_mask(image):
        normalized = cv2.resize(image, (530, 942), interpolation=cv2.INTER_AREA)
        # 聚焦关卡编号数字，减少左右汉字及背景对变化检测的稀释。
        gray = cv2.cvtColor(normalized[98:122, 256:276], cv2.COLOR_BGR2GRAY)
        return gray > 210
    return float(np.mean(white_mask(previous) != white_mask(current))) > 0.08


def save_or_error(path, image):
    player.save_png(path, image)


def await_victory(adapter, output, retries=30):
    """等待并识别已观察的领奖和排名弹窗；未确认的画面不进行点击。"""
    screenshots = {'reward': 0, 'ranking': 0}
    latest = None
    for _ in range(retries):
        latest = adapter.capture()
        state = auto.ui_state(latest)
        if state == 'victory':
            save_or_error(output / 'victory.png', latest)
            return latest
        if state in screenshots:
            screenshots[state] += 1
            if screenshots[state] > 5:
                break
            save_or_error(output / f'{state}-{screenshots[state]:02d}.png', latest)
            point = (265, 770) if state == 'reward' else (265, 400)
            adapter.click(screen_point(latest, *point), latest.shape[1::-1])
        time.sleep(1.5 if state in screenshots else 0.8)
    return None


def duck_cells(ducks, grid):
    """把候选中心映射到单格，拒绝重复或超出网格的位置。"""
    x0, y0, step, columns, rows = grid
    positions = [(round((duck['center'][0] - x0) / step), round((duck['center'][1] - y0) / step)) for duck in ducks]
    if len(set(positions)) != len(positions) or any(not (0 <= x < columns and 0 <= y < rows) for x, y in positions):
        raise ValueError('鸭子网格位置重复或越界')
    return set(positions)


def filter_yellow_candidates(ducks, grid, pigs):
    """显式复核时排除网格外或与已识别猪重叠的黄色画面候选。"""
    occupied = {tuple(cell) for pig in pigs if pig.get('grid') for cell in pig['grid']['cells']}
    kept, excluded = [], []
    for duck in ducks:
        try:
            if duck_cells([duck], grid) & occupied:
                excluded.append(duck)
            else:
                kept.append(duck)
        except ValueError:
            excluded.append(duck)
    return kept, excluded


def stable_initial_with_retries(adapter, level, image, attempts=3):
    """丢弃不稳定帧组后重新采样，仍要求每组内全体位置及方向一致。"""
    last_error = None
    for attempt in range(attempts):
        try:
            first = image if attempt == 0 else adapter.capture()
            return player.stable_initial(adapter, level, first, samples=6)
        except ValueError as error:
            last_error = error
    raise ValueError('初始画面多组采样均不稳定：' + str(last_error))


def run_level(adapter, output, level, initial=None, max_states=100000, timeout=15.0, max_steps=300, wait_seconds=1.5, reviewed_layout=None, duck_auto=False, candidate_plan=None, filter_outside_yellow=False):
    """完成单关并记录资料；只有下一帧确认位置后才确认上一步。"""
    output.mkdir(parents=True, exist_ok=False)
    image = initial if initial is not None else adapter.capture()
    latest = image
    clicks = 0
    confirmed = []
    pending = None
    try:
        if auto.ui_state(image) == 'animal_guide':
            preserve_animal_guide(image, output)
            return 'new_animal_needs_review', image
        if reviewed_layout is not None:
            # 动画会使鸭子在单帧中漏检；须找到整幅布局匹配帧后才开始。
            reference = json.loads(Path(reviewed_layout).read_text(encoding='utf-8'))
            ref_grid = tuple(reference['grid'])
            ref_state, ref_directions = player.solver.prepare(reference['pigs'], ref_grid[3], ref_grid[4])
            ref_ducks = {tuple(cell) for cell in reference['ducks']}
            for attempt in range(12):
                if attempt:
                    time.sleep(0.5)
                    image = adapter.capture()
                    latest = image
                if auto.ui_state(image) != 'unknown':
                    continue
                # 已复核的非默认棋盘范围也用于逐帧核对，避免裁掉边缘小猪。
                temp_board = player.extract.valid_board(image, reference.get('board'))
                candidates, _, _ = player.extract.identify(image, temp_board)
                try:
                    matched = player.match_expected(candidates, ref_state, ref_directions, ref_grid,
                                                    [pig.get('length', 2) for pig in reference['pigs']])
                    current_yellow = auto.find_yellow_ducks(image, temp_board)
                    if filter_outside_yellow:
                        current_yellow, _ = filter_yellow_candidates(current_yellow, ref_grid, player.with_grid(candidates, ref_grid))
                    current_ducks = duck_cells(current_yellow, ref_grid)
                    if matched is not None and current_ducks == ref_ducks:
                        break
                except ValueError:
                    continue
            else:
                raise ValueError('连续画面均与人工复核布局不一致')
        save_or_error(output / 'original.png', image)
        board = player.extract.valid_board(image, reference.get('board') if reviewed_layout is not None else None)
        raw, _, warnings = player.extract.identify(image, board)
        ducks = auto.find_yellow_ducks(image, board)
        unknown_entities = auto.find_blue_elephants(image, board)
        if unknown_entities:
            warnings.append('发现蓝色大象候选，先按图像范围估计静态阻挡，真实范围及规则待验证')
        if ducks and reviewed_layout is None and not duck_auto:
            warnings.append('发现小黄鸭候选；逃跑与碰撞规则尚未确认，暂停自动操作')
        raw_grid = None
        try:
            raw_grid = ref_grid if reviewed_layout is not None else auto.infer_grid(raw, image.shape[1::-1])
            raw = player.with_grid(raw, raw_grid)
        except ValueError as error:
            warnings.append('初始网格待复核：' + str(error))
        excluded_yellow = []
        if (unknown_entities or filter_outside_yellow) and raw_grid:
            # 棋盘边缘的黄色装饰可能被识别为鸭子；网格外候选不能作为棋盘对象。
            ducks, excluded_yellow = filter_yellow_candidates(ducks, raw_grid, raw)
            if excluded_yellow:
                warnings.append('网格外或与已识别小猪重叠的黄色候选已排除')
        if unknown_entities and raw_grid:
            occupied = {tuple(cell) for pig in raw if pig.get('grid') for cell in pig['grid']['cells']}
            occupied.update(duck_cells(ducks, raw_grid))
            estimated, conflicts = auto.estimate_entity_blockers(unknown_entities, raw_grid, occupied)
            if conflicts:
                warnings.append('未知物件视觉框与已识别对象重叠，暂按已识别对象占格：' + str(conflicts))
        gestures = player.extract.find_gesture(image, board)
        level_data = {'level': level, 'status': 'candidates_unverified', 'image_size': [image.shape[1], image.shape[0]],
                      'original_sha256': hashlib.sha256((output / 'original.png').read_bytes()).hexdigest(),
                      'board': list(board), 'grid_parameters': list(raw_grid) if raw_grid else None,
                      'gesture_candidates': gestures, 'count': len(raw),
                      'other_entities': ducks + unknown_entities, 'excluded_yellow_candidates': excluded_yellow,
                      'unknown_directions': sum(pig['direction'] == 'unknown' for pig in raw),
                      'pigs': raw, 'warnings': warnings}
        player.write_json(output / 'level.json', level_data)
        marked = auto.mark_unknown_entities(auto.mark_ducks(player.extract.annotate(image, raw, board, gestures), ducks), unknown_entities, raw_grid)
        if not cv2.imwrite(str(output / 'annotated.png'), marked):
            raise OSError('无法保存方向标注图')
        if unknown_entities and raw_grid is None:
            save_or_error(output / 'result.png', image)
            player.write_json(output / 'result.json', {'status': 'unsupported_entity', 'level': level,
                              'clicks': 0, 'confirmed': 0, 'screenshot': 'result.png',
                              'reason': '检测到蓝色大象候选，阻挡范围与行为尚未确认'})
            return 'unsupported_entity', image
        if ducks and reviewed_layout is None and not duck_auto:
            save_or_error(output / 'result.png', image)
            player.write_json(output / 'result.json', {'status': 'unsupported_entity', 'level': level,
                              'clicks': 0, 'confirmed': 0, 'screenshot': 'result.png',
                              'reason': '检测到小黄鸭候选，尚未验证其逃跑及碰撞规则'})
            return 'unsupported_entity', image
        expected_ducks = set()
        if reviewed_layout is not None:
            # 显式提供人工复核布局时，整幅实时棋盘必须一致。
            reference = json.loads(Path(reviewed_layout).read_text(encoding='utf-8'))
            grid = tuple(reference['grid'])
            pigs = reference['pigs']
            positions, directions = player.solver.prepare(pigs, grid[3], grid[4])
            expected_ducks = {tuple(cell) for cell in reference['ducks']}
            if player.match_expected(raw, positions, directions, grid, [pig.get('length', 2) for pig in pigs]) is None or duck_cells(ducks, grid) != expected_ducks:
                raise ValueError('当前猪鸭位置与人工复核布局不一致')
        else:
            pigs = stable_initial_with_retries(adapter, level, image)
            grid = auto.infer_grid(pigs, image.shape[1::-1])
            pigs = player.with_grid(pigs, grid)
            if ducks:
                expected_ducks = duck_cells(ducks, grid)
        blockers = ()
        if unknown_entities:
            occupied = {tuple(cell) for pig in pigs for cell in pig['grid']['cells']} | expected_ducks
            blockers, _ = auto.estimate_entity_blockers(unknown_entities, grid, occupied)
        def find_solution(candidates, state_limit, time_limit, order_seed=None):
            if ducks:
                return player.solver.solve_duck_hypothesis(candidates, expected_ducks, grid[3], grid[4], state_limit, time_limit, blockers=blockers)
            if order_seed is not None:
                return player.solver.solve(candidates, grid[3], grid[4], state_limit, time_limit, order_seed=order_seed, blockers=blockers)
            return player.solver.solve(candidates, grid[3], grid[4], state_limit, time_limit, blockers=blockers)
        if candidate_plan is not None:
            if reviewed_layout is None:
                raise ValueError('外部候选计划必须同时提供复核布局')
            candidate = json.loads(Path(candidate_plan).read_text(encoding='utf-8'))
            solution = player.solver.validate_candidate_plan(pigs, expected_ducks, grid[3], grid[4], candidate['actions'], blockers=blockers)
        else:
            solution = find_solution(pigs, max_states, timeout)
        original_pigs = list(pigs)
        retries = [] if ducks else [('actions', seed, min(max_states, 2000), min(timeout, 3.0)) for seed in range(1, 21)]
        retries += [('pigs', seed, min(max_states, 2000), min(timeout, 3.0)) for seed in range(1, 21)]
        retries += [('pigs', seed, max_states, timeout) for seed in (1, 2, 3, 4)]
        search_order = 'independently-validated-candidate' if candidate_plan is not None else 'default'
        for style, seed, state_limit, time_limit in retries:
            if solution['status'] != 'search_limit':
                break
            shuffled = list(original_pigs)
            if style == 'pigs':
                random.Random(seed).shuffle(shuffled)
            print(f'第 {level} 关：搜索超时，尝试{style}顺序 {seed}', flush=True)
            solution = find_solution(shuffled, state_limit, time_limit, seed if style == 'actions' else None)
            search_order = f'{style}-{seed}'
            pigs = shuffled
        if solution['status'] == 'search_limit':
            print(f'第 {level} 关：常规搜索达到上限，尝试快速离线遍历', flush=True)
            solution = fast.solve_fast(original_pigs, expected_ducks, grid[3], grid[4], blockers=blockers) if blockers else fast.solve_fast(original_pigs, expected_ducks, grid[3], grid[4])
            pigs = original_pigs
            search_order = f"fast-{solution.get('fast_seed', 'limit')}"
        if ducks and solution.get('initial_duck_departures'):
            raise ValueError('鸭子模型预测初始画面应发生变化，拒绝执行')
        player.write_json(output / 'level-reviewed.json', {'level': level, 'grid': list(grid), 'pigs': pigs,
                          'note': '自动识别候选，视觉框不是碰撞框'})
        player.write_json(output / 'plan.json', {'status': solution['status'], 'states': solution['states'],
                          'model': 'assumed_duck_pathfinding' if ducks else 'assumed_slide_to_obstacle_or_exit',
                          'grid': list(grid), 'initial_ducks': sorted(expected_ducks), 'blockers': blockers, 'search_order': search_order,
                          'filter_outside_yellow': filter_outside_yellow,
                          'actions': solution['actions']})
        if solution['status'] not in ('solved', 'solved_hypothesis', 'solved_with_fixed_blockers'):
            raise ValueError('完整计划未找到：' + solution['status'])
        if len(solution['actions']) > max_steps:
            raise ValueError('完整计划超过步骤上限')
        expected = list(solution['initial'])
        directions = [pig['direction'] for pig in pigs]
        for index, action in enumerate(solution['actions']):
            matched = None
            for _ in range(25):
                latest = adapter.capture()
                if auto.ui_state(latest) != 'unknown':
                    break
                if unknown_entities:
                    observed = auto.find_blue_elephants(latest, board)
                    if len(observed) != len(unknown_entities) or any(
                            math.dist(a['bbox'][:2], b['bbox'][:2]) > 8
                            for a, b in zip(observed, unknown_entities)):
                        raise ValueError('未知物件外观或位置变化，停止并重新建模')
                detected, _, _ = player.extract.identify(latest, board)
                try:
                    matched = player.match_expected(detected, expected, directions, grid, [pig.get('length', 2) for pig in pigs])
                    if ducks:
                        current_yellow = auto.find_yellow_ducks(latest, board)
                        if filter_outside_yellow:
                            current_yellow, _ = filter_yellow_candidates(current_yellow, grid, player.with_grid(detected, grid))
                        if duck_cells(current_yellow, grid) != expected_ducks:
                            matched = None
                except ValueError:
                    matched = None
                if matched is not None:
                    break
                time.sleep(0.37)
            if matched is None:
                raise ValueError(f'第 {index + 1} 步之前棋盘未匹配计划')
            if pending is not None:
                confirmed.append(pending)
                player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
                pending = None
            position = tuple(action['from'])
            target = matched.get(position)
            if target is None or expected[action['index']] != position:
                raise ValueError('计划目标与棋盘不一致')
            center = target['center']
            # 强制点击仅位于棋盘区域，不允许触碰游戏下方三个道具。
            x, y, w, h = board
            if not (x <= center[0] < x + w and y <= center[1] < y + h):
                raise ValueError('目标不在棋盘区域')
            pending = {'action': action, 'observed_center': center}
            adapter.click(center, latest.shape[1::-1])
            clicks += 1
            expected[action['index']] = tuple(action['to']) if action['to'] is not None else None
            if ducks:
                expected_ducks = {tuple(cell) for cell in action['ducks_after']}
            time.sleep(wait_seconds)
        if blockers:
            for _ in range(25):
                latest = adapter.capture()
                detected, _, _ = player.extract.identify(latest, board)
                matched = player.match_expected(detected, expected, directions, grid, [pig.get('length', 2) for pig in pigs])
                if matched is not None:
                    if pending is not None:
                        confirmed.append(pending)
                        player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
                    cv2.imwrite(str(output / 'solution-order.png'), auto.render_solution(image, pigs, [item['action'] for item in confirmed]))
                    save_or_error(output / 'result.png', latest)
                    player.write_json(output / 'result.json', {'status': 'unknown_entity_remaining', 'level': level,
                                      'clicks': clicks, 'confirmed': len(confirmed), 'screenshot': 'result.png'})
                    return 'unknown_entity_remaining', latest
                time.sleep(0.37)
            raise ValueError('阶段计划结束后无法确认小猪已清空')
        victory = await_victory(adapter, output)
        if victory is None:
            latest = adapter.capture()
            raise ValueError('未能确认通关画面或存在未识别弹窗')
        latest = victory
        if pending is not None:
            confirmed.append(pending)
            player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
        actual_actions = [item['action'] for item in confirmed]
        if len(actual_actions) != len(solution['actions']):
            raise ValueError('确认动作数量与完整计划不一致')
        image_out = auto.render_solution(image, pigs, actual_actions)
        if not cv2.imwrite(str(output / 'solution-order.png'), image_out):
            raise OSError('无法保存顺序图')
        player.write_json(output / 'solution-order.json', {'status': 'victory_verified', 'steps': actual_actions})
        player.write_json(output / 'result.json', {'status': 'victory', 'level': level, 'clicks': clicks,
                          'confirmed': len(confirmed), 'victory': 'victory.png'})
        return 'victory', image
    except (Exception, KeyboardInterrupt) as error:
        if not (output / 'result.json').exists():
            if latest is not None and not (output / 'interrupted.png').exists():
                save_or_error(output / 'interrupted.png', latest)
            player.write_json(output / 'result.json', {'status': 'interrupted', 'level': level,
                              'clicks': clicks, 'confirmed': len(confirmed), 'reason': str(error),
                              'pending_action': pending, 'screenshot': 'interrupted.png'})
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description='逐关保存初始布局、搜索解法、通关并保存步骤图；不点击关内道具。')
    parser.add_argument('--start-level', type=int, required=True, help='开始采集的关卡编号')
    parser.add_argument('--window-id', type=player.extract.parse_window_id, required=True)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--output-root', type=Path, default=Path('docs/references/pig-game/play-runs'))
    parser.add_argument('--max-levels', type=int, default=100, help='本次最多尝试的关卡数')
    parser.add_argument('--from-victory', action='store_true', help='当前停在上一关通关界面，先点击下一关')
    parser.add_argument('--previous-initial', type=Path, help='上一关初始截图，用于确认关卡标题变化')
    parser.add_argument('--wait', type=float, default=1.5)
    parser.add_argument('--reviewed-layout', type=Path, help='显式启用人工复核的鸭子试验布局，仅用于首关')
    parser.add_argument('--duck-auto', action='store_true', help='显式启用多帧识别鸭子布局与试验模型')
    parser.add_argument('--filter-outside-yellow', action='store_true', help='仅在人工核对黄色候选后过滤网格外或与猪重叠的候选')
    parser.add_argument('--candidate-plan', type=Path, help='首关外部候选计划，须配合复核布局并逐步验证')
    args = parser.parse_args(argv)
    if args.start_level < 1 or args.max_levels < 1 or not math.isfinite(args.wait) or args.wait < 1:
        parser.error('关卡和关数必须为正整数；等待至少 1 秒')
    adapter = None
    try:
        adapter = player.X11Adapter(args.display, args.window_id)
        initial = None
        if args.from_victory:
            previous_path = args.previous_initial or args.output_root / f'level-{args.start_level - 1:02d}-color-arrows' / 'original.png'
            previous = cv2.imread(str(previous_path))
            if previous is None:
                raise ValueError('切换前需要上一关初始截图，请用 --previous-initial 指定')
            stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            evidence = args.output_root / f'level-{args.start_level:02d}-transition-{stamp}'
            initial = transition_to_next(adapter, previous, evidence)
        for offset in range(args.max_levels):
            level = args.start_level + offset
            stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            output = args.output_root / f'level-{level:02d}-run-{stamp}'
            print(f'第 {level} 关：保存及求解 {output}', flush=True)
            status, previous_initial = run_level(adapter, output, level, initial=initial, wait_seconds=args.wait,
                                               reviewed_layout=args.reviewed_layout if offset == 0 else None,
                                               duck_auto=args.duck_auto,
                                               candidate_plan=args.candidate_plan if offset == 0 else None,
                                               filter_outside_yellow=args.filter_outside_yellow if offset == 0 else False)
            print(f'第 {level} 关：{status}；资料 {output}', flush=True)
            if status != 'victory':
                return 2
            if offset + 1 < args.max_levels:
                stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
                evidence = args.output_root / f'level-{level + 1:02d}-transition-{stamp}'
                initial = transition_to_next(adapter, previous_initial, evidence)
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        print('连续游玩已停止：' + str(error), flush=True)
        return 1
    finally:
        if adapter:
            adapter.close()


if __name__ == '__main__':
    raise SystemExit(main())
