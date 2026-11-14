#!/usr/bin/env python3
"""从首屏蓝色图案提取剪刀猪与捆绑猪候选，不猜测低置信方向。"""
import math
import cv2
import numpy as np


def detect(image, board, extract):
    height, width = image.shape[:2]
    scale = math.sqrt(width / 530 * height / 942)
    x, y, w, h = board
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv[y:y+h, x:x+w], (90, 120, 55), (130, 255, 255))
    count, _, stats, centers = cv2.connectedComponentsWithStats(mask)
    pieces = []
    for index in range(1, count):
        bx, by, bw, bh, area = (int(v) for v in stats[index])
        if not 50 * scale * scale <= area <= 400 * scale * scale:
            continue
        cx, cy = centers[index]
        pieces.append({'bbox': [x + bx, y + by, bw, bh], 'center': [x + float(cx), y + float(cy)], 'area': area})
    # 手柄之间的连接可能被白色刀刃切断；仅合并近邻、尺寸相近的两块手柄。
    merged_indices = set()
    merged_pieces = []
    for i, first in enumerate(pieces):
        if i in merged_indices:
            continue
        ax, ay, aw, ah = first['bbox']
        if not (8 * scale <= aw <= 16 * scale and 8 * scale <= ah <= 16 * scale):
            continue
        for j in range(i + 1, len(pieces)):
            if j in merged_indices:
                continue
            second = pieces[j]
            bx, by, bw, bh = second['bbox']
            if not (8 * scale <= bw <= 16 * scale and 8 * scale <= bh <= 16 * scale):
                continue
            same_row = abs(ay - by) <= 3 * scale and 0 <= max(ax, bx) - min(ax + aw, bx + bw) <= 3 * scale
            same_col = abs(ax - bx) <= 3 * scale and 0 <= max(ay, by) - min(ay + ah, by + bh) <= 3 * scale
            if same_row or same_col:
                left, top = min(ax, bx), min(ay, by)
                right, bottom = max(ax + aw, bx + bw), max(ay + ah, by + bh)
                area = first['area'] + second['area']
                center = [(first['center'][k] * first['area'] + second['center'][k] * second['area']) / area for k in (0, 1)]
                merged_pieces.append({'bbox': [left, top, right-left, bottom-top], 'center': center, 'area': area})
                merged_indices.update((i, j))
                break
    pieces = [item for index, item in enumerate(pieces) if index not in merged_indices] + merged_pieces
    stripes = [p for p in pieces if max(p['bbox'][2:]) >= 20 * scale and max(p['bbox'][2:]) >= 3 * min(p['bbox'][2:])]
    scissors = [p for p in pieces if 10 * scale <= min(p['bbox'][2:]) <= 20 * scale and 18 * scale <= max(p['bbox'][2:]) <= 30 * scale and max(p['bbox'][2:]) < 2.4 * min(p['bbox'][2:])]
    candidates, consumed = [], set()
    white = (hsv[:, :, 1] < 95) & (hsv[:, :, 2] > 185)
    for item in scissors:
        cx, cy = item['center']
        vertical = item['bbox'][2] > item['bbox'][3]
        options = [('north', 0, -1), ('south', 0, 1)] if vertical else [('west', -1, 0), ('east', 1, 0)]
        scores = []
        for direction, dx, dy in options:
            px, py = round(cx + dx * 18 * scale), round(cy + dy * 18 * scale)
            radius = max(3, round(7 * scale))
            region = white[max(0, py-radius):min(height, py+radius+1), max(0, px-radius):min(width, px+radius+1)]
            scores.append((int(np.count_nonzero(region)), direction, dx, dy))
        scores.sort(reverse=True)
        best, runner = scores
        direction = best[1] if best[0] >= 100 * scale * scale and best[0] - runner[0] >= 50 * scale * scale else 'unknown'
        center = [round(cx + best[2] * 8 * scale, 1), round(cy + best[3] * 8 * scale, 1)] if direction != 'unknown' else [round(cx, 1), round(cy, 1)]
        candidates.append({'kind': 'scissors', 'center': center, 'direction': direction, 'bbox': item['bbox'], 'direction_scores': scores})
    for i, item in enumerate(stripes):
        if i in consumed:
            continue
        vertical_stripe = item['bbox'][3] > item['bbox'][2]
        group = [j for j, other in enumerate(stripes) if j not in consumed and (other['bbox'][3] > other['bbox'][2]) == vertical_stripe
                 and math.dist(item['center'], other['center']) < 24 * scale]
        if len(group) < 2 or len(group) > 3:
            continue
        consumed.update(group)
        cx = sum(stripes[j]['center'][0] for j in group) / len(group)
        cy = sum(stripes[j]['center'][1] for j in group) / len(group)
        horizontal_pig = vertical_stripe
        body = (round(cx-20*scale), round(cy-10*scale), round(40*scale), round(20*scale)) if horizontal_pig else (round(cx-10*scale), round(cy-20*scale), round(20*scale), round(40*scale))
        # 蓝线可能被误认为眼睛；仅将高饱和蓝像素替换为浅色，再使用已有头部评分。
        clean = image.copy()
        full_blue = cv2.inRange(hsv, (90, 80, 50), (130, 255, 255))
        clean[full_blue > 0] = (160, 180, 240)
        axis = np.array([1., 0.]) if horizontal_pig else np.array([0., 1.])
        direction, confidence, pos, neg, _ = extract.direction_for(clean, body, (cx, cy), axis, scale)
        if confidence != 'medium':
            direction = None
        candidates.append({'kind': 'rope', 'center': [round(cx, 1), round(cy, 1)], 'direction': direction or 'unknown',
                           'bbox': list(body), 'direction_scores': {'positive': pos, 'negative': neg}, 'stripes': len(group)})
    return candidates


def build_layout(image, board, extract, auto, player, frames=()):
    """构造候选布局；特殊猪方向、网格和占格不确定时直接拒绝。"""
    special = detect(image, board, extract)
    if not special or not any(c['kind'] == 'scissors' for c in special) or not any(c['kind'] == 'rope' for c in special):
        raise ValueError('无法同时确认剪刀猪与捆绑猪')
    if any(c['direction'] == 'unknown' for c in special):
        raise ValueError('特殊猪朝向未能可靠确认')
    raw, _, warnings = extract.identify(image, board)
    scale = math.sqrt(image.shape[1] / 530 * image.shape[0] / 942)
    raw = [pig for pig in raw if all(math.dist(pig['center'], item['center']) > 24 * scale for item in special)]
    unknown = [pig for pig in raw if pig['direction'] == 'unknown']
    if unknown:
        observations = {pig['id']: set() for pig in unknown}
        votes = {pig['id']: 0 for pig in unknown}
        for frame in frames:
            if frame.shape != image.shape:
                raise ValueError('多帧截图尺寸不一致')
            other_special = detect(frame, board, extract)
            if len(other_special) != len(special) or any(
                    sum(other['kind'] == item['kind'] and other['direction'] == item['direction'] and
                        math.dist(other['center'], item['center']) < 10 * scale for other in other_special) != 1 for item in special):
                raise ValueError('多帧特殊猪识别不一致')
            others, _, _ = extract.identify(frame, board)
            for pig in unknown:
                nearest = [item for item in others if math.dist(item['center'], pig['center']) < 10 * scale]
                if len(nearest) == 1 and nearest[0]['direction'] != 'unknown':
                    observations[pig['id']].add(nearest[0]['direction'])
                    votes[pig['id']] += 1
        for pig in unknown:
            if len(observations[pig['id']]) == 1 and votes[pig['id']] >= 2:
                pig['direction'] = next(iter(observations[pig['id']]))
                pig['direction_source'] = 'multi_frame_head_evidence'
    if any(pig['direction'] == 'unknown' for pig in raw):
        raise ValueError('普通猪朝向未能可靠确认')
    grid = auto.infer_grid(raw, image.shape[1::-1])
    pigs = player.with_grid(raw, grid)
    next_id = max((pig['id'] for pig in pigs), default=0) + 1
    ids = {'scissors': [], 'ropes': []}
    x0, y0, step, _, _ = grid
    for item in special:
        cx, cy = item['center']
        vertical = item['direction'] in ('north', 'south')
        col = round((cx-x0)/step - (0 if vertical else .5))
        row = round((cy-y0)/step - (.5 if vertical else 0))
        number = next_id
        next_id += 1
        pigs.append({'id': number, 'direction': item['direction'], 'length': 2, 'center': [cx, cy],
                     'grid': {'col': col, 'row': row, 'cells': [[col, row], [col+int(not vertical), row+int(vertical)]]},
                     'direction_source': 'blue_marker_image', 'detection': item})
        ids['scissors' if item['kind'] == 'scissors' else 'ropes'].append(number)
    player.solver.prepare(pigs, grid[3], grid[4])
    return {'grid': list(grid), 'pigs': pigs, 'locks': {}, 'board': list(board), 'ducks': [], **ids, 'warnings': warnings}
