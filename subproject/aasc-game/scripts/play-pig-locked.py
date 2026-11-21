#!/usr/bin/env python3
"""独立验证完整锁猪计划，逐步核对 X11 画面后执行并保存证据。"""
import argparse
from datetime import datetime
import importlib.util
import json
import math
from pathlib import Path
import time

import cv2

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('locked_pig_auto', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
pig_cage = app.cage_vision


def validate_plan(data, require_complete=True):
    """独立重放所有动作，禁止提前操作锁猪或接受不完整终态。"""
    policy = data.get('bomb_policy')
    if policy is not None and policy != 'avoid_contact':
        raise ValueError('未知炸弹策略')
    bombs = set()
    if policy == 'avoid_contact':
        if not isinstance(data.get('bombs'), dict) or not data['bombs'] or data.get('ducks'):
            raise ValueError('炸弹配置无效或与鸭子混合尚未验证')
        try:
            bombs = {int(key) for key in data['bombs']}
        except (ValueError, TypeError) as error:
            raise ValueError('炸弹编号无效') from error
        if not bombs <= {pig['id'] for pig in data['pigs']}:
            raise ValueError('炸弹编号不在布局中')
        marked = {pig['id'] for pig in data['pigs'] if pig.get('kind') == 'bomb' or pig.get('bomb_limit') is not None}
        if not marked <= bombs:
            raise ValueError('炸弹编号未全部声明')
    if data.get('ducks') and data.get('dynamic_cages'):
        raise ValueError('动态铁笼与鸭子混合尚未验证')
    ids = {pig['id'] for pig in data['pigs']}
    scissors = set(data.get('scissors', []))
    ropes = set(data.get('ropes', []))
    if not scissors <= ids or not ropes <= ids or scissors & ropes or (ropes and not scissors):
        raise ValueError('剪刀猪或捆绑猪标识无效')
    remaining_scissors = set(scissors)
    for action in data['actions']:
        if action['pig_id'] in ropes and remaining_scissors:
            raise ValueError('绳子尚未全部解除')
        if action.get('exited') is True:
            remaining_scissors.discard(action['pig_id'])
    if data.get('ducks'):
        verified = app.player.solver.validate_candidate_plan(data['pigs'], data['ducks'], data['grid'][3], data['grid'][4], data['actions'], data.get('blockers', ()), require_complete=require_complete)
        locks = {int(key): int(value) for key, value in data.get('locks', {}).items()}
        if any(key not in {pig['id'] for pig in data['pigs']} or value < 0 for key, value in locks.items()):
            raise ValueError('锁条件无效')
        exits = 0
        for action in verified['actions']:
            if exits < locks.get(action['pig_id'], 0):
                raise ValueError('锁猪尚未解锁')
            exits += int(action['exited']) + len(action.get('duck_departures', ()))
        return locks
    pigs, grid = data['pigs'], data['grid']
    cages = data.get('dynamic_cages', [])
    state, directions = app.player.solver.prepare(pigs, grid[3], grid[4])
    state = list(state)
    locks = {int(key): int(value) for key, value in data.get('locks', {}).items()}
    if any(key not in {pig['id'] for pig in pigs} or value < 0 for key, value in locks.items()):
        raise ValueError('锁条件无效')
    lengths = [pig.get('length', 2) for pig in pigs]
    widths = [pig.get('width', 1) for pig in pigs]
    blockers = app.player.solver.validate_blockers(data.get('blockers', ()), state, directions, lengths, grid[3], grid[4], (), widths)
    checked_cages = []
    for cage in cages:
        threshold = cage.get('unlock_exits')
        cells = cage.get('cells')
        if type(threshold) is not int or threshold < 1 or not isinstance(cells, list) or not cells:
            raise ValueError('铁笼解锁计数或占格无效')
        points = {tuple(cell) for cell in cells}
        if len(points) != len(cells) or any(len(cell) != 2 or any(type(v) is not int for v in cell)
                                           or not (0 <= cell[0] < grid[3] and 0 <= cell[1] < grid[4]) for cell in points):
            raise ValueError('铁笼占格重复或越界')
        checked_cages.append((threshold, points))
    exits = 0
    for action in data['actions']:
        index = action['index']
        if type(index) is not int or not 0 <= index < len(pigs) or state[index] is None:
            raise ValueError('计划目标无效')
        pig = pigs[index]
        if exits < locks.get(pig['id'], 0):
            raise ValueError('锁猪尚未解锁')
        active_cage = set().union(*(cells for threshold, cells in checked_cages if exits < threshold))
        if active_cage.intersection(app.player.solver.cells(state[index], directions[index], lengths[index], widths[index])):
            raise ValueError('铁笼内的小猪尚未解锁')
        destination = tuple(action['to']) if action['to'] is not None else None
        candidate = (action['exited'], index, destination, action['travel_cells'])
        if (type(action['exited']) is not bool or action['pig_id'] != pig['id']
                or action['direction'] != directions[index] or tuple(action['from']) != state[index]
                or candidate not in app.player.solver.actions(state, directions, grid[3], grid[4], blockers=set(blockers) | active_cage, lengths=lengths, widths=widths, springs={i for i, pig in enumerate(pigs) if pig.get('kind') == 'spring'})):
            raise ValueError('计划动作不合法')
        if bombs and not action['exited']:
            # 保守搜索不假设可承受碰撞次数；炸弹及被撞炸弹均不得接触。
            if pig['id'] in bombs:
                raise ValueError('保守策略禁止炸弹撞击')
            dx, dy = app.player.solver.VECTORS[directions[index]]
            own = app.player.solver.cells(destination, directions[index], lengths[index], widths[index])
            front = {(x + dx, y + dy) for x, y in own} - set(own)
            bomb_cells = {cell for i, other in enumerate(pigs) if other['id'] in bombs
                          for cell in app.player.solver.cells(state[i], directions[i], lengths[i], widths[i])}
            if front & bomb_cells:
                raise ValueError('保守策略禁止撞击炸弹')
        state[index] = destination
        exits += int(action['exited'])
    if require_complete and any(position is not None for position in state):
        raise ValueError('计划未清空棋盘')
    return locks


def match_frame(image, board, pigs, state, directions, grid, locks, exits, ducks=None):
    """被锁覆盖的猪暂不参与外观识别，但仍参与全部占格计算。"""
    if app.auto.ui_state(image) != 'unknown':
        return None
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    for pig in pigs:
        if exits >= locks.get(pig['id'], 0):
            continue
        x, y = (round(value) for value in pig['center'])
        left, top = max(0, x - 20), max(0, y - 20)
        right, bottom = min(image.shape[1], x + 20), min(image.shape[0], y + 20)
        mask = cv2.inRange(hsv[top:bottom, left:right], (18, 100, 120), (40, 255, 255))
        if cv2.countNonZero(mask) < 80:
            return None
    if ducks is not None:
        yellow = app.auto.find_yellow_ducks(image, board)
        locked_centers = [pig['center'] for pig in pigs if exits < locks.get(pig['id'], 0)]
        yellow = [item for item in yellow if all((item['center'][0] - point[0]) ** 2 + (item['center'][1] - point[1]) ** 2 > 25 ** 2 for point in locked_centers)]
        if app.duck_cells(yellow, grid) != {tuple(cell) for cell in ducks}:
            return None
    detected, _, _ = app.player.extract.identify(image, board)
    visible = [i for i, pig in enumerate(pigs) if exits >= locks.get(pig['id'], 0)]
    return app.player.match_expected(detected, [state[i] for i in visible], [directions[i] for i in visible],
                                     grid, [pigs[i].get('length', 2) for i in visible])


def match_scissors_frame(image, board, pigs, state, directions, grid, scissors, ropes, ducks=None):
    """用蓝色物件标记核对被遮挡的猪，普通猪仍按整盘网格匹配。"""
    if app.auto.ui_state(image) != 'unknown':
        return None
    scissors_left = any(state[i] is not None and pig['id'] in scissors for i, pig in enumerate(pigs))
    hidden = [i for i, pig in enumerate(pigs) if state[i] is not None and
              (pig['id'] in scissors or (pig['id'] in ropes and scissors_left))]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    blue = cv2.inRange(hsv, (90, 90, 55), (130, 255, 255))
    markers = {}
    for i in hidden:
        col, row = state[i]
        horizontal = directions[i] in ('east', 'west')
        x = round(grid[0] + (col + (0.5 if horizontal else 0)) * grid[2])
        y = round(grid[1] + (row + (0 if horizontal else 0.5)) * grid[2])
        radius = round(grid[2] * 0.7)
        sample = blue[max(0, y-radius):min(image.shape[0], y+radius+1), max(0, x-radius):min(image.shape[1], x+radius+1)]
        if cv2.countNonZero(sample) < 25 * (image.shape[1] / 530) ** 2:
            return None
        markers[tuple(state[i])] = {'center': [x, y]}
    detected, _, _ = app.player.extract.identify(image, board)
    detected = [pig for pig in detected if all(math.dist(pig['center'], marker['center']) > grid[2] * .7 for marker in markers.values())]
    visible = [i for i in range(len(pigs)) if i not in hidden]
    matched = app.player.match_expected(detected, [state[i] for i in visible], [directions[i] for i in visible], grid,
                                         [pigs[i].get('length', 2) for i in visible])
    if matched is None:
        return None
    if ducks is not None:
        yellow = app.auto.find_yellow_ducks(image, board)
        yellow = [item for item in yellow if all(math.dist(item['center'], marker['center']) > grid[2] * .7 for marker in markers.values())]
        yellow, _ = app.filter_yellow_candidates(yellow, grid, app.player.with_grid(detected, grid))
        if app.duck_cells(yellow, grid) != {tuple(cell) for cell in ducks}:
            return None
    matched.update(markers)
    return matched


def cage_blue_regions(image, board, cages):
    """取得笼外蓝色标记，供已复核的静态未知物件位置核对。"""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (90, 50, 40), (135, 255, 255))
    allowed = mask.copy()
    allowed[:] = 0
    x, y, width, height = (round(value) for value in board)
    allowed[y:y + height, x:x + width] = 255
    for cage in cages:
        x, y, width, height = cage['bbox']
        allowed[max(0, y - 4):min(image.shape[0], y + height + 4),
                max(0, x - 4):min(image.shape[1], x + width + 4)] = 0
    mask = cv2.bitwise_and(mask, allowed)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    return [list(map(int, stats[index, :4])) for index in range(1, count)
            if stats[index, cv2.CC_STAT_AREA] >= 20]


def match_cage_frame(image, board, pigs, state, directions, grid, expected_cells, unknown=(), locks=None, exits=0,
                     protected_cells=(), blue_boxes=()):
    """每次核对笼体轮廓及全部笼外猪；蓝底漏检笼体时回退到已复核笼格边界过滤笼内猪。"""
    if app.auto.ui_state(image) != 'unknown':
        return None
    expected_set = {tuple(cell) for cell in expected_cells}
    cages = pig_cage.detect(image, board)
    if cages:
        if pig_cage.cells(cages, grid) != expected_set:
            return None
    if blue_boxes:
        current_blue = cage_blue_regions(image, board, cages)
        if len(current_blue) != len(blue_boxes):
            return None
        remaining_blue = list(current_blue)
        for x, y, width, height in blue_boxes:
            matches = [box for box in remaining_blue if math.dist((x + width / 2, y + height / 2),
                       (box[0] + box[2] / 2, box[1] + box[3] / 2)) <= 4
                       and abs(box[2] - width) <= 6 and abs(box[3] - height) <= 6]
            if len(matches) != 1:
                return None
            remaining_blue.remove(matches[0])
    locks = locks or {}
    hidden = [i for i, pig in enumerate(pigs) if state[i] is not None and exits < locks.get(pig['id'], 0)]
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    for i in hidden:
        x, y = (round(value) for value in pigs[i]['center'])
        sample = hsv[max(0, y-20):min(image.shape[0], y+20), max(0, x-20):min(image.shape[1], x+20)]
        if cv2.countNonZero(cv2.inRange(sample, (10, 160, 140), (40, 255, 255))) < 80:
            return None
    detected, _, _ = app.player.extract.identify(image, board)
    if cages:
        detected = [pig for pig in detected if not any(pig_cage.contains(cage, pig['center']) for cage in cages)]
    else:
        half = grid[2] / 2
        cage_boxes = [(grid[0] + col * grid[2] - half, grid[1] + row * grid[2] - half,
                       grid[0] + col * grid[2] + half, grid[1] + row * grid[2] + half)
                      for col, row in expected_set]
        detected = [pig for pig in detected if not any(x0 <= pig['center'][0] <= x1 and y0 <= pig['center'][1] <= y1
                                                       for x0, y0, x1, y1 in cage_boxes)]
    detected = [pig for pig in detected if all(math.dist(pig['center'], pigs[i]['center']) > grid[2] * .7 for i in hidden)]
    fragments = []
    for item in unknown:
        if (blue_boxes and item.get('direction') == 'unknown'
                and any(math.dist(item['center'], (box[0] + box[2] / 2, box[1] + box[3] / 2)) <= grid[2] * 1.3
                        for box in blue_boxes)):
            fragments.append(item)
            continue
        matches = [pig for pig in detected if math.dist(pig['center'], item['center']) < grid[2] * .3]
        if len(matches) != 1:
            return None
        detected.remove(matches[0])
    if fragments:
        blocked = {tuple(cell) for cell in protected_cells}
        def is_protected_fragment(pig):
            if not any(math.dist(pig['center'], item['center']) < grid[2] * 1.5 for item in fragments):
                return False
            x, y, width, height = pig['bbox']
            x0, y0, step, columns, rows = grid
            cells = {(col, row) for row in range(rows) for col in range(columns)
                     if x - step / 2 <= x0 + col * step <= x + width + step / 2
                     and y - step / 2 <= y0 + row * step <= y + height + step / 2}
            return bool(cells) and cells <= blocked
        detected = [pig for pig in detected if not is_protected_fragment(pig)]
    visible = [i for i in range(len(pigs)) if i not in hidden]
    return app.player.match_expected(detected, [state[i] for i in visible], [directions[i] for i in visible],
                                     grid, [pigs[i].get('length', 2) for i in visible])


def run(adapter, data, board, output, wait=1.5, stage_should_stop=None):
    if data.get('bombs') or any(pig.get('kind') == 'bomb' or pig.get('bomb_limit') is not None for pig in data.get('pigs', [])):
        raise ValueError('炸弹猪的实机画面核对尚未实现，禁止执行')
    partial = data.get('status') == 'partial'
    locks = validate_plan(data, require_complete=not partial)
    pigs, grid, actions = data['pigs'], data['grid'], data['actions']
    state, directions = app.player.solver.prepare(pigs, grid[3], grid[4])
    state = list(state)
    output.mkdir(parents=True, exist_ok=False)
    image = adapter.capture()
    board = app.player.extract.valid_board(image, board)
    app.save_or_error(output / 'original.png', image)
    app.player.write_json(output / 'level-reviewed.json', {'grid': grid, 'pigs': pigs, 'locks': locks, 'board': board})
    app.player.write_json(output / 'plan.json', data)
    special_ids = set(data.get('scissors', ())) | set(data.get('ropes', ()))
    ordinary = [pig for pig in pigs if pig['id'] not in locks and pig['id'] not in special_ids]
    marked = app.player.extract.annotate(image, ordinary, board, [])
    for col, row in data.get('cage_cells', []):
        # 标记用于碰撞计算的实际格子，避免把外观边框当成阻挡范围。
        cx, cy = grid[0] + col * grid[2], grid[1] + row * grid[2]
        half = grid[2] / 2
        cv2.rectangle(marked, (round(cx-half), round(cy-half)),
                      (round(cx+half), round(cy+half)), (255, 180, 0), 1)
    for pig in pigs:
        if pig['id'] in locks or pig['id'] in special_ids:
            x, y = (round(v) for v in pig['center'])
            cv2.rectangle(marked, (x - 28, y - 28), (x + 28, y + 28), (0, 210, 255), 2)
            label = 'CUT' if pig['id'] in data.get('scissors', ()) else 'ROPE' if pig['id'] in data.get('ropes', ()) else 'LOCK'
            cv2.putText(marked, f"{label} {pig['id']}", (x - 25, y - 30), cv2.FONT_HERSHEY_SIMPLEX, .4, (0, 210, 255), 1)
    app.save_or_error(output / 'annotated.png', marked)
    confirmed, pending, exits, latest = [], None, 0, image
    ducks = tuple(tuple(cell) for cell in data.get('ducks', []))
    tracks_ducks = bool(ducks)
    try:
        for action in actions:
            matched = None
            for _ in range(35):
                latest = adapter.capture()
                try:
                    expected_entities = data.get('unknown_entities', [])
                    if expected_entities:
                        observed = app.auto.find_blue_elephants(latest, board)
                        if len(observed) != len(expected_entities) or any(math.dist(a['bbox'][:2], b['bbox'][:2]) > 8
                                                                           for a, b in zip(observed, expected_entities)):
                            raise ValueError('未知物件位置或外观发生变化')
                    if data.get('cage_cells'):
                        matched = match_cage_frame(latest, board, pigs, state, directions, grid, data['cage_cells'], data.get('cage_unknown', ()), locks, exits,
                                                   data.get('blockers', ()) if data.get('cage_blue_markers') else (), data.get('cage_blue_markers', ()))
                    elif data.get('scissors') or data.get('ropes'):
                        matched = match_scissors_frame(latest, board, pigs, state, directions, grid,
                                                       set(data.get('scissors', ())), set(data.get('ropes', ())),
                                                       ducks if tracks_ducks else None)
                    else:
                        matched = match_frame(latest, board, pigs, state, directions, grid, locks, exits, ducks if tracks_ducks else None)
                except ValueError:
                    matched = None
                if matched is not None:
                    break
                time.sleep(.4)
            if matched is None:
                raise ValueError('现场棋盘与锁猪计划不一致')
            if pending is not None:
                confirmed.append(pending)
                app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
                pending = None
                if stage_should_stop is not None and stage_should_stop([entry['action'] for entry in confirmed]):
                    app.save_or_error(output / 'stage-final.png', latest)
                    app.player.write_json(output / 'result.json', {'status': 'stage_complete', 'confirmed': len(confirmed), 'screenshot': 'stage-final.png'})
                    return 'stage_complete'
            index = action['index']
            pig = matched.get(tuple(action['from']))
            if pig is None or state[index] != tuple(action['from']):
                raise ValueError('计划目标无法唯一匹配')
            center = pig['center']
            x, y, width, height = board
            if not (x <= center[0] < x + width and y <= center[1] < y + height):
                raise ValueError('目标不在棋盘区域')
            pending = {'action': action, 'observed_center': center}
            adapter.click(center, latest.shape[1::-1])
            state[index] = tuple(action['to']) if action['to'] is not None else None
            exits += int(action['exited']) + len(action.get('duck_departures', ()))
            if tracks_ducks:
                ducks = tuple(tuple(cell) for cell in action['ducks_after'])
            time.sleep(wait)
        if partial:
            for _ in range(35):
                latest = adapter.capture()
                try:
                    if data.get('cage_cells'):
                        final_match = match_cage_frame(latest, board, pigs, state, directions, grid, data['cage_cells'], data.get('cage_unknown', ()), locks, exits,
                                                       data.get('blockers', ()) if data.get('cage_blue_markers') else (), data.get('cage_blue_markers', ()))
                    elif data.get('scissors') or data.get('ropes'):
                        final_match = match_scissors_frame(latest, board, pigs, state, directions, grid,
                                                           set(data.get('scissors', ())), set(data.get('ropes', ())),
                                                           ducks if tracks_ducks else None)
                    else:
                        final_match = match_frame(latest, board, pigs, state, directions, grid, locks, exits, ducks if tracks_ducks else None)
                    expected_entities = data.get('unknown_entities', [])
                    observed = app.auto.find_blue_elephants(latest, board) if expected_entities else []
                    if final_match is not None and (not expected_entities or (len(observed) == len(expected_entities) and all(
                            math.dist(a['bbox'][:2], b['bbox'][:2]) <= 8 for a, b in zip(observed, expected_entities)))):
                        break
                except ValueError:
                    pass
                time.sleep(.4)
            else:
                raise ValueError('阶段结束画面与计划不一致')
            if pending:
                confirmed.append(pending)
                app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
                pending = None
            app.save_or_error(output / 'stage-final.png', latest)
            app.player.write_json(output / 'result.json', {'status': 'stage_complete', 'confirmed': len(confirmed), 'screenshot': 'stage-final.png'})
            return 'stage_complete'
        victory = app.await_victory(adapter, output)
        if victory is None:
            raise ValueError('无法确认通关画面')
        latest = victory
        if pending:
            confirmed.append(pending)
            app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
        recorded = [item['action'] for item in confirmed]
        app.save_or_error(output / 'solution-order.png', app.auto.render_solution(image, pigs, recorded))
        app.player.write_json(output / 'solution-order.json', {'status': 'victory_verified', 'steps': recorded})
        app.player.write_json(output / 'result.json', {'status': 'victory', 'confirmed': len(recorded), 'victory': 'victory.png'})
        return 'victory'
    except (Exception, KeyboardInterrupt) as error:
        app.save_or_error(output / 'interrupted.png', latest)
        app.player.write_json(output / 'result.json', {'status': 'interrupted', 'confirmed': len(confirmed),
                              'pending_action': pending, 'reason': str(error)})
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--level', required=True, type=int)
    parser.add_argument('--window-id', required=True, type=app.player.extract.parse_window_id)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--output', type=Path, help='新建执行证据目录，不覆盖已有文件')
    args = parser.parse_args()
    data = json.loads(args.plan.read_text(encoding='utf8'))
    output = args.output or ROOT / 'docs/references/pig-game/play-runs' / f"level-{args.level:02d}-locked-{datetime.now():%Y%m%d-%H%M%S-%f}"
    print('锁猪关卡资料:', output, flush=True)
    adapter = app.player.X11Adapter(args.display, args.window_id)
    try:
        print('结果:', run(adapter, data, data['board'], output), flush=True)
    finally:
        adapter.close()


if __name__ == '__main__':
    main()
