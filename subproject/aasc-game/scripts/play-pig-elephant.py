#!/usr/bin/env python3
"""独立复核矩形小象完整计划，在指定 X11 窗口逐步核对执行。"""
import argparse
from datetime import datetime
import importlib.util
import json
import math
from pathlib import Path
import time

import cv2

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('elephant_play_auto', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def run(adapter, level, output, layout_path, candidate_path):
    layout = json.loads(layout_path.read_text())
    candidate = json.loads(candidate_path.read_text())
    pigs, grid = layout['pigs'], tuple(layout['grid'])
    if layout.get('ducks') or len(pigs) < 2 or pigs[-1].get('kind') != 'elephant':
        raise ValueError('需要无鸭布局，且最后一个物件为小象')
    solution = app.player.solver.validate_candidate_plan(pigs, [], grid[3], grid[4], candidate['actions'])
    if solution['status'] != 'solved':
        raise ValueError('未得到经独立复核的完整计划')
    expected = list(solution['initial'])
    directions = [pig['direction'] for pig in pigs]
    lengths = [pig.get('length', 2) for pig in pigs]
    output.mkdir(parents=True, exist_ok=False)
    image = adapter.capture()
    board = app.player.extract.valid_board(image, None)
    elephants = app.auto.find_blue_elephants(image, board)
    if len(elephants) != 1:
        raise ValueError('初始画面的小象候选不唯一')
    origin = elephants[0]['bbox']
    elephant_initial = expected[-1]
    app.save_or_error(output / 'original.png', image)
    app.player.write_json(output / 'level-reviewed.json', layout)
    app.player.write_json(output / 'plan.json', {'status': 'solved', 'model': 'rectangular_elephant_hypothesis',
                          'actions': solution['actions'], 'grid': grid})
    image_marked = app.player.extract.annotate(image, pigs[:-1], board, [])
    cv2.imwrite(str(output / 'annotated.png'), app.auto.mark_unknown_entities(image_marked, elephants))
    latest = image
    pending = None
    confirmed = []
    try:
        for number, action in enumerate(solution['actions'], 1):
            matched = None
            target_elephant = None
            for _ in range(25):
                latest = adapter.capture()
                if app.auto.ui_state(latest) != 'unknown':
                    break
                detected, _, _ = app.player.extract.identify(latest, board)
                objects = app.auto.find_blue_elephants(latest, board)
                try:
                    matched = app.player.match_expected(detected, expected[:-1], directions[:-1], grid, lengths[:-1])
                except ValueError:
                    matched = None
                position = expected[-1]
                if position is None:
                    object_ok = not objects
                else:
                    predicted = (origin[0] + (position[0] - elephant_initial[0]) * grid[2],
                                 origin[1] + (position[1] - elephant_initial[1]) * grid[2])
                    object_ok = len(objects) == 1 and math.dist(objects[0]['bbox'][:2], predicted) < 12
                    if object_ok:
                        target_elephant = objects[0]
                if matched is not None and object_ok:
                    break
                matched = None
                time.sleep(.4)
            if matched is None:
                raise ValueError(f'第 {number} 步前猪或小象状态与计划不符')
            if pending is not None:
                confirmed.append(pending)
                app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
                pending = None
            if action['index'] == len(pigs) - 1:
                if target_elephant is None:
                    raise ValueError('小象位置未确认')
                x, y, width, height = target_elephant['bbox']
                point = (x + width / 2, y + height / 2)
            else:
                target = matched.get(tuple(action['from']))
                if target is None:
                    raise ValueError('小猪目标未匹配')
                point = target['center']
            x, y, width, height = board
            if not (x <= point[0] < x + width and y <= point[1] < y + height):
                raise ValueError('点击目标不在棋盘范围')
            pending = {'action': action, 'observed_center': point}
            adapter.click(point, latest.shape[1::-1])
            expected[action['index']] = tuple(action['to']) if action['to'] is not None else None
            time.sleep(1.5)
        victory = app.await_victory(adapter, output)
        if victory is None:
            raise ValueError('未确认成功界面')
        if pending is not None:
            confirmed.append(pending)
            app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
            pending = None
        if len(confirmed) != len(solution['actions']):
            raise ValueError('确认动作数与计划不一致')
        actions = [item['action'] for item in confirmed]
        if not cv2.imwrite(str(output / 'solution-order.png'), app.auto.render_solution(image, pigs, actions)):
            raise OSError('无法保存步骤图')
        app.player.write_json(output / 'solution-order.json', {'status': 'victory_verified', 'steps': actions})
        app.player.write_json(output / 'result.json', {'status': 'victory', 'confirmed': len(confirmed)})
    except (Exception, KeyboardInterrupt) as error:
        app.save_or_error(output / 'interrupted.png', latest)
        app.player.write_json(output / 'result.json', {'status': 'interrupted', 'confirmed': len(confirmed),
                              'pending_action': pending, 'reason': str(error)})
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--level', type=int, required=True)
    parser.add_argument('--window-id', type=app.player.extract.parse_window_id, required=True)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--layout', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    args = parser.parse_args()
    output = ROOT / 'docs/references/pig-game/play-runs' / f"level-{args.level:02d}-elephant-run-{datetime.now():%Y%m%d-%H%M%S-%f}"
    print('完整计划记录:', output, flush=True)
    adapter = app.player.X11Adapter(args.display, args.window_id)
    try:
        run(adapter, args.level, output, args.layout, args.candidate)
    finally:
        adapter.close()


if __name__ == '__main__':
    main()
