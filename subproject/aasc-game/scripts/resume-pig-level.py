#!/usr/bin/env python3
"""从已中断的完整计划续跑，并将实际确认步骤合并到原始布局图。"""
import argparse
import importlib.util
import json
import shutil
import time
from datetime import datetime
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pig_auto_resume', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def apply_action(state, ducks, action):
    """校验动作确实接在当前状态后，返回计划的下一状态。"""
    index = action['index']
    if not 0 <= index < len(state) or state[index] != tuple(action['from']):
        raise ValueError('动作与已确认棋盘状态不连续')
    following = list(state)
    following[index] = tuple(action['to']) if action['to'] is not None else None
    return following, {tuple(cell) for cell in action.get('ducks_after', ducks)}


def match_frame(image, state, directions, ducks, grid, board, lengths=None, filter_outside_yellow=False):
    """同时核对猪与鸭，任何识别不清都不视为匹配。"""
    if app.auto.ui_state(image) != 'unknown':
        return None
    try:
        detected, _, _ = app.player.extract.identify(image, board)
        matched = app.player.match_expected(detected, state, directions, grid, lengths)
        yellow = app.auto.find_yellow_ducks(image, board)
        if filter_outside_yellow:
            yellow, _ = app.filter_yellow_candidates(yellow, grid, app.player.with_grid(detected, grid))
        actual_ducks = app.duck_cells(yellow, grid)
        return matched if matched is not None and actual_ducks == ducks else None
    except ValueError:
        return None


def resume(adapter, source, output, wait_seconds=1.5, filter_outside_yellow=False):
    source, output = Path(source), Path(output)
    previous = json.loads((source / 'result.json').read_text(encoding='utf-8'))
    if previous['status'] != 'interrupted':
        raise ValueError('仅可续跑已中断的计划')
    plan = json.loads((source / 'plan.json').read_text(encoding='utf-8'))
    filter_outside_yellow = filter_outside_yellow or plan.get('filter_outside_yellow', False)
    reviewed = json.loads((source / 'level-reviewed.json').read_text(encoding='utf-8'))
    pigs, grid, actions = reviewed['pigs'], tuple(reviewed['grid']), plan['actions']
    lengths = [pig.get('length', 2) for pig in pigs]
    state, directions = app.player.solver.prepare(pigs, grid[3], grid[4])
    state = list(state)
    ducks = {tuple(cell) for cell in plan.get('initial_ducks', [])}
    count = previous['confirmed']
    if count > len(actions):
        raise ValueError('确认步骤数超过计划')
    confirmed = []
    for number in range(1, count + 1):
        saved = json.loads((source / f'action-{number:03d}.json').read_text(encoding='utf-8'))
        if saved['action'] != actions[number - 1]:
            raise ValueError('已确认步骤与计划不一致')
        state, ducks = apply_action(state, ducks, saved['action'])
        confirmed.append(saved)
    pending = previous.get('pending_action')
    if pending and (count >= len(actions) or pending['action'] != actions[count]):
        raise ValueError('待确认步骤与计划不一致')
    output.mkdir(parents=True, exist_ok=False)
    for name in ('original.png', 'annotated.png', 'level.json', 'level-reviewed.json', 'plan.json'):
        shutil.copyfile(source / name, output / name)
    shutil.copyfile(source / 'result.json', output / 'prior-result.json')
    for number in range(1, count + 1):
        shutil.copyfile(source / f'action-{number:03d}.json', output / f'action-{number:03d}.json')
    app.player.write_json(output / 'resume-source.json', {'source': str(source), 'confirmed_before_resume': count})
    image = cv2.imread(str(output / 'original.png'))
    if image is None:
        raise ValueError('原始图片无法读取')
    board = app.player.extract.valid_board(image, None)
    latest = image
    try:
        def match(image, current_state, current_ducks):
            if filter_outside_yellow:
                return match_frame(image, current_state, directions, current_ducks, grid, board, lengths, filter_outside_yellow=True)
            return match_frame(image, current_state, directions, current_ducks, grid, board, lengths)

        def finish_victory():
            nonlocal pending
            victory = app.await_victory(adapter, output)
            if victory is None:
                raise ValueError('未确认通关画面')
            if pending is not None:
                confirmed.append(pending)
                app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
                pending = None
            actual = [item['action'] for item in confirmed]
            if len(actual) != len(actions):
                raise ValueError('有效步骤数量与计划不一致')
            if not cv2.imwrite(str(output / 'solution-order.png'), app.auto.render_solution(image, pigs, actual)):
                raise OSError('无法保存顺序图')
            app.player.write_json(output / 'solution-order.json', {'status': 'victory_verified', 'steps': actual})
            app.player.write_json(output / 'result.json', {'status': 'victory', 'confirmed': len(actual), 'victory': 'victory.png'})
            return 'victory'

        if pending and len(confirmed) + 1 == len(actions):
            final_state, final_ducks = apply_action(state, ducks, pending['action'])
            if all(position is None for position in final_state) and not final_ducks:
                for _ in range(12):
                    latest = adapter.capture()
                    if app.auto.ui_state(latest) in ('victory', 'reward', 'ranking'):
                        return finish_victory()
                    time.sleep(0.4)
        next_state, next_ducks = None, None
        if pending:
            next_state, next_ducks = apply_action(state, ducks, pending['action'])
        before, after = None, None
        for _ in range(25):
            latest = adapter.capture()
            before = match(latest, state, ducks)
            after = match(latest, next_state, next_ducks) if pending else None
            if (before is not None) != (after is not None):
                break
            time.sleep(0.37)
        if bool(before is not None) == bool(after is not None):
            raise ValueError('现场不唯一匹配待确认动作的前后状态')
        if after is not None:
            state, ducks = next_state, next_ducks
            confirmed.append(pending)
            app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
        pending = None
        for action in actions[len(confirmed):]:
            matched = None
            for _ in range(25):
                latest = adapter.capture()
                matched = match(latest, state, ducks)
                if matched is not None:
                    break
                time.sleep(0.37)
            if matched is None:
                raise ValueError('当前猪鸭状态与计划不一致')
            if pending is not None:
                confirmed.append(pending)
                app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
            pos = tuple(action['from'])
            target = matched.get(pos)
            if target is None:
                raise ValueError('计划目标不在当前画面')
            x, y, w, h = board
            center = target['center']
            if not (x <= center[0] < x + w and y <= center[1] < y + h):
                raise ValueError('目标不在棋盘区域')
            pending = {'action': action, 'observed_center': center}
            adapter.click(center, latest.shape[1::-1])
            state, ducks = apply_action(state, ducks, action)
            time.sleep(wait_seconds)
        return finish_victory()
    except (Exception, KeyboardInterrupt) as error:
        app.save_or_error(output / 'interrupted.png', latest)
        app.player.write_json(output / 'result.json', {'status': 'interrupted', 'confirmed': len(confirmed),
                              'reason': str(error) or '操作已中断', 'pending_action': pending, 'screenshot': 'interrupted.png'})
        raise


def main():
    parser = argparse.ArgumentParser(description='从中断的猪关卡完整计划续跑')
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--window-id', required=True, type=app.player.extract.parse_window_id)
    parser.add_argument('--filter-outside-yellow', action='store_true', help='旧计划经复核后启用黄色候选过滤')
    args = parser.parse_args()
    output = args.source.parent / (args.source.name + '-resume-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    adapter = None
    try:
        adapter = app.player.X11Adapter(args.display, args.window_id)
        print('续跑资料：', output, flush=True)
        print('结果：', resume(adapter, args.source, output, filter_outside_yellow=args.filter_outside_yellow), flush=True)
    except (OSError, ValueError, RuntimeError, KeyError, KeyboardInterrupt) as error:
        print('续跑已停止：', str(error) or '操作已中断', flush=True)
        return 1
    finally:
        if adapter:
            adapter.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
