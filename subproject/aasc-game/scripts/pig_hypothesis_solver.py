#!/usr/bin/env python3
"""离线分析条件固定棋子和反事实假设，不连接游戏或生成点击路线。"""
import argparse
import itertools
import json
import sys
from pathlib import Path

import pig_level_solver as solver

OPPOSITE = {'north': 'south', 'south': 'north', 'east': 'west', 'west': 'east'}
UNSUPPORTED_FIELDS = ('ducks', 'blockers', 'dynamic_cages', 'cage_cells', 'cage_unknown',
                      'locks', 'scissors', 'ropes', 'unknown_entities', 'bombs', 'bomb_policy')
MAX_FIXED_PIGS = 64


def pinned(layout, direction_flips=(), movable_springs=()):
    """乐观移除可移动棋子，返回在声明规则下仍无法先移动的集合。"""
    pigs = layout['pigs']
    _, _, _, width, height = layout['grid']
    solver.prepare(pigs, width, height)
    if (any(pig.get('width', 1) != 1 or pig.get('kind', 'normal') not in ('normal', 'spring')
            or pig.get('bomb_limit') is not None for pig in pigs)
            or any(layout.get(field) for field in UNSUPPORTED_FIELDS)):
        raise ValueError('条件分析仅支持单格宽的普通猪、弹簧猪及无额外机制的棋盘')
    if any(type(pig.get('id')) is not int for pig in pigs):
        raise ValueError('猪编号必须为整数')
    ids = {pig['id'] for pig in pigs}
    spring_ids = {pig['id'] for pig in pigs if pig.get('kind') == 'spring'}
    if not set(direction_flips) <= ids or not set(movable_springs) <= spring_ids:
        raise ValueError('反事实假设包含未知编号或非弹簧猪')

    directions = [OPPOSITE[pig['direction']] if pig['id'] in direction_flips else pig['direction']
                  for pig in pigs]
    positions = [(pig['grid']['col'], pig['grid']['row']) for pig in pigs]
    occupied = {cell: index for index, pig in enumerate(pigs)
                for cell in solver.cells(positions[index], directions[index], pig.get('length', 2))}
    remaining = set(range(len(pigs)))
    while True:
        movable = []
        links = {}
        for index in remaining:
            pig = pigs[index]
            dx, dy = solver.VECTORS[directions[index]]
            own_cells = solver.cells(positions[index], directions[index], pig.get('length', 2))
            x, y = max(own_cells, key=lambda cell: cell[0] * dx + cell[1] * dy)
            blockers = set()
            returns = pig.get('kind') == 'spring' and pig['id'] not in movable_springs
            while True:
                x, y = x + dx, y + dy
                if not (0 <= x < width and 0 <= y < height):
                    break
                target = occupied.get((x, y))
                if target in remaining and target != index:
                    blockers.add(target)
                # 普通猪只需前方一格可用即可移动；弹簧猪须整条离场路径无障碍。
                if not returns:
                    break
            links[index] = blockers
            if not blockers:
                movable.append(index)
        if not movable:
            return {
                'pinned_ids': sorted(pigs[index]['id'] for index in remaining),
                'dependencies': {str(pigs[index]['id']): sorted(pigs[other]['id'] for other in links[index]
                                                               if other in remaining)
                                 for index in sorted(remaining)},
            }
        # 将可能移动的棋子直接移除属于乐观近似，不能据此声称存在完整路线。
        remaining.difference_update(movable)


def _minimal_hypotheses(layout, ids, kind):
    """最多枚举两项变化，并只保留解除全部条件固定集合的最小组合。"""
    results = []
    for count in (1, 2):
        for combo in itertools.combinations(ids, count):
            kwargs = {'direction_flips': combo} if kind == 'direction' else {'movable_springs': combo}
            if not pinned(layout, **kwargs)['pinned_ids']:
                results.append({
                    'type': 'reverse_directions' if kind == 'direction' else 'springs_stop_on_collision',
                    'ids': list(combo),
                    'status': ('counterfactual_requires_visual_verification' if kind == 'direction'
                               else 'counterfactual_requires_mechanism_verification'),
                    'executable': False,
                })
        if results:
            break
    return results


def analyze(layout):
    """返回条件分析结果；解除固定集合仅是可解的必要条件。"""
    base = pinned(layout)
    ids = base['pinned_ids']
    by_id = {pig['id']: pig for pig in layout['pigs']}
    result = {
        'status': 'conditional_analysis_not_solution',
        'assumptions': ['普通猪不能推动其他棋子', '弹簧遇阻回到点击前的位置', '没有额外机制或外力'],
        'base': base,
        'hypothesis_status': 'not_needed' if not ids else 'complete',
        'max_hypothesis_changes': 2,
        'direction_hypotheses': [],
        'collision_hypotheses': [],
        'warning': '仅枚举同类最多两项变化；解除条件固定集合只是必要条件，反事实未经验证不得执行。',
    }
    if len(ids) > MAX_FIXED_PIGS:
        result['hypothesis_status'] = 'limit_exceeded'
        return result
    if ids:
        result['direction_hypotheses'] = _minimal_hypotheses(layout, ids, 'direction')
        springs = [pig_id for pig_id in ids if by_id[pig_id].get('kind') == 'spring']
        result['collision_hypotheses'] = _minimal_hypotheses(layout, springs, 'collision')
    return result


def main():
    parser = argparse.ArgumentParser(description='离线分析条件固定棋子及待复核假设，不执行游戏动作')
    parser.add_argument('--input', required=True, help='项目格式关卡 JSON')
    parser.add_argument('--output', help='分析结果 JSON，不得覆盖输入文件')
    args = parser.parse_args()
    try:
        source = Path(args.input)
        if args.output and Path(args.output).resolve() == source.resolve():
            raise ValueError('输出不能覆盖输入布局')
        result = analyze(json.loads(source.read_text(encoding='utf-8')))
        content = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
        if args.output:
            Path(args.output).write_text(content, encoding='utf-8')
        print(content, end='')
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'条件分析失败：{error}\n')


if __name__ == '__main__':
    main()
