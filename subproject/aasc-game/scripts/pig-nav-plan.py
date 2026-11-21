#!/usr/bin/env python3
"""将已复核且绑定首屏的布局交给自动策略，并独立重放完整路线。"""
import argparse
import hashlib
import json
from pathlib import Path

import pig_locked_candidate as candidate

SUPPORTED = {'ordinary', 'lock', 'duck', 'scissors', 'rope', 'cage', 'bomb'}


def validate_layout(layout, screenshot, level):
    if not isinstance(layout, dict) or layout.get('reviewed') is not True or layout.get('mechanicsReviewed') is not True:
        raise ValueError('布局和特殊机制必须明确复核')
    if type(layout.get('level')) is not int or layout['level'] != level:
        raise ValueError('复核布局的关卡不匹配')
    image_hash = hashlib.sha256(screenshot).hexdigest()
    if layout.get('source_sha256') != image_hash:
        raise ValueError('复核布局未绑定当前首屏')
    mechanics = layout.get('mechanics')
    if not isinstance(mechanics, list) or not mechanics or any(not isinstance(item, str) or item not in SUPPORTED for item in mechanics):
        raise ValueError('存在未建模或未确认的物件机制')
    for field, mechanism in (('locks', 'lock'), ('ducks', 'duck'), ('scissors', 'scissors'),
                             ('ropes', 'rope'), ('dynamic_cages', 'cage'), ('cage_cells', 'cage'), ('bombs', 'bomb')):
        if layout.get(field) and mechanism not in mechanics:
            raise ValueError('布局包含未声明的物件机制：' + mechanism)
    pigs = layout.get('pigs')
    if not isinstance(pigs, list) or not pigs:
        raise ValueError('布局没有小猪')
    if any(not isinstance(pig, dict) or pig.get('kind', 'ordinary') not in ('ordinary', 'pig', 'normal', 'bomb')
           or ((pig.get('kind') == 'bomb' or pig.get('bomb_limit') is not None) and 'bomb' not in mechanics) for pig in pigs):
        raise ValueError('存在未建模的特殊小猪')
    if 'bomb' in mechanics and (not layout.get('bombs') or layout.get('bomb_policy') != 'avoid_contact'):
        raise ValueError('炸弹必须完整声明并使用保守策略')
    if (layout.get('unknown_entities') or layout.get('other_entities')
            or layout.get('cage_unknown') or layout.get('unknown_directions')):
        raise ValueError('存在炸弹或尚未核对的障碍')
    if layout.get('cage_cells'):
        cages = layout.get('dynamic_cages') or []
        declared = {tuple(cell) for cell in layout['cage_cells']}
        modeled = {tuple(cell) for cage in cages for cell in cage.get('cells', [])}
        if declared != modeled:
            raise ValueError('铁笼占格与动态解锁模型不一致')
    return {**layout, 'locks': layout.get('locks', {}), 'ducks': layout.get('ducks', [])}, image_hash


def build_plan(layout, screenshot, level):
    data, image_hash = validate_layout(layout, screenshot, level)
    plan = candidate.solve(data, strategy='auto', allow_partial=False)
    if plan.get('status') != 'solved' or not plan.get('actions'):
        raise ValueError('未找到完整路线')
    candidate.locked_module().validate_plan(plan, require_complete=True)
    plan['navigation'] = {'source_sha256': image_hash, 'level': level, 'strategy': 'auto', 'replayed': True}
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--layout', required=True, type=Path)
    parser.add_argument('--image', required=True, type=Path)
    parser.add_argument('--level', required=True, type=int)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        plan = build_plan(json.loads(args.layout.read_text(encoding='utf-8')), args.image.read_bytes(), args.level)
        with args.output.open('x', encoding='utf-8') as output:
            json.dump(plan, output, ensure_ascii=False, indent=2)
            output.write('\n')
        print(f"完整路线独立重放通过：{len(plan['actions'])} 步", flush=True)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'导航求解停止：{error}\n')


if __name__ == '__main__':
    main()
