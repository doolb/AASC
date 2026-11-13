#!/usr/bin/env python3
"""编译并运行离线快速遍历，候选计划由既有 Python 模型独立复核。"""
import importlib.util
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('pig_fast_python_solver', ROOT / 'scripts/pig_level_solver.py')
solver = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(solver)


def decode_candidate(output, pigs, ducks, columns, rows, blockers=()):
    """将快速遍历输出转换为候选动作，最终逐步重放不得跳过。"""
    state, directions = solver.prepare(pigs, columns, rows)
    lengths = [pig.get('length', 2) for pig in pigs]
    widths = [pig.get('width', 1) for pig in pigs]
    remaining, departed = solver.settle_ducks(state, directions, ducks, columns, rows, lengths, blockers, widths)
    if departed:
        raise ValueError('初始鸭子预测与画面不一致')
    candidate = []
    for line in output.splitlines():
        fields = line.split()
        if len(fields) != 4 or len(candidate) >= 600:
            raise ValueError('快速搜索输出格式或长度无效')
        index, destination, distance, exited = (int(value) for value in fields)
        if not 0 <= index < len(pigs) or state[index] is None or exited not in (0, 1):
            raise ValueError('快速搜索输出目标或离场标志无效')
        if destination < -1 or destination >= columns * rows:
            raise ValueError('快速搜索输出位置越界')
        target = None if destination == -1 else (destination % columns, destination // columns)
        following = list(state)
        following[index] = target
        following = tuple(following)
        next_ducks, gone = solver.settle_ducks(following, directions, remaining, columns, rows, lengths, blockers, widths)
        candidate.append({'index': index, 'pig_id': pigs[index]['id'], 'direction': directions[index],
                          'from': state[index], 'to': target, 'exited': bool(exited), 'travel_cells': distance,
                          'duck_departures': gone, 'ducks_after': next_ducks})
        state, remaining = following, next_ducks
    return solver.validate_candidate_plan(pigs, ducks, columns, rows, candidate, blockers=blockers)


def solve_fast(pigs, ducks, columns, rows, seeds=(17, 3, 1, 2, 4, 5, 6, 7, 8, 9), blockers=()):
    """有编译器时限时遍历；失败只返回搜索未完成，绝不宣称无解。"""
    compiler = shutil.which('g++')
    if compiler is None or len(ducks) > 63 or columns * rows > 255 or len(pigs) > 250:
        return {'status': 'search_limit', 'states': 0, 'actions': [], 'reason': '快速搜索依赖或规模不适用'}
    initial, directions = solver.prepare(pigs, columns, rows)
    blockers = solver.validate_blockers(blockers, initial, directions, [p.get('length', 2) for p in pigs], columns, rows, ducks, [p.get('width', 1) for p in pigs])
    try:
        lines = [f'{len(pigs)} {columns} {rows} {len(ducks)} {len(blockers)}']
        for pig in pigs:
            if type(pig['id']) is not int:
                raise ValueError('快速搜索仅支持整数猪编号')
            grid = pig['grid']
            lines.append(f"{grid['col']} {grid['row']} {pig['direction']} {pig.get('length', 2)} {pig.get('width', 1)} {pig['id']}")
        lines.extend(f'{x} {y}' for x, y in ducks)
        lines.extend(f'{x} {y}' for x, y in blockers)
        payload = '\n'.join(lines) + '\n'
        with tempfile.TemporaryDirectory(prefix='aasc-pig-fast-') as directory:
            executable = Path(directory) / 'pig-fast'
            subprocess.run([compiler, '-O3', '-std=c++17', str(ROOT / 'scripts/pig_fast_solver.cpp'), '-o', str(executable)],
                           check=True, capture_output=True, text=True, timeout=45)
            for seed in seeds:
                print(f'快速搜索：尝试动作顺序 {seed}', flush=True)
                try:
                    result = subprocess.run([str(executable), str(seed)], input=payload, text=True,
                                            capture_output=True, timeout=55)
                except subprocess.TimeoutExpired:
                    continue
                if result.returncode != 0:
                    continue
                try:
                    answer = decode_candidate(result.stdout, pigs, ducks, columns, rows, blockers)
                except (TypeError, ValueError):
                    continue
                answer['fast_seed'] = seed
                return answer
    except (OSError, subprocess.SubprocessError, TypeError, KeyError, ValueError) as error:
        return {'status': 'search_limit', 'states': 0, 'actions': [], 'reason': '快速搜索失败：' + str(error)}
    return {'status': 'search_limit', 'states': 0, 'actions': [], 'reason': '快速搜索达到上限'}
