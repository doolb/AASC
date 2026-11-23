#!/usr/bin/env python3
"""构造并验证含锁猪的完整候选计划，不访问游戏窗口。"""
import argparse
import importlib.util
import json
import math
import sys
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


def profile_level(data):
    """识别关卡物件与需要生效的机制，供求解路由选择最合适策略。"""
    pigs = data.get('pigs', [])
    has_ducks = bool(data.get('ducks'))
    has_blockers = bool(data.get('blockers'))
    has_special_tools = bool(data.get('scissors') or data.get('ropes'))
    has_cages = bool(data.get('dynamic_cages') or data.get('cage_cells'))
    has_locks = bool(data.get('locks'))
    has_bombs = data.get('bomb_policy') == 'avoid_contact'
    has_springs = any(pig.get('kind') == 'spring' for pig in pigs)
    has_unreviewed_cage = bool(data.get('cage_unknown') or data.get('cage_cells'))
    has_non_cardinal_or_wide = any(
        pig.get('width', 1) != 1 or pig.get('direction') not in ('north', 'south', 'east', 'west')
        for pig in pigs
    )
    heuristic_supported = not (
        has_ducks or has_blockers or has_special_tools or has_unreviewed_cage or has_non_cardinal_or_wide or has_bombs or has_springs
    )
    return {
        'pig_count': len(pigs),
        'has_ducks': has_ducks,
        'has_blockers': has_blockers,
        'has_special_tools': has_special_tools,
        'has_cages': has_cages,
        'has_locks': has_locks,
        'heuristic_supported': heuristic_supported,
    }


def select_solver_profiles(profile):
    """根据关卡机制特征表选择求解管线，避免冗长条件分支。"""
    if not profile['heuristic_supported']:
        return [('native', {'seeds': (17, 1, 2, 4, 5, 6, 7, 8, 9)})]
    if profile['has_cages'] or profile['has_locks']:
        return [('native', {'seeds': (0, 1, 2)}), ('heuristic', {})]
    return [('native', {'seeds': (17, 1, 2, 4, 5, 6, 7, 8, 9)}), ('heuristic', {})]


def solve(data, seeds=(17, 1, 2, 4, 5, 6, 7, 8, 9), allow_partial=False, forbid_first=None, target_exits=None, strategy="native", time_limit=90):
    """离线遍历后交独立 Python 实现重放；不接受不完整或提前解锁的候选。"""
    if strategy == 'auto':
        if forbid_first is not None or target_exits is not None:
            return solve(data, seeds=seeds, allow_partial=allow_partial, forbid_first=forbid_first,
                         target_exits=target_exits, strategy='native', time_limit=time_limit)
        profile = profile_level(data)
        pipeline = select_solver_profiles(profile)
        last_error = None
        for idx, (step_strategy, options) in enumerate(pipeline):
            step_allow_partial = allow_partial and (idx == len(pipeline) - 1)
            try:
                answer = solve(data, seeds=options.get('seeds', seeds), allow_partial=step_allow_partial,
                               strategy=step_strategy, time_limit=time_limit)
                answer.setdefault('search_info', {})['level_profile'] = profile
                return answer
            except ValueError as error:
                last_error = error
        raise last_error or ValueError('自动求解未找到可行路线')
    if strategy == 'heuristic':
        if any(pig.get('kind') == 'spring' for pig in data.get('pigs', [])):
            raise ValueError('启发式求解器暂不支持弹簧猪')
        if forbid_first is not None or target_exits is not None:
            raise ValueError('启发式策略暂不支持首步限制或阶段离场目标')
        return solve_heuristic(data, allow_partial=allow_partial, time_limit=time_limit)
    if strategy != 'native':
        raise ValueError('未知的求解策略')
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
    cages = data.get('dynamic_cages', [])
    bomb_mode = data.get('bomb_policy') == 'avoid_contact'
    spring_mode = any(pig.get('kind') == 'spring' for pig in pigs)
    if cages and ducks:
        raise ValueError('动态铁笼与鸭子混合尚未验证')
    if len(ducks) > 63:
        raise ValueError('鸭子数量超限')
    module = locked_module()
    # 外部布局先经 Python 校验，防止非法格子或计数传入原生搜索器。
    module.validate_plan(dict(data, actions=[]), require_complete=False)
    bomb_ids = {int(key) for key in data['bombs']} if bomb_mode else set()
    if forbid_first is not None and forbid_first not in {pig['id'] for pig in pigs}:
        raise ValueError('禁止首步的小猪不在当前布局')
    if target_exits is not None and (type(target_exits) is not int or not 1 <= target_exits <= len(pigs) or ducks):
        raise ValueError('阶段离场目标无效或包含未支持的鸭子')
    lines = [f'{len(pigs)} {columns} {rows} {len(ducks)} {len(blockers)} {len(cages)} {int(bomb_mode)} {int(spring_mode)}']
    for pig in pigs:
        position = pig['grid']
        line = f"{position['col']} {position['row']} {pig['direction']} {pig.get('length', 2)} {pig.get('width', 1)} {pig['id']} {locks.get(pig['id'], 0)} {int(pig['id'] in data.get('scissors', []))} {int(pig['id'] in data.get('ropes', []))}"
        lines.append(line + (f" {int(pig['id'] in bomb_ids)}" if bomb_mode else '') + (f" {int(pig.get('kind') == 'spring')}" if spring_mode else ''))
    lines.extend(f'{x} {y}' for x, y in ducks)
    lines.extend(f'{x} {y}' for x, y in blockers)
    for cage in cages:
        cage_cells = cage['cells']
        lines.append(f"{cage['unlock_exits']} {len(cage_cells)} " + ' '.join(f'{x} {y}' for x, y in cage_cells))
    payload = '\n'.join(lines) + '\n'
    best_partial = None
    with tempfile.TemporaryDirectory(prefix='aasc-pig-locked-') as directory:
        executable = Path(directory) / 'search'
        try:
            subprocess.run([compiler, '-O3', '-std=c++17', str(ROOT / 'scripts/pig_fast_locked_solver.cpp'), '-o', str(executable)],
                           check=True, capture_output=True, timeout=45)
            for seed in seeds:
                print(f'锁猪完整搜索：动作顺序 {seed}', flush=True)
                try:
                    command = [str(executable), str(seed)]
                    if forbid_first is not None or target_exits is not None:
                        command.extend(['900000', str(forbid_first if forbid_first is not None else -1)])
                    if target_exits is not None:
                        command.append(str(target_exits))
                    found = subprocess.run(command, input=payload, text=True, capture_output=True, timeout=55)
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
                partial = found.returncode == 3 or target_exits is not None
                answer = dict(data, actions=actions, status='partial' if partial else 'solved')
                if not actions:
                    continue
                module.validate_plan(answer, require_complete=not partial)
                if found.returncode == 0:
                    return answer
                # 多种动作顺序均达到上限时，保留已独立验证且离场数量最多的阶段。
                score = (sum(int(action['exited']) + len(action.get('duck_departures', ())) for action in actions), -len(actions))
                if best_partial is None or score > best_partial[0]:
                    best_partial = (score, answer)
        except (OSError, subprocess.SubprocessError) as error:
            raise ValueError('锁猪搜索失败：' + str(error)) from error
    if best_partial is not None:
        return best_partial[1]
    raise ValueError('锁猪完整搜索达到上限')


HEURISTIC_PROFILES = (
    ('auto_heuristic', ('--mode', 'auto', '--closure', 'heuristic', '--deadlock-prune', 'off',
                        '--baseline-ratio', '0.2', '--dfs-phase-ratio', '0.35', '--candidate-search', 'dfs',
                        '--auto-time', '2', '--min-candidate-budget', '0.2', '--max-candidates', '60')),
    ('bestfirst_fast', ('--mode', 'bestfirst', '--closure', 'off', '--deadlock-prune', 'off')),
    ('auto_deadlock_prune', ('--mode', 'auto', '--closure', 'heuristic', '--deadlock-prune', 'strict',
                             '--deadlock-max-nodes', '100')),
)


def _run_heuristic_profile(source, output, profile_args, budget):
    """在受控子进程中运行单个启发式配置并返回标准化结果。"""
    command = [sys.executable, str(ROOT / 'scripts/pig_heuristic_solver.py'),
               '--layout', str(source), '--time', str(budget), *profile_args, '--out', str(output)]
    subprocess.run(command, check=True, capture_output=True, text=True, timeout=budget + 15)
    result = json.loads(output.read_text(encoding='utf-8'))
    return result.get('best') or result


def solve_heuristic(data, allow_partial=False, time_limit=90):
    """在受控子进程中搜索，并以项目独立移动规则重新验证每一步。"""
    if isinstance(time_limit, bool) or not isinstance(time_limit, (int, float)) or not math.isfinite(time_limit) or not 0 < time_limit <= 3600:
        raise ValueError('搜索时间必须在 0 到 3600 秒之间')
    if data.get('bomb_policy') or any(data.get(key) for key in ('ducks', 'blockers', 'scissors', 'ropes', 'cage_unknown', 'cage_cells')):
        raise ValueError('启发式策略暂不支持鸭子、固定阻挡、剪刀、绳索或未复核铁笼')
    pigs, grid = data['pigs'], data['grid']
    if any(pig.get('width', 1) != 1 or pig.get('direction') not in ('north', 'south', 'east', 'west') for pig in pigs):
        raise ValueError('启发式策略仅支持四向单格宽小猪')
    module = locked_module()
    module.validate_plan(dict(data, actions=[]), require_complete=False)
    locks = {int(key): value for key, value in data.get('locks', {}).items()}
    layout = {'grid_columns': grid[3], 'grid_rows': grid[4], 'dynamic_cages': data.get('dynamic_cages', []), 'pigs': []}
    for pig in pigs:
        position = pig['grid']
        # 原始笼内的猪在笼门打开前不可点击，即使调用方没有重复提供锁映射。
        occupied = set(map(tuple, position['cells']))
        cage_lock = max((cage['unlock_exits'] for cage in data.get('dynamic_cages', [])
                         if occupied.intersection(map(tuple, cage['cells']))), default=0)
        layout['pigs'].append({'id': pig['id'], 'direction': pig['direction'], 'length': pig.get('length', 2),
                               'width': 1, 'cells': position['cells'],
                               'unlock_after_exits': max(locks.get(pig['id'], 0), cage_lock)})
    best = {}
    best_score = (-1, -1)
    used_profile = HEURISTIC_PROFILES[0][0]
    with tempfile.TemporaryDirectory(prefix='aasc-pig-heuristic-') as directory:
        source, output = Path(directory) / 'layout.json', Path(directory) / 'result.json'
        source.write_text(json.dumps(layout, ensure_ascii=False), encoding='utf-8')
        per_budget = max(1.0, float(time_limit) / len(HEURISTIC_PROFILES))
        last_error = None
        for idx, (profile_name, profile_args) in enumerate(HEURISTIC_PROFILES):
            budget = float(time_limit) if idx == 0 and time_limit <= 5 else per_budget
            try:
                candidate = _run_heuristic_profile(source, output, profile_args, budget)
            except (OSError, subprocess.SubprocessError, ValueError) as error:
                last_error = error
                continue
            if candidate.get('complete') is True:
                best, used_profile = candidate, profile_name
                break
            score = (candidate.get('best_removed', 0), len(candidate.get('steps', [])))
            if not best or score > best_score:
                best, best_score, used_profile = candidate, score, profile_name
        if not best and last_error is not None:
            raise ValueError('启发式搜索失败：' + str(last_error)) from last_error
    complete = best.get('complete') is True
    if not complete and not allow_partial:
        raise ValueError('启发式搜索达到上限，未找到完整解')
    state, directions = module.app.player.solver.prepare(pigs, grid[3], grid[4])
    state = list(state)
    lengths = [pig.get('length', 2) for pig in pigs]
    widths = [1] * len(pigs)
    indices = {pig['id']: index for index, pig in enumerate(pigs)}
    actions, exits = [], 0
    for step in best.get('steps', []):
        index = indices.get(step.get('id'))
        if index is None or state[index] is None:
            raise ValueError('启发式候选包含无效小猪')
        cells = step.get('from')
        if not cells or tuple(state[index]) != (min(c[0] for c in cells), min(c[1] for c in cells)):
            raise ValueError('启发式候选起点不匹配')
        target_cells = step.get('to')
        destination = None if target_cells == 'exit' else (min(c[0] for c in target_cells), min(c[1] for c in target_cells))
        active = set().union(*(set(map(tuple, cage['cells'])) for cage in data.get('dynamic_cages', []) if exits < cage['unlock_exits']))
        options = module.app.player.solver.actions(state, directions, grid[3], grid[4], blockers=active, lengths=lengths, widths=widths)
        matches = [move for move in options if move[1] == index and move[0] == (destination is None) and move[2] == destination]
        if not matches:
            raise ValueError('启发式候选不符合独立移动规则')
        actions.append({'index': index, 'pig_id': pigs[index]['id'], 'direction': directions[index],
                        'from': list(state[index]), 'to': list(destination) if destination is not None else None,
                        'exited': destination is None, 'travel_cells': matches[0][3]})
        state[index] = destination
        exits += int(destination is None)
    if not actions:
        raise ValueError('启发式搜索未找到可验证步骤')
    answer = dict(data, actions=actions, status='solved' if complete else 'partial')
    answer['search_info'] = {'strategy': 'heuristic', 'profile': used_profile, 'closure': 'heuristic',
                             'time_limit': time_limit, 'complete': complete, 'exits': exits}
    module.validate_plan(answer, require_complete=complete)
    return answer


def main():
    parser = argparse.ArgumentParser(description='使用机制路由或启发式策略计算并独立验证小猪关卡')
    parser.add_argument('--input', required=True, help='项目格式关卡 JSON')
    parser.add_argument('--output', required=True, help='输出经独立验证的计划 JSON')
    parser.add_argument('--strategy', choices=('auto', 'heuristic', 'native'), default='heuristic', help='求解策略')
    parser.add_argument('--time', type=float, default=90, help='总搜索秒数')
    parser.add_argument('--allow-partial', action='store_true', help='允许输出已验证的部分路线')
    args = parser.parse_args()
    try:
        data = json.loads(Path(args.input).read_text(encoding='utf-8'))
        answer = solve(data, strategy=args.strategy, time_limit=args.time, allow_partial=args.allow_partial)
        Path(args.output).write_text(json.dumps(answer, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f"搜索结果：{answer['status']}，{len(answer['actions'])} 步")
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'求解失败：{error}\n')


if __name__ == '__main__':
    main()
