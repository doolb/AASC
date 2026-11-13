#!/usr/bin/env python3
"""搜索解除指定物件前方阻挡的阶段计划，再通过指定 X11 窗口执行。"""
import argparse
from datetime import datetime
import heapq
import importlib.util
import json
import math
from pathlib import Path
import sys
import time

import cv2

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pig_stage_auto', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def search(pigs, grid, blockers, target, limit=100000, remove_goal=0):
    """优先遍历已离场较多的状态，直到达到指定阶段目标。"""
    solver = app.player.solver
    initial, directions = solver.prepare(pigs, grid[3], grid[4])
    lengths = [pig.get('length', 2) for pig in pigs]
    solver.validate_blockers(blockers, initial, directions, lengths, grid[3], grid[4])
    queue = [(len(initial), 0, initial)]
    serial = 0
    parent = {initial: None}
    while queue:
        _, _, state = heapq.heappop(queue)
        occupied = {cell for i, pos in enumerate(state) for cell in solver.cells(pos, directions[i], lengths[i])}
        if ((target is not None and not occupied.intersection(target))
                or (remove_goal and sum(position is None for position in state) >= remove_goal)):
            path = []
            while parent[state] is not None:
                state, action = parent[state]
                path.append(action)
            path.reverse()
            return initial, directions, path, len(parent)
        for exited, index, destination, distance in solver.actions(state, directions, grid[3], grid[4], blockers, lengths):
            following = list(state)
            following[index] = destination
            following = tuple(following)
            if following in parent:
                continue
            if len(parent) >= limit:
                raise ValueError('阶段搜索达到状态上限，未找到计划')
            action = {'index': index, 'pig_id': pigs[index]['id'], 'direction': directions[index],
                      'from': state[index], 'to': destination, 'exited': exited, 'travel_cells': distance}
            parent[following] = (state, action)
            serial += 1
            remaining = sum(position is not None for position in following)
            heapq.heappush(queue, (remaining, serial, following))
    raise ValueError('当前假设下无法打开物件前方')


def stage_geometry(entities, blockers, conflicts, grid, direction):
    """按人工核对朝向修正遮挡边缘，并求物件前方一整排格子。"""
    horizontal = direction in ('east', 'west')
    if conflicts:
        projected = {tuple(cell) for cell in entities[0]['estimated_grid_cells']}
        cross_values = {row if horizontal else col for col, row in projected}
        axis_values = {col if horizontal else row for col, row in projected}
        valid_axis = set()
        for axis in axis_values:
            section = {(axis, cross) if horizontal else (cross, axis) for cross in cross_values}
            if section <= set(blockers):
                valid_axis.add(axis)
        blockers = tuple(sorted(cell for cell in blockers if (cell[0] if horizontal else cell[1]) in valid_axis))
        if not blockers:
            raise ValueError('小象图像重叠后无法估计完整阻挡截面')
        entities[0]['estimated_blockers_after_overlap'] = blockers
    dx, dy = app.player.solver.VECTORS[direction]
    axis_values = [col if horizontal else row for col, row in blockers]
    leading = max(axis_values) if dx > 0 or dy > 0 else min(axis_values)
    target = {(col + dx, row + dy) for col, row in blockers
              if (col if horizontal else row) == leading
              and 0 <= col + dx < grid[3] and 0 <= row + dy < grid[4]}
    return blockers, target


def run(adapter, level, output, wait=1.5, direction='south'):
    output.mkdir(parents=True, exist_ok=False)
    image = adapter.capture()
    app.save_or_error(output / 'original.png', image)
    board = app.player.extract.valid_board(image, None)
    pigs = app.player.stable_initial(adapter, level, image, samples=4)
    grid = app.auto.infer_grid(pigs, image.shape[1::-1])
    pigs = app.player.with_grid(pigs, grid)
    entities = app.auto.find_blue_elephants(image, board)
    if len(entities) != 1:
        raise ValueError('需要恰好一个已观察小象候选')
    occupied = {tuple(cell) for pig in pigs for cell in pig['grid']['cells']}
    ducks = []
    rejected_ducks = []
    for duck in app.auto.find_yellow_ducks(image, board):
        try:
            cells = app.duck_cells([duck], grid)
            if cells & occupied:
                rejected_ducks.append(duck)
            else:
                ducks.append(duck)
        except ValueError:
            rejected_ducks.append(duck)
    if ducks:
        raise ValueError('阶段搜索暂不支持棋盘内鸭子')
    blockers, conflicts = app.auto.estimate_entity_blockers(entities, grid, occupied)
    blockers, target = stage_geometry(entities, blockers, conflicts, grid, direction)
    if not target:
        raise ValueError('物件前方已到边界，须观察物件离场')
    app.player.write_json(output / 'level.json', {'level': level, 'grid': grid, 'pigs': pigs,
                          'other_entities': entities, 'blockers': blockers, 'target': sorted(target),
                          'rejected_yellow_candidates': rejected_ducks,
                          'object_direction': direction, 'warning': '小象位置及方向均由画面估计，阶段搜索不是整关通关计划'})
    marked = app.player.extract.annotate(image, pigs, board, [])
    cv2.imwrite(str(output / 'annotated.png'), app.auto.mark_unknown_entities(marked, entities, grid))
    initial, directions, plan, explored = search(pigs, grid, blockers, target)
    app.player.write_json(output / 'plan.json', {'status': 'stage_plan', 'states': explored, 'actions': plan})
    expected = list(initial)
    confirmed = []
    latest = image
    pending = None
    try:
        for action in plan:
            index = action['index']
            for attempt in range(25):
                latest = adapter.capture()
                detected, _, _ = app.player.extract.identify(latest, board)
                observed = app.auto.find_blue_elephants(latest, board)
                try:
                    matched = app.player.match_expected(detected, expected, directions, grid, [p.get('length', 2) for p in pigs])
                except ValueError:
                    # 动画帧可能让身体暂时无法映射，等待完整稳定帧再判断。
                    matched = None
                if len(observed) == 1 and math.dist(observed[0]['bbox'][:2], entities[0]['bbox'][:2]) < 8 and matched is not None:
                    break
                time.sleep(0.37)
            else:
                raise ValueError('操作前画面与阶段计划不一致')
            target_pig = matched.get(tuple(action['from']))
            if target_pig is None:
                raise ValueError('计划目标未匹配')
            pending = {'action': action, 'observed_center': target_pig['center']}
            adapter.click(target_pig['center'], latest.shape[1::-1])
            expected[index] = tuple(action['to']) if action['to'] is not None else None
            time.sleep(wait)
            for attempt in range(25):
                latest = adapter.capture()
                detected, _, _ = app.player.extract.identify(latest, board)
                observed = app.auto.find_blue_elephants(latest, board)
                try:
                    matched = app.player.match_expected(detected, expected, directions, grid, [p.get('length', 2) for p in pigs])
                except ValueError:
                    matched = None
                if len(observed) == 1 and math.dist(observed[0]['bbox'][:2], entities[0]['bbox'][:2]) < 8 and matched is not None:
                    break
                time.sleep(0.37)
            else:
                raise ValueError('操作后画面与阶段计划不一致')
            confirmed.append(pending)
            pending = None
            app.player.write_json(output / f'action-{len(confirmed):03d}.json', confirmed[-1])
        app.save_or_error(output / 'result.png', latest)
        cv2.imwrite(str(output / 'solution-order.png'), app.auto.render_solution(image, pigs, [item['action'] for item in confirmed]))
        app.player.write_json(output / 'result.json', {'status': 'stage_complete', 'confirmed': len(confirmed), 'target': sorted(target)})
        return latest
    except (Exception, KeyboardInterrupt) as error:
        app.save_or_error(output / 'interrupted.png', latest)
        app.player.write_json(output / 'result.json', {'status': 'interrupted', 'confirmed': len(confirmed),
                              'pending_action': pending, 'reason': str(error)})
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--level', required=True, type=int)
    parser.add_argument('--window-id', required=True, type=app.player.extract.parse_window_id)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--advance-object', action='store_true', help='阶段完成后尝试点击已观察的小象')
    parser.add_argument('--direction', choices=('north', 'south', 'east', 'west'), default='south', help='画面复核后的小象朝向')
    parser.add_argument('--max-stages', type=int, default=1)
    args = parser.parse_args()
    adapter = app.player.X11Adapter(args.display, args.window_id)
    try:
        if args.max_stages < 1:
            raise ValueError('阶段数必须大于零')
        for number in range(args.max_stages):
            output = ROOT / 'docs/references/pig-game/play-runs' / f"level-{args.level:02d}-unlock-{datetime.now():%Y%m%d-%H%M%S-%f}"
            print('阶段记录:', output, flush=True)
            try:
                current = run(adapter, args.level, output, direction=args.direction)
            except (Exception, KeyboardInterrupt) as error:
                if output.exists() and not (output / 'result.json').exists():
                    app.player.write_json(output / 'result.json', {'status': 'interrupted', 'reason': str(error), 'confirmed': 0})
                raise
            print('前方阶段计划已完成', flush=True)
            if not args.advance_object:
                break
            board = app.player.extract.valid_board(current, None)
            entities = app.auto.find_blue_elephants(current, board)
            if len(entities) != 1:
                raise ValueError('阶段后小象候选不唯一')
            x, y, width, height = entities[0]['bbox']
            point = (x + width // 2, y + height // 2)
            bx, by, bw, bh = board
            if not (bx <= point[0] < bx + bw and by <= point[1] < by + bh):
                raise ValueError('小象点击位置不在棋盘范围内')
            app.save_or_error(output / 'object-before.png', current)
            adapter.click(point, current.shape[1::-1])
            time.sleep(2)
            # 物件离场有时延迟数秒；有限次读取画面，不能因首帧不动而重复点击。
            gone_frames = 0
            dx, dy = app.player.solver.VECTORS[args.direction]
            after = []
            moved = False
            for _ in range(12):
                current = adapter.capture()
                after = app.auto.find_blue_elephants(current, board)
                gone_frames = gone_frames + 1 if not after else 0
                if len(after) == 1:
                    delta = (after[0]['bbox'][0] - entities[0]['bbox'][0], after[0]['bbox'][1] - entities[0]['bbox'][1])
                    moved = delta[0] * dx + delta[1] * dy >= 15
                if gone_frames >= 3 or moved:
                    break
                time.sleep(0.6)
            app.save_or_error(output / 'object-after.png', current)
            app.player.write_json(output / 'object-action.json', {'before': entities, 'after': after, 'click': point})
            if gone_frames >= 3:
                print('物件未再检测到，保留现场以重新识别', flush=True)
                break
            if not moved:
                raise ValueError('小象未确认移动，保留现场')
            print('已确认小象移动，重新搜索下一阶段', flush=True)
    finally:
        adapter.close()


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError) as error:
        print('阶段停止:', error, file=sys.stderr)
        sys.exit(1)
