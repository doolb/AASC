#!/usr/bin/env python3
"""复核保守铁笼布局并由本地求解器分阶段执行，不调用高层模型。"""
import argparse
import hashlib
import importlib.util
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np
import pig_cage
import pig_cage_stage
import pig_locked_candidate as candidate
import pig_ocr

ROOT = Path(__file__).resolve().parent.parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def protected_cells(box, grid, padding=2):
    """把未知外观四周的足够余量视作静态障碍，不猜测其形状或朝向。"""
    if (not isinstance(box, (list, tuple)) or len(box) != 4
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in box)
            or box[2] <= 0 or box[3] <= 0):
        raise ValueError('未知物件范围无效')
    x, y, width, height = box
    x0, y0, step, columns, rows = grid
    if (x < x0 - step / 2 or y < y0 - step / 2
            or x + width > x0 + (columns - .5) * step
            or y + height > y0 + (rows - .5) * step):
        raise ValueError('未知物件超出已复核网格')
    return {(col, row) for row in range(rows) for col in range(columns)
            if x - padding * step <= x0 + col * step <= x + width + padding * step
            and y - padding * step <= y0 + row * step <= y + height + padding * step}


def validate_layout(layout, screenshot, level):
    if (not isinstance(layout, dict) or layout.get('stage_mode') != 'conservative_cage'
            or layout.get('reviewed') is not True or layout.get('mechanicsReviewed') is not True
            or layout.get('level') != level or type(layout.get('level')) is not int):
        raise ValueError('铁笼阶段必须按当前关卡明确复核')
    if layout.get('source_sha256') != hashlib.sha256(screenshot).hexdigest():
        raise ValueError('铁笼阶段布局未绑定当前截图')
    if set(layout.get('mechanics', [])) != {'ordinary', 'cage'}:
        raise ValueError('铁笼阶段机制声明无效')
    if any(layout.get(key) for key in ('ducks', 'locks', 'dynamic_cages', 'bombs', 'scissors', 'ropes', 'other_entities', 'unknown_entities')):
        raise ValueError('铁笼阶段含未建模物件')
    grid = layout.get('grid')
    if (not isinstance(grid, (tuple, list)) or len(grid) != 5
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in grid[:3])
            or grid[2] <= 0 or any(type(v) is not int or v <= 0 for v in grid[3:])
            or grid[3] * grid[4] > 255):
        raise ValueError('铁笼阶段网格无效')
    frame = cv2.imdecode(np.frombuffer(screenshot, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError('铁笼阶段截图无效')
    execute = load('pig_reviewed_cage_execute', 'pig-nav-execute.py')
    board = layout.get('board')
    execute.validate_board(board, frame.shape)
    cages = pig_cage.detect(frame, board)
    if len(cages) != 1:
        raise ValueError('铁笼范围无法唯一识别')
    cells = {tuple(cell) for cell in layout.get('cage_cells', [])}
    if not cells or cells != pig_cage.cells(cages, grid):
        raise ValueError('铁笼占格与截图不一致')
    blocked = {tuple(cell) for cell in layout.get('blockers', [])}
    if not cells <= blocked:
        raise ValueError('铁笼必须整体作为静态障碍')
    frozen = layout.get('cage_unknown')
    pigs = layout.get('pigs')
    if not isinstance(frozen, list) or not isinstance(pigs, list) or not pigs:
        raise ValueError('笼外复核布局不完整')
    executor = candidate.locked_module()
    for item in frozen:
        if not isinstance(item, dict) or not isinstance(item.get('center'), list) or len(item['center']) != 2:
            raise ValueError('静态物件候选无效')
        if item.get('direction') == 'unknown':
            if not protected_cells(item.get('bbox'), grid) <= blocked:
                raise ValueError('未知物件周边未被保守阻挡')
        else:
            occupied = item.get('grid', {}).get('cells')
            if not isinstance(occupied, list) or not occupied or not {tuple(cell) for cell in occupied} <= blocked:
                raise ValueError('静态棋子占格未被阻挡')
            observed = executor.app.player.with_grid([item], grid)[0]
            if {tuple(cell) for cell in observed['grid']['cells']} != {tuple(cell) for cell in occupied}:
                raise ValueError('静态棋子占格与外观不一致')
    if any(pig.get('kind', 'ordinary') not in ('ordinary', 'pig', 'normal')
           or pig.get('direction') not in ('north', 'south', 'east', 'west') for pig in pigs):
        raise ValueError('移动目标含未复核特殊棋子')
    middle = load('pig_reviewed_cage_middle', 'pig-nav-middle.py')
    hints = layout.get('reviewed_red_hints', [])
    if not isinstance(hints, list) or any(type(item) is not int for item in hints) or len(hints) != len(set(hints)):
        raise ValueError('红色提示复核列表无效')
    detected = executor.app.player.extract.identify(frame, board)[0] if hints else []
    verified_hints = set()
    blue_boxes = executor.cage_blue_regions(frame, board, cages)
    for box in middle.outside_special_boxes(frame, board, cages):
        x, y, width, height = box
        matches = []
        has_blue = any(x < bx + bw and x + width > bx and y < by + bh and y + height > by
                       for bx, by, bw, bh in blue_boxes)
        if not has_blue:
            for item in frozen:
                if item.get('id') not in hints or item.get('direction') not in ('north', 'south', 'east', 'west'):
                    continue
                cx, cy = item['center']
                if math.hypot(cx - (x + width / 2), cy - (y + height / 2)) > grid[2] * .6:
                    continue
                actual = [pig for pig in detected if pig.get('highlighted_clickable')
                          and math.dist(pig.get('center', ()), item['center']) < grid[2] * .3]
                if len(actual) == 1:
                    matches.append(item['id'])
        if len(matches) > 1:
            raise ValueError('红色提示与静态棋子匹配不唯一')
        padding = 0 if matches else 2
        if not protected_cells(box, grid, padding=padding) <= blocked:
            raise ValueError('笼外特殊标记未被保守阻挡')
        verified_hints.update(matches)
    if verified_hints != set(hints):
        raise ValueError('红色提示未能与唯一静态棋子确认')
    state, directions = executor.app.player.solver.prepare(pigs, grid[3], grid[4])
    candidate.locked_module().validate_plan(dict(layout, actions=[]), require_complete=False)
    if executor.match_cage_frame(frame, board, pigs, state, directions, grid, cells, frozen) is None:
        raise ValueError('截图与完整笼外候选不一致')
    ducks = executor.app.auto.find_yellow_ducks(frame, board)
    if any(not any(pig_cage.contains(cage, duck['center']) for cage in cages) for duck in ducks):
        raise ValueError('笼外存在未确认的黄色物件')
    counters = layout.get('cage_counters')
    if not isinstance(counters, list) or len(counters) != 1 or type(counters[0]) is not int or counters[0] <= 1:
        raise ValueError('铁笼计数不可安全执行阶段')
    return frame


def solve_stage(layout):
    target = min(8, layout['cage_counters'][0] - 1, len(layout['pigs']))
    try:
        result = candidate.solve(layout, seeds=(17, 1, 2), allow_partial=True, target_exits=target)
    except ValueError:
        if target == 1:
            raise
        result = candidate.solve(layout, seeds=(17, 1, 2), allow_partial=True, target_exits=1)
    exits = sum(int(action.get('exited', False)) for action in result.get('actions', []))
    if result.get('status') != 'partial' or not 0 < exits < layout['cage_counters'][0]:
        raise ValueError('未找到可确认离场的安全阶段')
    candidate.locked_module().validate_plan(result, require_complete=False)
    return result


def apply_actions(layout, actions):
    executor = candidate.locked_module()
    solver = executor.app.player.solver
    pigs, grid = layout['pigs'], layout['grid']
    state, directions = solver.prepare(pigs, grid[3], grid[4])
    state = list(state)
    for action in actions:
        state[action['index']] = tuple(action['to']) if action['to'] is not None else None
    remaining = []
    for index, pig in enumerate(pigs):
        if state[index] is None:
            continue
        item = dict(pig)
        cells = solver.cells(state[index], directions[index], item.get('length', 2), item.get('width', 1))
        item['grid'] = {'col': state[index][0], 'row': state[index][1], 'cells': [list(cell) for cell in cells]}
        remaining.append(item)
    exits = sum(int(action['exited']) for action in actions)
    return {**layout, 'pigs': remaining, 'cage_counters': [layout['cage_counters'][0] - exits]}


def capture_matching(adapter, executor, layout, attempts=15):
    """动画可能暂时产生额外识别碎片；连续两帧完整匹配后才允许执行。"""
    state, directions = executor.app.player.solver.prepare(layout['pigs'], layout['grid'][3], layout['grid'][4])
    stable = 0
    for _ in range(attempts):
        current = adapter.capture()
        try:
            matched = executor.match_cage_frame(current, layout['board'], layout['pigs'], state, directions,
                                                 layout['grid'], layout['cage_cells'], layout['cage_unknown'],
                                                 protected_cells=layout.get('blockers', ()), blue_boxes=layout.get('cage_blue_markers', ()))
        except (ValueError, cv2.error):
            matched = None
        stable = stable + 1 if matched is not None else 0
        if stable >= 2:
            return current
        time.sleep(.4)
    raise ValueError('当前棋盘与复核布局连续核对失败')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--layout', required=True, type=Path)
    parser.add_argument('--image', required=True, type=Path)
    parser.add_argument('--level', required=True, type=int)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--window-id')
    parser.add_argument('--display', default=':1')
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--plan', type=Path)
    args = parser.parse_args()
    adapter = None
    try:
        layout = json.loads(args.layout.read_text(encoding='utf-8'))
        source = args.image.read_bytes()
        reference = validate_layout(layout, source, args.level)
        executor = candidate.locked_module()
        cages = pig_cage.detect(reference, layout['board'])
        layout['cage_blue_markers'] = executor.cage_blue_regions(reference, layout['board'], cages)
        if not args.execute:
            plan = solve_stage(layout)
            plan['navigation'] = {'source_sha256': layout['source_sha256'], 'level': args.level,
                                  'strategy': 'auto', 'replayed': True, 'stage': 'conservative_cage'}
            args.output.write_text(json.dumps(plan, ensure_ascii=False) + '\n', encoding='utf-8')
            print('已独立重放保守铁笼阶段')
            return
        if args.plan is None:
            raise ValueError('执行阶段必须提供已复核计划')
        plan = json.loads(args.plan.read_text(encoding='utf-8'))
        navigation = {'source_sha256': layout['source_sha256'], 'level': args.level,
                      'strategy': 'auto', 'replayed': True, 'stage': 'conservative_cage'}
        if plan.get('navigation') != navigation or plan.get('status') != 'partial':
            raise ValueError('阶段计划与首屏或求解策略不匹配')
        for key in ('pigs', 'grid', 'board', 'locks', 'ducks', 'blockers', 'cage_cells', 'cage_unknown', 'cage_counters', 'cage_blue_markers'):
            if plan.get(key) != layout.get(key):
                raise ValueError('阶段计划与复核布局不一致：' + key)
        exits = sum(int(action.get('exited', False)) for action in plan.get('actions', []))
        if not 0 < exits < layout['cage_counters'][0]:
            raise ValueError('阶段计划离场数量无效')
        candidate.locked_module().validate_plan(plan, require_complete=False)
        window = executor.app.player.extract.parse_window_id(args.window_id)
        adapter = executor.app.player.X11Adapter(args.display, window)
        args.output.mkdir(parents=True, exist_ok=False)
        current = capture_matching(adapter, executor, layout)
        options = {'short_side': 640, 'timeout': 45, 'display_id': None}
        verification = args.output / 'level-verification'
        verification.mkdir()
        title, _ = pig_ocr.inspect(current, verification, [], [], options)
        if ((title.get('title') or {}).get('recognized') or {}).get('value') != args.level:
            raise ValueError('当前关卡编号未能确认')
        counters = pig_cage_stage.read_counters(executor.app, current, pig_cage.detect(current, layout['board']),
                                                args.output / 'initial-counter', options)
        if counters != layout['cage_counters']:
            raise ValueError('当前铁笼计数与复核布局不一致')
        for number in range(1, 101):
            stage = args.output / f'stage-{number:03d}'
            if executor.run(adapter, plan, layout['board'], stage) != 'stage_complete':
                raise ValueError('本地阶段未确认完成')
            layout = apply_actions(layout, plan['actions'])
            current = cv2.imread(str(stage / 'stage-final.png'))
            if current is None:
                raise ValueError('阶段结束画面不存在')
            counters = pig_cage_stage.read_counters(executor.app, current, pig_cage.detect(current, layout['board']),
                                                    stage / 'counter', options)
            if counters != layout['cage_counters']:
                raise ValueError('阶段结束后铁笼计数不一致')
            if layout['cage_counters'][0] <= 1 or not layout['pigs']:
                break
            try:
                plan = solve_stage(layout)
            except ValueError:
                break
        (args.output / 'next-layout.json').write_text(json.dumps(layout, ensure_ascii=False) + '\n', encoding='utf-8')
        (args.output / 'result.json').write_text(json.dumps({'status': 'stage_complete', 'level': args.level,
            'cage_counters': layout['cage_counters']}, ensure_ascii=False) + '\n', encoding='utf-8')
        print('本地保守阶段已完成，需要重新采集和复核剩余现场')
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, cv2.error) as error:
        if adapter is not None and args.output.is_dir():
            try:
                cv2.imwrite(str(args.output / 'interrupted.png'), adapter.capture())
            except (OSError, ValueError, RuntimeError, cv2.error):
                pass
            (args.output / 'result.json').write_text(json.dumps({'status': 'interrupted', 'reason': str(error)}, ensure_ascii=False) + '\n', encoding='utf-8')
        parser.exit(1, f'保守铁笼阶段停止：{error}\n')
    finally:
        if adapter is not None:
            adapter.close()


if __name__ == '__main__':
    main()
