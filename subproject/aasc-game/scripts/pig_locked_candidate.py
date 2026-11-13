#!/usr/bin/env python3
"""构造并验证含锁猪的完整候选计划，不访问游戏窗口。"""
import importlib.util
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def locked_module():
    spec = importlib.util.spec_from_file_location('pig_locked_validation', ROOT / 'scripts/play-pig-locked.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_layout(pigs, grid, locks, board, ducks=()):
    """只有外观模板能确定方向和计数时才创建猪占格。"""
    result = list(pigs)
    thresholds = {}
    x0, y0, step, columns, rows = grid
    next_id = max((pig['id'] for pig in pigs), default=0) + 1
    for lock in locks:
        direction = lock.get('direction')
        threshold = lock.get('unlock_exits')
        if direction not in ('north', 'south', 'east', 'west') or type(threshold) is not int:
            raise ValueError('锁猪方向或解锁计数尚未识别')
        cx, cy = lock['center']
        vertical = direction in ('north', 'south')
        col = round((cx - x0) / step - (0 if vertical else .5))
        row = round((cy - y0) / step - (.5 if vertical else 0))
        cells = [[col, row], [col + (not vertical), row + vertical]]
        cells = [[int(x), int(y)] for x, y in cells]
        result.append({'id': next_id, 'direction': direction, 'length': 2, 'center': [cx, cy],
                       'grid': {'col': col, 'row': row, 'cells': cells}})
        thresholds[next_id] = threshold
        next_id += 1
    module = locked_module()
    module.app.player.solver.prepare(result, columns, rows)
    return {'grid': list(grid), 'pigs': result, 'locks': thresholds, 'board': list(board), 'ducks': [list(cell) for cell in ducks]}


def solve(data, seeds=(17, 1, 2, 4, 5, 6, 7, 8, 9), allow_partial=False):
    """离线遍历后交独立 Python 实现重放；不接受不完整或提前解锁的候选。"""
    compiler = shutil.which('g++')
    if compiler is None:
        raise ValueError('缺少快速搜索编译器')
    grid, pigs = data['grid'], data['pigs']
    columns, rows = grid[3:]
    if columns * rows > 255 or len(pigs) > 250:
        raise ValueError('锁猪搜索规模超限')
    locks = {int(key): value for key, value in data['locks'].items()}
    ducks = tuple(tuple(cell) for cell in data.get('ducks', []))
    blockers = tuple(tuple(cell) for cell in data.get('blockers', []))
    if len(ducks) > 63:
        raise ValueError('鸭子数量超限')
    lines = [f'{len(pigs)} {columns} {rows} {len(ducks)} {len(blockers)}']
    for pig in pigs:
        position = pig['grid']
        lines.append(f"{position['col']} {position['row']} {pig['direction']} {pig.get('length', 2)} {pig.get('width', 1)} {pig['id']} {locks.get(pig['id'], 0)} {int(pig['id'] in data.get('scissors', []))} {int(pig['id'] in data.get('ropes', []))}")
    lines.extend(f'{x} {y}' for x, y in ducks)
    lines.extend(f'{x} {y}' for x, y in blockers)
    payload = '\n'.join(lines) + '\n'
    module = locked_module()
    with tempfile.TemporaryDirectory(prefix='aasc-pig-locked-') as directory:
        executable = Path(directory) / 'search'
        try:
            subprocess.run([compiler, '-O3', '-std=c++17', str(ROOT / 'scripts/pig_fast_locked_solver.cpp'), '-o', str(executable)],
                           check=True, capture_output=True, timeout=45)
            for seed in seeds:
                print(f'锁猪完整搜索：动作顺序 {seed}', flush=True)
                try:
                    found = subprocess.run([str(executable), str(seed)], input=payload, text=True, capture_output=True, timeout=55)
                except subprocess.TimeoutExpired:
                    continue
                if found.returncode != 0 and not (allow_partial and found.returncode == 3):
                    continue
                state, directions = module.app.player.solver.prepare(pigs, columns, rows)
                state = list(state)
                lengths = [pig.get('length', 2) for pig in pigs]
                widths = [pig.get('width', 1) for pig in pigs]
                remaining, initially_gone = module.app.player.solver.settle_ducks(state, directions, ducks, columns, rows, lengths, blockers, widths)
                if initially_gone:
                    raise ValueError('初始鸭子模型与画面不一致')
                actions = []
                for line in found.stdout.splitlines():
                    index, dest, distance, exited = map(int, line.split())
                    if not 0 <= index < len(pigs) or state[index] is None or exited not in (0, 1) or not -1 <= dest < columns * rows:
                        raise ValueError('锁猪候选动作无效')
                    target = None if dest == -1 else [dest % columns, dest // columns]
                    action = {'index': index, 'pig_id': pigs[index]['id'], 'direction': directions[index],
                              'from': list(state[index]), 'to': target, 'exited': bool(exited), 'travel_cells': distance}
                    state[index] = tuple(target) if target is not None else None
                    if ducks:
                        remaining, gone = module.app.player.solver.settle_ducks(state, directions, remaining, columns, rows, lengths, blockers, widths)
                        action.update({'ducks_after': remaining, 'duck_departures': gone})
                    actions.append(action)
                partial = found.returncode == 3
                answer = dict(data, actions=actions, status='partial' if partial else 'solved')
                if not actions:
                    continue
                module.validate_plan(answer, require_complete=not partial)
                return answer
        except (OSError, subprocess.SubprocessError) as error:
            raise ValueError('锁猪搜索失败：' + str(error)) from error
    raise ValueError('锁猪完整搜索达到上限')
