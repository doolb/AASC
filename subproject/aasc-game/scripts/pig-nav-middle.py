#!/usr/bin/env python3
"""只复用与当前画面完全一致、且有实机胜利证据的已复核历史布局。"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
import pig_cage


def same_board(current, historical, board):
    """只忽略棋盘以外的界面变化；棋盘像素必须逐一相同。"""
    first = cv2.imdecode(np.frombuffer(current, dtype=np.uint8), cv2.IMREAD_COLOR)
    second = cv2.imdecode(np.frombuffer(historical, dtype=np.uint8), cv2.IMREAD_COLOR)
    if first is None or second is None or first.shape != second.shape or not isinstance(board, list) or len(board) != 4:
        return False
    if any(type(value) is not int for value in board):
        return False
    x, y, width, height = board
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > first.shape[1] or y + height > first.shape[0]:
        return False
    return bool(np.array_equal(first[y:y + height, x:x + width], second[y:y + height, x:x + width]))


def outside_special_boxes(frame, board, cages):
    """返回笼外显著蓝色或红色区域，调用方可将其保守覆盖或停止。"""
    x, y, width, height = (round(value) for value in board)
    # 蓝色、强红色标记可能遮住特殊棋子；宁可停下，也不能当作普通猪求解。
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    blue = cv2.inRange(hsv, np.array([90, 50, 40], dtype=np.uint8), np.array([135, 255, 255], dtype=np.uint8))
    red1 = cv2.inRange(hsv, np.array([0, 180, 80], dtype=np.uint8), np.array([10, 255, 255], dtype=np.uint8))
    red2 = cv2.inRange(hsv, np.array([170, 180, 80], dtype=np.uint8), np.array([179, 255, 255], dtype=np.uint8))
    mask = cv2.bitwise_or(blue, cv2.bitwise_or(red1, red2))
    allowed = np.zeros(mask.shape, dtype=np.uint8)
    allowed[y:y + height, x:x + width] = 255
    for cage in cages:
        cx, cy, cw, ch = cage['bbox']
        allowed[max(0, cy - 4):min(frame.shape[0], cy + ch + 4),
                max(0, cx - 4):min(frame.shape[1], cx + cw + 4)] = 0
    mask = cv2.bitwise_and(mask, allowed)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    return [list(map(int, stats[index, :4])) for index in range(1, count)
            if stats[index, cv2.CC_STAT_AREA] >= 20]


def can_handle_cage(image, candidates):
    """仅把无未知笼外物件的铁笼交给本地阶段器；无法确认时交回缺口。"""
    frame = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_COLOR)
    board = candidates.get('board')
    if (frame is None or not isinstance(board, list) or len(board) != 4
            or any(type(value) not in (int, float) or not math.isfinite(value) for value in board)):
        return False
    x, y, width, height = (round(value) for value in board)
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > frame.shape[1] or y + height > frame.shape[0]:
        return False
    cages = pig_cage.detect(frame, board)
    if len(cages) != 1:
        return False
    pigs = candidates.get('pigs')
    if not isinstance(pigs, list) or not pigs:
        return False
    entities = candidates.get('other_entities', [])
    if not isinstance(entities, list):
        return False
    for item in pigs + entities:
        if (not isinstance(item, dict) or not isinstance(item.get('center'), (list, tuple))
                or len(item['center']) != 2
                or any(type(value) not in (int, float) or not math.isfinite(value) for value in item['center'])):
            return False
    outside = [pig for pig in pigs if not any(pig_cage.contains(cage, pig.get('center', ())) for cage in cages)]
    if not outside or any(pig.get('direction') not in ('north', 'south', 'east', 'west')
                          or pig.get('kind', 'ordinary') not in ('ordinary', 'pig', 'normal')
                          or pig.get('gesture_occluded') for pig in outside):
        return False
    if any(not any(pig_cage.contains(cage, item.get('center', ())) for cage in cages)
           for item in entities):
        return False
    return not outside_special_boxes(frame, board, cages)


def inspect(evidence, image, level, archive):
    digest = hashlib.sha256(image).hexdigest()
    candidates = json.loads((evidence / 'level.json').read_text(encoding='utf-8'))
    if candidates.get('level') != level:
        return {'status': 'gap', 'reason': '采集关卡与目标不一致'}
    for directory in sorted(archive.glob(f'level-{level:02d}-*')):
        try:
            if not directory.is_dir():
                continue
            historical = (directory / 'original.png').read_bytes()
            result = json.loads((directory / 'result.json').read_text(encoding='utf-8'))
            layout = json.loads((directory / 'level-reviewed.json').read_text(encoding='utf-8'))
            if result.get('status') != 'victory' or not (directory / 'victory.png').is_file():
                continue
            if result.get('level', level) != level or layout.get('level', level) != level:
                continue
            if (not isinstance(layout.get('pigs'), list) or not layout['pigs'] or not layout.get('board')
                    or any(not isinstance(pig, dict) for pig in layout['pigs'])):
                continue
            if historical != image and not same_board(image, historical, layout['board']):
                continue
            saved_plan = json.loads((directory / 'plan.json').read_text(encoding='utf-8'))
            if not saved_plan.get('actions') or saved_plan.get('status') not in (None, 'solved'):
                continue
            if any(saved_plan.get(key) != layout.get(key) for key in ('pigs', 'grid', 'board', 'locks')):
                continue
            if any(saved_plan.get(key) != layout.get(key) and (saved_plan.get(key) or layout.get(key))
                   for key in ('ducks', 'blockers', 'dynamic_cages', 'cage_cells', 'cage_unknown',
                               'scissors', 'ropes', 'unknown_entities', 'other_entities')):
                continue
            marked_bombs = {str(pig['id']) for pig in layout['pigs']
                            if pig.get('kind') == 'bomb' or pig.get('bomb_limit') is not None}
            if marked_bombs:
                recorded = saved_plan.get('bombs')
                if not isinstance(recorded, dict) or set(map(str, recorded)) != marked_bombs:
                    continue
                layout = {**layout, 'bombs': recorded, 'bomb_policy': 'avoid_contact'}
            elif saved_plan.get('bombs'):
                continue
            mechanics = ['ordinary']
            for field, name in [('locks', 'lock'), ('ducks', 'duck'), ('scissors', 'scissors'),
                                ('ropes', 'rope'), ('dynamic_cages', 'cage'), ('cage_cells', 'cage'), ('bombs', 'bomb')]:
                if layout.get(field) and name not in mechanics:
                    mechanics.append(name)
            return {'status': 'reviewed', 'source': str(directory), 'layout': {
                **layout, 'level': level, 'reviewed': True, 'mechanicsReviewed': True,
                'source_sha256': digest, 'mechanics': mechanics}}
        except (OSError, ValueError, TypeError):
            continue
    if can_handle_cage(image, candidates):
        return {'status': 'local_cage', 'reason': '铁笼与笼外候选可交本地阶段器进一步复核'}
    details = []
    if candidates.get('unknown_directions'):
        details.append(f"{candidates['unknown_directions']} 个方向未确认")
    if candidates.get('other_entities'):
        details.append(f"{len(candidates['other_entities'])} 个其他物件候选")
    if candidates.get('warnings'):
        details.append(f"{len(candidates['warnings'])} 条识别警告")
    return {'status': 'gap', 'reason': '当前画面没有可安全复用的胜利布局' + ('：' + '，'.join(details) if details else '')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--level', type=int, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = inspect(args.evidence, (args.evidence / 'original.png').read_bytes(), args.level, args.archive)
    args.output.write_text(json.dumps(result, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
