#!/usr/bin/env python3
"""锁猪和固定未知物件的有界阶段搜索及续跑。"""
import argparse
import copy
from datetime import datetime
import importlib.util
import json
import math
from pathlib import Path
import time
import cv2

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('hint_runner', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def matching(executor, image, data, state, directions, exits):
    """先核对固定物件，再核对全部普通猪及仍锁定的猪。"""
    expected = data.get('unknown_entities', [])
    if expected:
        observed = app.auto.find_blue_elephants(image, data['board'])
        if len(observed) != len(expected) or any(math.dist(a['bbox'][:2], b['bbox'][:2]) > 8 for a, b in zip(observed, expected)):
            return None
    locks = {int(k): v for k, v in data.get('locks', {}).items()}
    return executor.match_frame(image, data['board'], data['pigs'], state, directions, data['grid'], locks, exits)


def elephant_path_clear(data):
    """仅对已复核朝向的小象，用视觉框投影通道并检查猪占格。"""
    entities = data.get('unknown_entities', [])
    direction = data.get('object_direction')
    if len(entities) != 1 or direction not in ('north', 'south', 'east', 'west'):
        return False
    x, y, width, height = entities[0]['bbox']
    x0, y0, step, columns, rows = data['grid']
    occupied = {tuple(cell) for pig in data['pigs'] for cell in pig['grid']['cells']}
    for col, row in occupied:
        cx, cy = x0 + col * step, y0 + row * step
        if direction == 'west' and cx < x and y <= cy <= y + height:
            return False
        if direction == 'east' and cx > x + width and y <= cy <= y + height:
            return False
        if direction == 'north' and cy < y and x <= cx <= x + width:
            return False
        if direction == 'south' and cy > y + height and x <= cx <= x + width:
            return False
    # 其他固定物件无法区分归属时，不自动认为路径开放。
    own = {tuple(cell) for cell in entities[0].get('estimated_grid_cells', ())}
    if any(tuple(cell) not in own for cell in data.get('blockers', ())):
        return False
    return True


def release_elephant(adapter, executor, data, output):
    """只在全盘匹配且通路开放时操作；确认离场后再清除静态阻挡。"""
    state, directions = app.player.solver.prepare(data['pigs'], data['grid'][3], data['grid'][4])
    image = adapter.capture()
    output.mkdir(parents=True, exist_ok=False)
    app.save_or_error(output / 'before.png', image)
    if not elephant_path_clear(data) or matching(executor, image, data, state, directions, 0) is None:
        raise ValueError('小象通路或现场布局无法确认')
    entity = data['unknown_entities'][0]
    x, y, width, height = entity['bbox']
    center = [round(x + width / 2), round(y + height / 2)]
    app.player.write_json(output / 'pending.json', {'center': center, 'direction': data['object_direction']})
    adapter.click(center, image.shape[1::-1])
    time.sleep(1.5)
    for _ in range(12):
        image = adapter.capture()
        observed = app.auto.find_blue_elephants(image, data['board'])
        locks = {int(key): value for key, value in data.get('locks', {}).items()}
        if not observed and executor.match_frame(image, data['board'], data['pigs'], state, directions, data['grid'], locks, 0) is not None:
            app.save_or_error(output / 'after.png', image)
            result = copy.deepcopy(data)
            result['unknown_entities'] = []
            result['blockers'] = []
            app.player.write_json(output / 'next-layout.json', result)
            app.player.write_json(output / 'result.json', {'status': 'confirmed_exit'})
            return result
        time.sleep(.5)
    app.save_or_error(output / 'interrupted.png', image)
    raise ValueError('小象操作后未确认离场及猪布局')


def updated_layout(data, state, index, exited):
    """按已核对的新状态更新网格、锁的剩余计数与视觉标注位置。"""
    result = copy.deepcopy(data)
    result['locks'] = {str(key): max(0, value - int(exited)) for key, value in data.get('locks', {}).items()}
    kept = []
    for i, pig in enumerate(result['pigs']):
        if state[i] is None:
            continue
        if i == index:
            col, row = state[i]
            horizontal = pig['direction'] in ('east', 'west')
            length = pig.get('length', 2)
            pig['grid'] = {'col': col, 'row': row, 'cells': [[col + (j if horizontal else 0), row + (0 if horizontal else j)] for j in range(length)]}
            grid = data['grid']
            center = [grid[0] + (col + .5 * (length - 1) * horizontal) * grid[2],
                      grid[1] + (row + .5 * (length - 1) * (not horizontal)) * grid[2]]
            dx, dy = round(center[0] - pig['center'][0]), round(center[1] - pig['center'][1])
            pig['center'] = center
            for key in ('bbox', 'visual_bbox'):
                if key in pig:
                    pig[key][0] += dx
                    pig[key][1] += dy
        kept.append(pig)
    result['pigs'] = kept
    remaining_ids = {pig['id'] for pig in kept}
    result['locks'] = {key: value for key, value in result['locks'].items() if int(key) in remaining_ids}
    result['scissors'] = [value for value in data.get('scissors', []) if value in remaining_ids]
    result['ropes'] = [value for value in data.get('ropes', []) if value in remaining_ids] if result['scissors'] else []
    return result


def apply_stage(data, actions):
    """逐步重建已验证阶段的后续布局，保持小猪身份与锁计数。"""
    result = data
    for action in actions:
        state, _ = app.player.solver.prepare(result['pigs'], result['grid'][3], result['grid'][4])
        state = list(state)
        index = next(i for i, pig in enumerate(result['pigs']) if pig['id'] == action['pig_id'])
        if list(state[index]) != list(action['from']):
            raise ValueError('阶段动作与重建状态不一致')
        state[index] = tuple(action['to']) if action['to'] is not None else None
        result = updated_layout(result, state, index, action['exited'])
    return result


def main():
    parser = argparse.ArgumentParser(description='搜索锁猪关卡，超限时执行已独立验证的阶段并重新搜索')
    parser.add_argument('--layout', type=Path, required=True)
    parser.add_argument('--window-id', type=app.player.extract.parse_window_id, required=True)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--max-stages', type=int, default=100)
    args = parser.parse_args()
    if args.max_stages < 1:
        parser.error('max-stages 必须为正数')
    data = json.loads(args.layout.read_text(encoding='utf-8'))
    if data.get('ducks'):
        parser.error('阶段续跑模式暂不处理鸭子')
    adapter = app.player.X11Adapter(args.display, args.window_id)
    executor = app.locked_candidate.locked_module()
    try:
        for stage in range(args.max_stages):
            output = ROOT / 'docs/references/pig-game/play-runs' / f"lock-hint-{datetime.now():%Y%m%d-%H%M%S-%f}"
            if elephant_path_clear(data):
                print('小象通路已开放，核对现场并尝试离场：', output, flush=True)
                data = release_elephant(adapter, executor, data, output)
                continue
            plan = app.locked_candidate.solve(data, seeds=(17,), allow_partial=True)
            output.mkdir(parents=True, exist_ok=False)
            app.player.write_json(output / 'plan.json', plan)
            print(f"第 {stage + 1} 阶段：已验证 {len(plan['actions'])} 步，状态 {plan['status']}：{output}", flush=True)
            status = executor.run(adapter, plan, data['board'], output / 'execution',
                                  stage_should_stop=lambda actions: elephant_path_clear(apply_stage(data, actions)))
            if status == 'victory':
                return 0
            if status != 'stage_complete':
                raise ValueError('阶段未确认完成')
            confirmed = [json.loads(path.read_text(encoding='utf-8'))['action']
                         for path in sorted((output / 'execution').glob('action-*.json'))]
            data = apply_stage(data, confirmed)
            app.player.write_json(output / 'next-layout.json', data)
        raise ValueError('已达到阶段上限')
    except (OSError, ValueError, RuntimeError) as error:
        print('阶段续跑已停止：', error, flush=True)
        return 1
    finally:
        adapter.close()


if __name__ == '__main__':
    raise SystemExit(main())
