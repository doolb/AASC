#!/usr/bin/env python3
"""将已确认的阶段动作按初始身份合并到同一张顺序图。"""
import argparse
from datetime import datetime
import importlib.util
import json
import math
from pathlib import Path
import shutil

import cv2

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('merge_pig_auto', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def center(position, pig, grid):
    if position is None:
        return None
    col, row = position
    ox, oy, step = grid[:3]
    half = (pig.get('length', 2) - 1) / 2
    horizontal = pig['direction'] in ('east', 'west')
    return (ox + (col + (half if horizontal else 0)) * step,
            oy + (row + (0 if horizontal else half)) * step)


def merge(events, output):
    if not events or events[0][0] != 'stage':
        raise ValueError('必须以初始阶段开始')
    initial_path = events[0][1]
    first = json.loads((initial_path / 'level.json').read_text())
    initial_pigs = first['pigs']
    initial_grid = first.get('grid', first.get('grid_parameters'))
    tracked = {pig['id']: {'center': center((pig['grid']['col'], pig['grid']['row']), pig, initial_grid),
                           'direction': pig['direction'], 'length': pig.get('length', 2)} for pig in initial_pigs}
    entities = first.get('other_entities', [])
    elephants = [entity for entity in entities if entity['kind'] == 'blue_elephant_candidate']
    if len(elephants) != 1:
        raise ValueError('初始阶段应恰有一个小象候选')
    x, y, width, height = elephants[0]['bbox']
    elephant_id = max(tracked) + 1
    drawing = list(initial_pigs) + [{'id': elephant_id, 'center': [x + width / 2, y + height / 2]}]
    actions = []
    last_victory = None
    for kind, path in events:
        if kind == 'object':
            obj = json.loads(path.read_text())
            before, after = obj['before'], obj['after']
            reconciliation = path.parent / 'object-reconciliation.json'
            if reconciliation.exists():
                resolution = json.loads(reconciliation.read_text())
                if (resolution.get('status') != 'delayed_exit_confirmed'
                        or resolution.get('initial_action') != path.name
                        or not (path.parent / resolution.get('screenshot', '')).is_file()):
                    raise ValueError('小象延迟离场复核记录不一致')
                after = []
            if len(before) != 1 or len(after) > 1:
                raise ValueError('小象操作证据不完整')
            distance = 0 if not after else round(math.dist(before[0]['bbox'][:2], after[0]['bbox'][:2]) / initial_grid[2])
            if after and distance < 1:
                raise ValueError('小象操作未确认移动')
            actions.append({'pig_id': elephant_id, 'kind': 'elephant', 'exited': not after,
                            'travel_cells': distance, 'source': str(path)})
            continue
        if kind != 'stage':
            raise ValueError('事件类型必须是 stage 或 object')
        reviewed = path / 'level-reviewed.json'
        data = json.loads((reviewed if reviewed.exists() else path / 'level.json').read_text())
        grid = data.get('grid', data.get('grid_parameters'))
        pigs = data['pigs']
        remaining = {key for key, value in tracked.items() if value['center'] is not None}
        if len(pigs) != len(remaining):
            raise ValueError('阶段间小猪数量不一致')
        mapping = {}
        for pig in pigs:
            point = center((pig['grid']['col'], pig['grid']['row']), pig, grid)
            candidates = [key for key in remaining if tracked[key]['direction'] == pig['direction']
                          and tracked[key]['length'] == pig.get('length', 2)
                          and math.dist(tracked[key]['center'], point) < grid[2] * 0.4]
            if len(candidates) != 1:
                raise ValueError(f"阶段小猪 {pig['id']} 无法唯一映射到初始布局")
            mapping[pig['id']] = candidates[0]
            remaining.remove(candidates[0])
        source_pigs = {pig['id']: pig for pig in pigs}
        result = json.loads((path / 'result.json').read_text())
        files = sorted(path.glob('action-*.json'))
        confirmed_count = result.get('confirmed')
        reconciliation = path / 'reconciliation.json'
        if reconciliation.exists():
            resolution = json.loads(reconciliation.read_text())
            if (resolution.get('status') != 'pending_action_confirmed' or result.get('status') != 'interrupted'
                    or resolution.get('confirmed') != confirmed_count + 1 or len(files) != confirmed_count + 1
                    or json.loads(files[-1].read_text()) != result.get('pending_action')):
                raise ValueError('阶段中断核对记录不一致')
            confirmed_count = resolution['confirmed']
        if confirmed_count != len(files):
            raise ValueError('阶段确认动作数量不一致')
        for file in files:
            record = json.loads(file.read_text())
            action = record['action']
            source_id = action['pig_id']
            original_id = mapping[source_id]
            pig = source_pigs[source_id]
            actual_start = center(action['from'], pig, grid)
            if tracked[original_id]['center'] is None or math.dist(tracked[original_id]['center'], actual_start) >= grid[2] * 0.4:
                raise ValueError('阶段动作起点与已确认状态不一致')
            tracked[original_id]['center'] = center(action['to'], pig, grid)
            actions.append({**action, 'pig_id': original_id, 'source': str(file)})
        if result['status'] == 'victory':
            last_victory = path / 'victory.png'
    if last_victory is None or not last_victory.exists() or any(item['center'] is not None for item in tracked.values()):
        raise ValueError('缺少通关画面或仍有小猪未确认离场')
    output.mkdir(parents=True, exist_ok=False)
    image = cv2.imread(str(initial_path / 'original.png'))
    if image is None:
        raise ValueError('初始画面不存在')
    shutil.copyfile(initial_path / 'original.png', output / 'original.png')
    shutil.copyfile(last_victory, output / 'victory.png')
    if not cv2.imwrite(str(output / 'solution-order.png'), app.auto.render_solution(image, drawing, actions)):
        raise OSError('无法保存合并步骤图')
    app.player.write_json(output / 'solution-order.json', {'status': 'victory_verified', 'steps': actions,
                          'elephant_id': elephant_id, 'note': '小象以独立物件编号标记'})
    return len(actions)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--event', action='append', required=True, help='按实际顺序指定 stage=目录 或 object=证据 JSON')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    events = []
    for event in args.event:
        kind, separator, path = event.partition('=')
        if not separator or kind not in ('stage', 'object'):
            parser.error('事件格式必须是 stage=目录 或 object=证据 JSON')
        events.append((kind, Path(path)))
    print('已合并确认步骤:', merge(events, args.output))


if __name__ == '__main__':
    main()
