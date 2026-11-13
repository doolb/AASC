#!/usr/bin/env python3
"""连续关卡的网格估算、界面验证和通关步骤图工具。"""
from collections import defaultdict
import math
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
REFERENCE_SIZE = (530, 942)
UI_TEMPLATES = {
    'victory_title': ('victory-title-template.png', (175, 165, 180, 75)),
    'next': ('next-button-template.png', (165, 680, 200, 90)),
    'reward_title': ('reward-title-template.png', (175, 145, 180, 80)),
    'collect': ('reward-collect-template.png', (180, 730, 170, 85)),
    'ranking_title': ('ranking-title-template.png', (125, 160, 280, 85)),
    'animal_guide_title': ('animal-guide-title-template.png', (165, 230, 205, 70)),
    'animal_guide_close': ('animal-guide-close-template.png', (385, 215, 70, 70)),
    'board_ready': ('board-ready-template.png', (90, 800, 110, 110)),
}


def find_yellow_ducks(image, board):
    """从棋盘黄色区域提取小黄鸭候选；不推测尚未确认的碰撞或逃跑规则。"""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (18, 100, 120), (40, 255, 255))
    restricted = np.zeros_like(mask)
    x, y, width, height = board
    restricted[y:y + height, x:x + width] = mask[y:y + height, x:x + width]
    count, labels, stats, centers = cv2.connectedComponentsWithStats(restricted)
    scale = math.sqrt((image.shape[1] / 529) * (image.shape[0] / 941))
    ducks = []
    for index in range(1, count):
        bx, by, bw, bh, area = (int(value) for value in stats[index])
        if 150 * scale * scale <= area <= 1000 * scale * scale and 12 * scale <= bw <= 30 * scale and 12 * scale <= bh <= 30 * scale:
            ducks.append({'kind': 'yellow_duck_candidate', 'center': [round(float(value), 1) for value in centers[index]],
                          'bbox': [bx, by, bw, bh], 'pixel_area': area})
            continue
        # 相邻鸭子偶尔因动画相连，按已观察的格距拆分，任一分块无效则整组丢弃。
        nx = max(1, round(bw / (29.5 * scale)))
        ny = max(1, round(bh / (29.5 * scale)))
        if nx * ny < 2 or nx > 4 or ny > 4 or not (18 * scale <= bw / nx <= 31 * scale and 18 * scale <= bh / ny <= 31 * scale):
            continue
        pieces = []
        for row in range(ny):
            for col in range(nx):
                x0, x1 = bx + round(col * bw / nx), bx + round((col + 1) * bw / nx)
                y0, y1 = by + round(row * bh / ny), by + round((row + 1) * bh / ny)
                ys, xs = np.nonzero(labels[y0:y1, x0:x1] == index)
                if not 150 * scale * scale <= len(xs) <= 1000 * scale * scale:
                    pieces = []
                    break
                px, py = int(xs.min()) + x0, int(ys.min()) + y0
                pieces.append({'kind': 'yellow_duck_candidate',
                               'center': [round(float(xs.mean() + x0), 1), round(float(ys.mean() + y0), 1)],
                               'bbox': [px, py, int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)],
                               'pixel_area': len(xs)})
            if not pieces:
                break
        if len(pieces) == nx * ny:
            ducks.extend(pieces)
    # 数字锁的金色可能与橙色背景相连；更高饱和度仅生成候选，仍须 OCR 和方向复核。
    gold = cv2.inRange(hsv[y:y + height, x:x + width], (10, 160, 140), (40, 255, 255))
    gold_count, _, gold_stats, gold_centers = cv2.connectedComponentsWithStats(gold)
    for index in range(1, gold_count):
        bx, by, bw, bh, area = (int(value) for value in gold_stats[index])
        if not (140 * scale * scale <= area <= 1000 * scale * scale and
                12 * scale <= bw <= 35 * scale and 12 * scale <= bh <= 35 * scale):
            continue
        cx, cy = (float(value) for value in gold_centers[index])
        cx, cy = cx + x, cy + y
        if all(math.dist((cx, cy), duck['center']) > 12 * scale for duck in ducks):
            ducks.append({'kind': 'yellow_duck_candidate', 'center': [round(cx, 1), round(cy, 1)],
                          'bbox': [x + bx, y + by, bw, bh], 'pixel_area': area, 'detection_source': 'saturated_gold'})
    # 沙色背景可能与黄色鸭子连成一个大区域；用已观察鸭子模板补充漏检。
    size = max(1, round(29 * scale))
    region = image[y:y + height, x:x + width]
    if region.shape[0] >= size and region.shape[1] >= size:
        for filename, threshold in [('duck-template-level23.png', 0.62),
                                    ('duck-template-level25-a.png', 0.72), ('duck-template-level25-b.png', 0.72),
                                    ('duck-template-level25-c.png', 0.72), ('duck-template-level27-a.png', 0.72),
                                    ('duck-template-level27-b.png', 0.72),
                                    ('duck-template-level30-a.png', 0.67), ('duck-template-level30-b.png', 0.67),
                                    ('duck-template-level30-c.png', 0.67)]:
            template = cv2.imread(str(ROOT / 'docs/references/pig-game' / filename))
            if template is None:
                raise ValueError('缺少小黄鸭画面模板: ' + filename)
            template = cv2.resize(template, (size, size), interpolation=cv2.INTER_AREA)
            scores = cv2.matchTemplate(region, template, cv2.TM_CCOEFF_NORMED)
            for _ in range(200):
                _, score, _, (tx, ty) = cv2.minMaxLoc(scores)
                if score < threshold:
                    break
                cx, cy = x + tx + size / 2, y + ty + size / 2
                if all(math.dist((cx, cy), duck['center']) > 12 * scale for duck in ducks):
                    ducks.append({'kind': 'yellow_duck_candidate', 'center': [round(cx, 1), round(cy, 1)],
                                  'bbox': [x + tx, y + ty, size, size], 'pixel_area': None,
                                  'detection_source': 'appearance_template', 'similarity': round(float(score), 3)})
                radius = max(1, round(13 * scale))
                cv2.rectangle(scores, (max(0, tx - radius), max(0, ty - radius)),
                              (min(scores.shape[1] - 1, tx + radius), min(scores.shape[0] - 1, ty + radius)), 0, -1)
    ducks.sort(key=lambda duck: (duck['center'][1], duck['center'][0]))
    for number, duck in enumerate(ducks, 1):
        duck['id'] = number
    return ducks



def find_locked_pigs(image, yellow_candidates):
    """局部模板筛选疑似计数锁；未知锁样式仍应由后续画面核对拦截。"""
    templates = []
    # 仅为经过现场复核的模板绑定解锁数和方向，其余外观不得猜测。
    references = [('lock-template-33-a.png', 'north', 50), ('lock-template-33-b.png', 'west', 34),
                  ('lock-template-34-a.png', 'north', 25), ('lock-template-34-b.png', 'south', 50),
                  ('lock-template-34-c.png', 'east', 35), ('lock-template-35-a.png', 'east', 30),
                  ('lock-template-35-b.png', 'east', 50), ('lock-template-39-a.png', 'west', 35),
                  ('lock-template-39-b.png', 'east', 50), ('lock-template-40-a.png', 'north', 30)]
    for name, direction, threshold in references:
        sample = cv2.imread(str(ROOT / 'docs/references/pig-game' / name), cv2.IMREAD_GRAYSCALE)
        if sample is not None:
            templates.append((cv2.resize(sample, (28, 28)), direction, threshold))
    if not templates:
        return []
    result = []
    for candidate in yellow_candidates:
        x, y, width, height = candidate['bbox']
        if width < 1 or height < 1:
            continue
        crop = image[y:y + height, x:x + width]
        if crop.size == 0:
            continue
        gray = cv2.cvtColor(cv2.resize(crop, (28, 28)), cv2.COLOR_BGR2GRAY)
        matches = sorted(((float(cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)[0, 0]), direction, threshold)
                          for template, direction, threshold in templates), reverse=True)
        score, direction, threshold = matches[0]
        if score >= 0.7:
            lock = dict(candidate)
            lock.update({'kind': 'locked_pig_candidate', 'detection_source': 'lock_template', 'similarity': round(score, 3)})
            competing = [item[0] for item in matches if item[1:] != (direction, threshold)]
            if score >= 0.98 and (not competing or score - max(competing) >= 0.03):
                lock.update({'direction': direction, 'unlock_exits': threshold})
            result.append(lock)
    return result

def find_blue_elephants(image, board):
    """识别已观察的大块蓝色物件候选；未检出不能证明不存在其他物件。"""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (90, 25, 60), (130, 200, 255))
    restricted = np.zeros_like(mask)
    x, y, width, height = board
    restricted[y:y + height, x:x + width] = mask[y:y + height, x:x + width]
    count, _, stats, _ = cv2.connectedComponentsWithStats(restricted)
    scale = math.sqrt((image.shape[1] / 529) * (image.shape[0] / 941))
    result = []
    for index in range(1, count):
        bx, by, bw, bh, area = (int(value) for value in stats[index])
        # 蓝色棋盘背景可连成整片，不应被当作单个大象障碍。
        if area >= 1000 * scale * scale and bw >= 35 * scale and bh >= 35 * scale and bw * bh < width * height * 0.5:
            result.append({'kind': 'blue_elephant_candidate', 'bbox': [bx, by, bw, bh],
                           'blocking_bbox': None, 'blocking_status': 'unknown',
                           'assumed_role': 'blocker', 'pixel_area': area})
    # 蓝灰小象可能与蓝色棋盘连成同一区域；局部身体模板补充颜色漏检。
    template = cv2.imread(str(ROOT / 'docs/references/pig-game/elephant-template-level37.png'))
    if template is not None:
        sample = cv2.resize(template, (max(1, round(template.shape[1] * scale)), max(1, round(template.shape[0] * scale))))
        region = image[y:y + height, x:x + width]
        if sample.shape[0] <= height and sample.shape[1] <= width:
            scores = cv2.matchTemplate(region, sample, cv2.TM_CCOEFF_NORMED)
            _, score, _, (tx, ty) = cv2.minMaxLoc(scores)
            if score >= 0.85:
                bx = max(x, x + tx - round(11 * scale))
                by = max(y, y + ty - round(17 * scale))
                bw = min(x + width - bx, round(107 * scale))
                bh = min(y + height - by, round(70 * scale))
                if all(math.dist((bx + bw / 2, by + bh / 2), (old['bbox'][0] + old['bbox'][2] / 2, old['bbox'][1] + old['bbox'][3] / 2)) > 30 * scale for old in result):
                    result.append({'kind': 'blue_elephant_candidate', 'bbox': [bx, by, bw, bh],
                                   'blocking_bbox': None, 'blocking_status': 'unknown', 'assumed_role': 'blocker',
                                   'detection_source': 'appearance_template', 'similarity': round(float(score), 3)})
    return result


def mark_unknown_entities(image, entities, grid=None):
    """紫框仅表示未知物件可见颜色区域，不表示碰撞范围。"""
    for entity in entities:
        if grid:
            ox, oy, step, _, _ = grid
            conflicts = {tuple(cell) for cell in entity.get('grid_conflicts', [])}
            assumed = {tuple(cell) for cell in entity.get('estimated_blockers_after_overlap', entity.get('estimated_grid_cells', []))}
            for col, row in entity.get('estimated_grid_cells', []):
                left, top = round(ox + (col - 0.5) * step), round(oy + (row - 0.5) * step)
                right, bottom = round(ox + (col + 0.5) * step), round(oy + (row + 0.5) * step)
                color = (0, 140, 255) if (col, row) in conflicts or (col, row) not in assumed else (255, 255, 0)
                cv2.rectangle(image, (left, top), (right, bottom), color, 1)
        x, y, width, height = entity['bbox']
        cv2.rectangle(image, (x, y), (x + width, y + height), (255, 0, 255), 2)
        cv2.putText(image, 'UNKNOWN BLOCK', (x, max(12, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 0, 255), 1, cv2.LINE_AA)
    return image


def estimate_entity_blockers(entities, grid, occupied):
    """将图像框覆盖的格子中心映射为暂定障碍，保留与已识别对象的冲突。"""
    ox, oy, step, columns, rows = grid
    fixed, conflicts = set(), set()
    for entity in entities:
        x, y, width, height = entity['bbox']
        projected = {(col, row) for row in range(rows) for col in range(columns)
                     if x <= ox + col * step < x + width and y <= oy + row * step < y + height}
        if not projected:
            raise ValueError('未知物件图像框未覆盖任何网格中心')
        entity['estimated_grid_cells'] = [list(cell) for cell in sorted(projected)]
        entity['grid_conflicts'] = [list(cell) for cell in sorted(projected & occupied)]
        conflicts.update(projected & occupied)
        fixed.update(projected - occupied)
    if not fixed:
        raise ValueError('未知物件未得到可用的暂定阻挡格')
    return tuple(sorted(fixed)), tuple(sorted(conflicts))


def mark_ducks(image, ducks):
    """用黄色边框标示鸭子候选，与粉色猪的视觉范围区分。"""
    for duck in ducks:
        x, y, width, height = duck['bbox']
        cv2.rectangle(image, (x - 2, y - 2), (x + width + 2, y + height + 2), (0, 210, 255), 2)
        cv2.putText(image, 'D' + str(duck['id']), (x, max(12, y - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(image, 'D' + str(duck['id']), (x, max(12, y - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 210, 255), 1, cv2.LINE_AA)
    return image


def ui_match(image, name):
    """对指定游戏窗口里的固定区域做模板匹配，返回相似度而非直接点击。"""
    filename, (x, y, width, height) = UI_TEMPLATES[name]
    template = cv2.imread(str(ROOT / 'docs/references/pig-game' / filename), cv2.IMREAD_GRAYSCALE)
    if template is None:
        raise ValueError('缺少界面参考模板: ' + filename)
    resized = cv2.resize(image, REFERENCE_SIZE, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    area = gray[y:y + height, x:x + width]
    if area.shape[0] < template.shape[0] or area.shape[1] < template.shape[1]:
        return 0.0
    return float(cv2.matchTemplate(area, template, cv2.TM_CCOEFF_NORMED).max())


def ui_state(image):
    """需要标题和对应按钮同时匹配才认为是可点击的通关或领奖界面。"""
    if ui_match(image, 'animal_guide_title') > 0.85 and ui_match(image, 'animal_guide_close') > 0.9:
        return 'animal_guide'
    if ui_match(image, 'reward_title') > 0.8 and ui_match(image, 'collect') > 0.86:
        return 'reward'
    if ui_match(image, 'ranking_title') > 0.8:
        return 'ranking'
    if ui_match(image, 'victory_title') > 0.76 and ui_match(image, 'next') > 0.86:
        return 'victory'
    return 'unknown'


def infer_grid(pigs, image_size):
    """从横竖猪的两格中心拟合格距和原点，排除重叠、越界与高误差。"""
    if len(pigs) < 3:
        raise ValueError('候选太少，无法自动校准网格')
    scale = image_size[0] / 529.0
    best = None
    for step in np.arange(25.0 * scale, 35.01 * scale, 0.1 * scale):
        adjusted = []
        for pig in pigs:
            cx, cy = pig['center']
            width, height = pig['bbox'][2:]
            length = round((max(width, height) + step * 0.5) / step)
            if length not in (2, 3):
                break
            if width > height * 1.25:
                adjusted.append((cx - step * (length - 1) / 2, cy, True, length))
            elif height > width * 1.25:
                adjusted.append((cx, cy - step * (length - 1) / 2, False, length))
            else:
                break
        if len(adjusted) != len(pigs):
            continue
        coords = np.asarray([(x, y) for x, y, _, _ in adjusted])
        phase = []
        for axis in range(2):
            radians = coords[:, axis] * (2 * math.pi / step)
            phase.append((math.atan2(float(np.sin(radians).mean()), float(np.cos(radians).mean())) % (2 * math.pi)) * step / (2 * math.pi))
        indices = np.rint((coords - np.asarray(phase)) / step).astype(int)
        mins = indices.min(axis=0)
        indices -= mins
        origin = np.asarray(phase) + mins * step
        residuals = np.linalg.norm(coords - (origin + indices * step), axis=1)
        occupied = set()
        overlap = 0
        cols = rows = 0
        for (col, row), (_, _, horizontal, length) in zip(indices, adjusted):
            cells = [(int(col + offset), int(row)) if horizontal else (int(col), int(row + offset)) for offset in range(length)]
            for cell in cells:
                if cell in occupied:
                    overlap += 1
                occupied.add(cell)
                cols, rows = max(cols, cell[0] + 1), max(rows, cell[1] + 1)
        score = float(np.mean(np.minimum(residuals, 20) ** 2)) + overlap * 1000
        if best is None or score < best[0]:
            best = (score, (float(origin[0]), float(origin[1]), float(step), cols, rows), float(max(residuals)), overlap)
    if best is None or best[3] or best[2] > 12 or best[0] > 40:
        raise ValueError('无法可靠自动校准网格，请复核识别结果')
    return best[1]


def render_solution(image, pigs, actions):
    """在初始位置标注实际生效步骤；同一只猪多次点击显示全部步骤号。"""
    scale = 2
    height, width = image.shape[:2]
    rows = max(1, (height * scale - 100) // 28)
    panel_width = 330
    columns = max(1, math.ceil(len(actions) / rows))
    canvas = np.full((height * scale, width * scale + columns * panel_width, 3), 245, np.uint8)
    canvas[:height * scale, :width * scale] = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    occurrences = defaultdict(list)
    for number, action in enumerate(actions, 1):
        occurrences[action['pig_id']].append(number)
    for pig in pigs:
        numbers = occurrences.get(pig['id'], [])
        if not numbers:
            continue
        text = '/'.join(map(str, numbers))
        cx, cy = (round(value * scale) for value in pig['center'])
        (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.54, 1)
        x = max(0, min(width * scale - tw - 8, cx - tw // 2 - 4))
        y = max(th + 5, min(height * scale - baseline - 5, cy))
        cv2.rectangle(canvas, (x, y - th - 4), (x + tw + 8, y + baseline + 2), (25, 25, 25), -1)
        cv2.putText(canvas, text, (x + 4, y), cv2.FONT_HERSHEY_SIMPLEX, 0.54, (255, 255, 255), 1, cv2.LINE_AA)
    for column in range(columns):
        cv2.putText(canvas, 'STEP  PIG  ACTION', (width * scale + 12 + column * panel_width, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (20, 20, 20), 1, cv2.LINE_AA)
    for index, action in enumerate(actions):
        column, row = divmod(index, rows)
        verb = 'exit' if action['exited'] else f"slide {action['travel_cells']}"
        label = f"{index + 1:02d}    {action['pig_id']:02d}   {verb}"
        cv2.putText(canvas, label, (width * scale + 12 + column * panel_width, 65 + row * 28), cv2.FONT_HERSHEY_SIMPLEX, 0.53, (20, 20, 20), 1, cv2.LINE_AA)
    return canvas
