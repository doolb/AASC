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


def validate_plan(data, require_complete=True):
    """独立重放所有动作，禁止提前操作锁猪或接受不完整终态。"""
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
    state, directions = app.player.solver.prepare(pigs, grid[3], grid[4])
    state = list(state)
    locks = {int(key): int(value) for key, value in data.get('locks', {}).items()}
    if any(key not in {pig['id'] for pig in pigs} or value < 0 for key, value in locks.items()):
        raise ValueError('锁条件无效')
    lengths = [pig.get('length', 2) for pig in pigs]
    widths = [pig.get('width', 1) for pig in pigs]
    blockers = app.player.solver.validate_blockers(data.get('blockers', ()), state, directions, lengths, grid[3], grid[4], (), widths)
    exits = 0
    for action in data['actions']:
        index = action['index']
        if type(index) is not int or not 0 <= index < len(pigs) or state[index] is None:
            raise ValueError('计划目标无效')
        pig = pigs[index]
        if exits < locks.get(pig['id'], 0):
            raise ValueError('锁猪尚未解锁')
        destination = tuple(action['to']) if action['to'] is not None else None
        candidate = (action['exited'], index, destination, action['travel_cells'])
        if (type(action['exited']) is not bool or action['pig_id'] != pig['id']
                or action['direction'] != directions[index] or tuple(action['from']) != state[index]
                or candidate not in app.player.solver.actions(state, directions, grid[3], grid[4], blockers=blockers, lengths=lengths, widths=widths)):
            raise ValueError('计划动作不合法')
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


def run(adapter, data, board, output, wait=1.5, stage_should_stop=None):
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
                    if data.get('scissors') or data.get('ropes'):
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
                    if data.get('scissors') or data.get('ropes'):
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
    args = parser.parse_args()
    data = json.loads(args.plan.read_text(encoding='utf8'))
    output = ROOT / 'docs/references/pig-game/play-runs' / f"level-{args.level:02d}-locked-{datetime.now():%Y%m%d-%H%M%S-%f}"
    print('锁猪关卡资料:', output, flush=True)
    adapter = app.player.X11Adapter(args.display, args.window_id)
    try:
        print('结果:', run(adapter, data, data['board'], output), flush=True)
    finally:
        adapter.close()


if __name__ == '__main__':
    main()
