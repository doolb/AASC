#!/usr/bin/env python3
"""校验锁猪关卡多阶段的实际动作并合并到初始布局图。"""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil

import cv2

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('lock_merge_auto', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def merge(layout_file, events, output, check_prefix=False):
    """仅接收已确认动作；任何不合法、未解锁或未通关的情况都停止。"""
    layout_file = Path(layout_file)
    layout = json.loads(layout_file.read_text(encoding='utf-8'))
    grid, pigs = layout['grid'], layout['pigs'] + [item['pig'] for item in layout.get('locks', [])]
    state, directions = app.player.solver.prepare(pigs, grid[3], grid[4])
    state = list(state)
    lengths = [pig.get('length', 2) for pig in pigs]
    by_id = {pig['id']: i for i, pig in enumerate(pigs)}
    locks = {entry['pig']['id']: entry['unlock_after'] for entry in layout.get('locks', [])}
    exits, actions, victory = 0, [], None
    for kind, path in events:
        if kind == 'action':
            record = json.loads(path.read_text(encoding='utf-8'))
            if record.get('status') != 'confirmed':
                raise ValueError('单步动作尚未确认: ' + str(path))
            records = [(path, record)]
        elif kind == 'stage':
            result = json.loads((path / 'result.json').read_text(encoding='utf-8'))
            files = sorted(path.glob('action-*.json'))
            if result.get('status') not in ('stage_complete', 'victory') or result.get('confirmed') != len(files):
                raise ValueError('阶段未确认完成: ' + str(path))
            if result['status'] == 'victory':
                victory = path / result.get('victory', 'victory.png')
            records = [(file, json.loads(file.read_text(encoding='utf-8'))) for file in files]
        else:
            raise ValueError('事件必须为 stage 或 action')
        for source, record in records:
            action = record['action']
            pig_id = action['pig_id']
            index = by_id.get(pig_id)
            if index is None or state[index] is None or exits < locks.get(pig_id, 0):
                raise ValueError('动作目标不存在、已离场或仍被锁定')
            destination = tuple(action['to']) if action['to'] is not None else None
            proposed = (action['exited'], index, destination, action['travel_cells'])
            if (tuple(action['from']) != state[index] or action['direction'] != directions[index]
                    or proposed not in app.player.solver.actions(state, directions, grid[3], grid[4], lengths=lengths)):
                raise ValueError('动作无法从已确认状态重放: ' + str(source))
            state[index] = destination
            exits += int(action['exited'])
            actions.append({**action, 'index': index, 'source': str(source)})
    if check_prefix:
        return len(actions)
    if victory is None or not victory.is_file() or any(position is not None for position in state):
        raise ValueError('缺少胜利证据或仍有小猪未离场')
    image = cv2.imread(str(layout_file.parent / 'original.png'))
    if image is None:
        raise ValueError('缺少初始画面')
    output.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(layout_file.parent / 'original.png', output / 'original.png')
    shutil.copyfile(victory, output / 'victory.png')
    if not cv2.imwrite(str(output / 'solution-order.png'), app.auto.render_solution(image, pigs, actions)):
        raise OSError('无法保存步骤图')
    app.player.write_json(output / 'solution-order.json', {'status': 'victory_verified', 'steps': actions})
    return len(actions)


def main():
    parser = argparse.ArgumentParser(description='合并锁猪关卡的已确认阶段')
    parser.add_argument('--layout', required=True, type=Path)
    parser.add_argument('--event', action='append', required=True, help='stage=目录 或 action=确认记录')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--check-prefix', action='store_true', help='只验证已有阶段，不生成通关产物')
    args = parser.parse_args()
    events = []
    for value in args.event:
        kind, separator, path = value.partition('=')
        if not separator or kind not in ('stage', 'action'):
            parser.error('事件必须是 stage=目录 或 action=确认记录')
        events.append((kind, Path(path)))
    print('已验证步骤:', merge(args.layout, events, args.output, check_prefix=args.check_prefix))


if __name__ == '__main__':
    main()
