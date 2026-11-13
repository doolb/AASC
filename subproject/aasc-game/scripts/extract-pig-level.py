#!/usr/bin/env python3
"""只从已有图片或 X11 屏幕截图提取小猪候选，不访问游戏内部或发送输入。"""
import argparse
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

import cv2
import numpy as np


BASE_WIDTH = 529
BASE_HEIGHT = 941
DEFAULT_BOARD = (74, 263, 391, 472)
DIRECTIONS = ('east', 'south_east', 'south', 'south_west', 'west', 'north_west', 'north', 'north_east')
# OpenCV 使用 BGR；不同方向使用固定配色，图例与箭头共用此映射。
DIRECTION_COLORS = {
    'east': (220, 80, 0), 'south_east': (180, 50, 170),
    'south': (20, 30, 225), 'south_west': (0, 110, 235),
    'west': (130, 140, 0), 'north_west': (45, 85, 145),
    'north': (25, 150, 30), 'north_east': (220, 150, 0),
}


def parse_rect(text):
    try:
        values = tuple(int(value) for value in text.split(','))
        if len(values) != 4 or min(values) < 0 or values[2] < 1 or values[3] < 1:
            raise ValueError()
        return values
    except ValueError as error:
        raise argparse.ArgumentTypeError('区域格式应为 x,y,width,height，坐标非负且宽高大于 0') from error


def parse_grid(text):
    try:
        parts = text.split(',')
        if len(parts) != 5:
            raise ValueError()
        x, y, size = (float(item) for item in parts[:3])
        cols, rows = (int(item) for item in parts[3:])
        if not all(math.isfinite(value) for value in (x, y, size)) or x < 0 or y < 0 or size <= 0 or not (1 <= cols <= 500 and 1 <= rows <= 500):
            raise ValueError()
        return x, y, size, cols, rows
    except ValueError as error:
        raise argparse.ArgumentTypeError('网格格式应为 x,y,格距,列数,行数') from error


def parse_window_id(text):
    try:
        value = int(text, 0)
        if value <= 0:
            raise ValueError()
        return value
    except ValueError as error:
        raise argparse.ArgumentTypeError('窗口 ID 必须是大于零的十进制数或 0x 开头的十六进制数') from error


def verify_game_window(image):
    """在窗口上部查找已采集的游戏标题；不匹配时不得保存截图。"""
    template_path = Path(__file__).resolve().parent.parent / 'docs/references/pig-game/title-template.png'
    template = cv2.imread(str(template_path), cv2.IMREAD_GRAYSCALE)
    if template is None:
        raise ValueError('缺少游戏标题参考图片')
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    header = gray[:max(1, round(gray.shape[0] * 0.2)), :]
    for scale in np.linspace(0.75, 1.5, 16):
        resized = cv2.resize(template, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
        if resized.shape[0] <= header.shape[0] and resized.shape[1] <= header.shape[1]:
            if cv2.matchTemplate(header, resized, cv2.TM_CCOEFF_NORMED).max() >= 0.85:
                return
    raise ValueError('窗口画面未匹配到游戏标题；请确认窗口 ID 和窗口可见')


def read_image(source, display, crop, window_id):
    """只截取指定 X11 窗口，标题验证通过后才允许持久化。"""
    if source:
        raw = Path(source).read_bytes()
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError('无法读取图片')
        return image, {'kind': 'image', 'file': str(source)}
    try:
        x11 = ctypes.CDLL('libX11.so.6')
        x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
        x11.XOpenDisplay.restype = ctypes.c_void_p
        x11.XScreenCount.argtypes = [ctypes.c_void_p]
        x11.XScreenCount.restype = ctypes.c_int
        x11.XRootWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
        x11.XRootWindow.restype = ctypes.c_ulong
        x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
        connection = x11.XOpenDisplay(display.encode())
        if not connection:
            raise ValueError('无法连接 X11 显示器')
        try:
            if any(window_id == x11.XRootWindow(connection, screen) for screen in range(x11.XScreenCount(connection))):
                raise ValueError('禁止截取 X11 根窗口')
        finally:
            x11.XCloseDisplay(connection)
        result = subprocess.run(['import', '-display', display, '-window', hex(window_id), 'png:-'], check=True, capture_output=True, timeout=15)
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f'X11 截图失败，请确认 DISPLAY 和 ImageMagick import：{error}') from error
    image = cv2.imdecode(np.frombuffer(result.stdout, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('X11 截图无法解码')
    verify_game_window(image)
    if crop:
        x, y, width, height = crop
        if x + width > image.shape[1] or y + height > image.shape[0]:
            raise ValueError('裁剪区域超出指定窗口')
        image = image[y:y + height, x:x + width].copy()
    return image, {'kind': 'x11', 'display': display, 'window_id': hex(window_id), 'window_crop': list(crop) if crop else None}


def valid_board(image, board):
    height, width = image.shape[:2]
    if board is None:
        x, y, w, h = DEFAULT_BOARD
        board = (round(x * width / BASE_WIDTH), round(y * height / BASE_HEIGHT), round(w * width / BASE_WIDTH), round(h * height / BASE_HEIGHT))
    x, y, w, h = board
    if x < 0 or y < 0 or w < 1 or h < 1 or x + w > width or y + h > height:
        raise ValueError('棋盘区域超出图片；请用 --board 指定正确范围')
    return board


def direction_for(image, bbox, mean, axis, scale):
    """沿身体主轴比较两端暗色头部特征；遮挡或双端不明确时不猜测。"""
    x, y, width, height = bbox
    padding = max(2, round(8 * scale))
    x0, y0 = max(0, x - padding), max(0, y - padding)
    x1, y1 = min(image.shape[1], x + width + padding), min(image.shape[0], y + height + padding)
    gray = cv2.cvtColor(image[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    hsv_roi = cv2.cvtColor(image[y0:y1, x0:x1], cv2.COLOR_BGR2HSV)
    # 红色引导边框在灰度图里也很暗，必须排除，否则会被误认作猪眼睛。
    red = (hsv_roi[:, :, 0] < 10) & (hsv_roi[:, :, 1] > 180) & (hsv_roi[:, :, 2] > 160)
    dy, dx = np.where((gray < 100) & ~red)
    if len(dx) == 0:
        return None, 'low', 0, 0, None
    delta = np.column_stack((dx + x0 - mean[0], dy + y0 - mean[1]))
    projection = delta @ axis
    perpendicular = np.abs(delta @ np.array([-axis[1], axis[0]]))
    length = math.hypot(width, height) / 2
    within = perpendicular < min(width, height) * 0.6
    positive = int(np.count_nonzero((projection > length * 0.35) & within))
    negative = int(np.count_nonzero((projection < -length * 0.35) & within))
    total = positive + negative
    separation = abs(positive - negative) / max(total, 1)
    # 大量暗像素通常来自手势、边框、遮挡或邻接物，而不是一对眼睛。
    if total < max(3, int(3 * scale * scale)) or total > 80 * scale * scale or separation < 0.4:
        return None, 'low', positive, negative, None
    vector = axis if positive > negative else -axis
    degrees = math.degrees(math.atan2(float(vector[1]), float(vector[0]))) % 360
    index = int(math.floor((degrees + 22.5) / 45)) % 8
    return DIRECTIONS[index], 'low' if total < 5 * scale * scale else 'medium', positive, negative, round(degrees, 1)



def direction_candidate_scores(axis, positive, negative):
    """用八个单位向量模板分别评估主轴和头部证据；分数只作复核依据。"""
    total = positive + negative
    scores = {}
    for index, name in enumerate(DIRECTIONS):
        angle = math.radians(index * 45)
        projection = float(axis[0]) * math.cos(angle) + float(axis[1]) * math.sin(angle)
        head = positive if projection >= 0 else negative
        scores[name] = round(abs(projection) * head / max(total, 1), 4)
    return scores

def find_gesture(image, board):
    """使用已记录的游戏引导手指模板查找遮挡，未命中时不推测存在手指。"""
    path = Path(__file__).resolve().parent.parent / 'docs/references/pig-game/gesture-template.png'
    template = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if template is None:
        raise ValueError('缺少游戏引导手指参考图片')
    hsv = cv2.cvtColor(template, cv2.COLOR_BGR2HSV)
    mask = np.uint8((hsv[:, :, 1] < 45) & (hsv[:, :, 2] > 45)) * 255
    x, y, width, height = board
    area = image[y:y + height, x:x + width]
    scale = math.sqrt((image.shape[1] / BASE_WIDTH) * (image.shape[0] / BASE_HEIGHT))
    best = None
    for ratio in np.linspace(0.85, 1.15, 7):
        size = (max(1, round(template.shape[1] * scale * ratio)), max(1, round(template.shape[0] * scale * ratio)))
        if size[0] > width or size[1] > height:
            continue
        sample = cv2.resize(template, size, interpolation=cv2.INTER_LINEAR)
        sample_mask = cv2.resize(mask, size, interpolation=cv2.INTER_NEAREST)
        scores = cv2.matchTemplate(area, sample, cv2.TM_SQDIFF_NORMED, mask=sample_mask)
        score, _, position, _ = cv2.minMaxLoc(scores)
        if math.isfinite(score) and (best is None or score < best[0]):
            best = (score, (x + position[0], y + position[1], size[0], size[1]))
    # 阈值按已保存的有手指和无手指参考图检验，结果仍是候选。
    return [list(best[1])] if best and best[0] < 0.035 else []


def mark_red_highlight(image, pigs, scale):
    """将明显红色提示唯一关联到身体；轮廓可跨入相邻候选，不能重复标记。"""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (0, 200, 200), (5, 255, 255))
    padding = max(2, round(8 * scale))
    scores = []
    for pig in pigs:
        x, y, width, height = pig['bbox']
        region = mask[max(0, y - padding):min(mask.shape[0], y + height + padding),
                      max(0, x - padding):min(mask.shape[1], x + width + padding)]
        score = cv2.countNonZero(region)
        pig['red_highlight_pixels'] = score
        pig['highlighted_clickable'] = False
        scores.append((score, pig))
    scores.sort(key=lambda entry: entry[0], reverse=True)
    if scores and scores[0][0] >= 90 * scale * scale and (len(scores) == 1 or scores[0][0] > scores[1][0] * 2):
        scores[0][1]['highlighted_clickable'] = True


def identify(image, board=None, gestures=None):
    """坐标均以裁剪后的游戏窗口左上角为原点，自动适应等比缩放。"""
    board = valid_board(image, board)
    if gestures is None:
        gestures = find_gesture(image, board)
    height, width = image.shape[:2]
    scale = math.sqrt((width / BASE_WIDTH) * (height / BASE_HEIGHT))
    x, y, w, h = board
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (0, 30, 140), (12, 180, 255))
    restricted = np.zeros_like(mask)
    restricted[y:y + h, x:x + w] = mask[y:y + h, x:x + w]
    kernel_size = max(3, round(5 * scale))
    if kernel_size % 2 == 0:
        kernel_size += 1
    eroded = cv2.erode(restricted, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)))
    _, labels, stats, _ = cv2.connectedComponentsWithStats(eroded)
    pigs = []
    warnings = []
    for label, (bx, by, bw, bh, area) in enumerate(stats[1:], 1):
        if area <= 100 * scale * scale:
            continue
        if area >= 5000 * scale * scale:
            warnings.append(f'大块相连区域 {int(bx)},{int(by)}，可能包含遮挡或相邻小猪，请检查原图')
            continue
        ys, xs = np.where(labels[by:by + bh, bx:bx + bw] == label)
        points = np.column_stack((xs + bx, ys + by))
        mean = points.mean(axis=0)
        eigenvalues, eigenvectors = np.linalg.eigh(np.cov(points.T))
        if eigenvalues[-1] / max(eigenvalues[0], 0.01) < 1.4:
            continue
        axis = eigenvectors[:, -1]
        if axis[0] < 0:
            axis = -axis
        bbox = tuple(int(value) for value in (bx, by, bw, bh))
        heading, confidence, positive, negative, degrees = direction_for(image, bbox, mean, axis, scale)
        direction_scores = direction_candidate_scores(axis, positive, negative)
        ranked_scores = sorted(direction_scores.values(), reverse=True)
        # 身体轴落在相邻方向的分界附近时，不能把微小角度误差当作确定方向。
        if ranked_scores[0] - ranked_scores[1] < 0.04:
            heading, confidence, degrees = None, 'low', None
        # 手指覆盖身体时无法证明眼睛未受干扰，不把候选方向当作可靠结果。
        obscured = any(bx < gx + gw and bx + bw > gx and by < gy + gh and by + bh > gy
                       for gx, gy, gw, gh in gestures)
        if obscured:
            heading, confidence, degrees = None, 'low', None
        cx, cy = float(bx + bw / 2), float(by + bh / 2)
        # 身体连通域因腐蚀会漏掉头尾；另给一个扩展的视觉候选框，不作为碰撞框。
        pad = max(4, round(9 * scale))
        vx, vy = max(0, int(bx) - pad), max(0, int(by) - pad)
        vr, vb = min(width, int(bx + bw) + pad), min(height, int(by + bh) + pad)
        pigs.append({
            'center': [round(cx, 1), round(cy, 1)],
            'normalized_center': [round(cx / width, 6), round(cy / height, 6)],
            'bbox': list(bbox), 'visual_bbox': [vx, vy, vr - vx, vb - vy],
            'direction': heading or 'unknown', 'direction_degrees': degrees,
            'confidence': confidence, 'gesture_occluded': obscured,
            'head_dark_pixels': {'axis_positive': positive, 'axis_negative': negative},
            'direction_candidate_scores': direction_scores
        })
    pigs.sort(key=lambda pig: (pig['center'][1], pig['center'][0]))
    for index, pig in enumerate(pigs, 1):
        pig['id'] = index
    mark_red_highlight(image, pigs, scale)
    if not pigs:
        warnings.append('没有识别到候选小猪；请检查截图、棋盘范围和颜色变化')
    if any(pig['direction'] == 'unknown' for pig in pigs):
        warnings.append('存在方向不明确的小猪，需要人工核对标注图和原图')
    if gestures:
        warnings.append('检测到疑似引导手指；重叠小猪方向需要人工核对')
    warnings.append('检测结果均为候选，数量与朝向需要结合原图人工核对')
    return pigs, board, warnings


def apply_grid(pigs, grid, warnings):
    """网格只根据调用者给定参数推算，不把视觉估算伪装为原游戏数据。"""
    ox, oy, step, columns, rows = grid
    occupied = {}
    for pig in pigs:
        pig['blocking_bbox'] = None
        pig['blocking_bbox_source'] = None
        cx, cy = pig['center']
        direction = pig['direction']
        length = pig.get('length')
        if length is None:
            length = round((max(pig['bbox'][2:]) + step * 0.5) / step)
            if length not in (2, 3):
                warnings.append(f"小猪 {pig['id']} 长度无法可靠映射网格")
                pig['grid'] = None
                continue
            pig['length'] = length
        if direction in ('east', 'west'):
            col, row = round((cx - ox - step * (length - 1) / 2) / step), round((cy - oy) / step)
            cells = [[col + offset, row] for offset in range(length)]
        elif direction in ('north', 'south'):
            col, row = round((cx - ox) / step), round((cy - oy - step * (length - 1) / 2) / step)
            cells = [[col, row + offset] for offset in range(length)]
        else:
            pig['grid'] = None
            continue
        if any(not (0 <= x < columns and 0 <= y < rows) for x, y in cells):
            warnings.append(f"小猪 {pig['id']} 推算位置超出用户给定网格")
            pig['grid'] = None
            continue
        for cell in cells:
            key = tuple(cell)
            if key in occupied:
                warnings.append(f"小猪 {pig['id']} 与 {occupied[key]} 的推算网格重叠")
            occupied[key] = pig['id']
        pig['grid'] = {'col': col, 'row': row, 'cells': cells}
        # 格子中心和格距只能给出求解器使用的估计占位，不是原游戏的碰撞数据。
        left = round(ox + (min(cell[0] for cell in cells) - 0.5) * step)
        top = round(oy + (min(cell[1] for cell in cells) - 0.5) * step)
        right = round(ox + (max(cell[0] for cell in cells) + 0.5) * step)
        bottom = round(oy + (max(cell[1] for cell in cells) + 0.5) * step)
        pig['blocking_bbox'] = [left, top, right - left, bottom - top]
        pig['blocking_bbox_source'] = 'estimated_grid_occupancy'


def annotate(image, pigs, board, gestures):
    """左侧保留截图和编号，右侧列表显示精确坐标和朝向。"""
    height, width = image.shape[:2]
    output_height = max(height, 180)
    rows = max(1, (output_height - 160) // 20)
    columns = max(1, math.ceil(len(pigs) / rows))
    panel_width = 270
    result = np.full((output_height, width + panel_width * columns, 3), 245, dtype=np.uint8)
    result[:height, :width] = image
    for index, direction in enumerate(DIRECTIONS):
        px = width + 10 + (index % 2) * 130
        py = 24 + (index // 2) * 22
        cv2.rectangle(result, (px, py - 9), (px + 14, py + 3), DIRECTION_COLORS[direction], -1)
        cv2.putText(result, direction, (px + 20, py + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (30, 30, 30), 1, cv2.LINE_AA)
    for column in range(columns):
        px = width + 10 + column * panel_width
        cv2.putText(result, 'ID   X, Y       DIRECTION', (px, 126), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (30, 30, 30), 1, cv2.LINE_AA)
    cv2.putText(result, 'CYAN: GRID ESTIMATE', (width + 10, 111), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (120, 120, 0), 1, cv2.LINE_AA)
    for index, pig in enumerate(pigs):
        column, row = divmod(index, rows)
        px = width + 10 + column * panel_width
        text = f"{pig['id']:02d}  {pig['center'][0]:.1f}, {pig['center'][1]:.1f}  {pig['direction']}"
        cv2.putText(result, text, (px, 150 + row * 20), cv2.FONT_HERSHEY_SIMPLEX, 0.39, (20, 20, 20), 1, cv2.LINE_AA)
    for x, y, w, h in gestures:
        cv2.rectangle(result, (x, y), (x + w, y + h), (255, 0, 255), 2)
    x, y, w, h = board
    cv2.rectangle(result, (x, y), (x + w, y + h), (255, 180, 30), 1)
    for pig in pigs:
        x, y, w, h = pig['bbox']
        color = (0, 145, 255) if pig['direction'] == 'unknown' else (20, 230, 20)
        if pig.get('highlighted_clickable'):
            color = (0, 0, 255)
        vx, vy, vw, vh = pig.get('visual_bbox', pig['bbox'])
        cv2.rectangle(result, (vx, vy), (vx + vw, vy + vh), color, 1)
        if pig.get('blocking_bbox'):
            bx, by, bw, bh = pig['blocking_bbox']
            cv2.rectangle(result, (bx, by), (bx + bw, by + bh), (255, 255, 0), 1)
        cx, cy = (round(value) for value in pig['center'])
        if pig['direction_degrees'] is not None:
            angle = math.radians(pig['direction_degrees'])
            distance = max(w, h) * 0.5
            endpoint = (round(cx + math.cos(angle) * distance), round(cy + math.sin(angle) * distance))
            cv2.arrowedLine(result, (cx, cy), endpoint, (15, 15, 15), 4, tipLength=0.3)
            cv2.arrowedLine(result, (cx, cy), endpoint, DIRECTION_COLORS[pig['direction']], 2, tipLength=0.3)
        cv2.putText(result, str(pig['id']), (x, max(12, y - 2)), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(result, str(pig['id']), (x, max(12, y - 2)), cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1, cv2.LINE_AA)
        if pig.get('highlighted_clickable'):
            cv2.putText(result, 'HINT', (x, y + h + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 220), 1, cv2.LINE_AA)
    return result


def publish_directory(staging, output):
    """Linux 原子地发布目录，禁止替换已有输出，避免并发覆盖。"""
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(staging), -100, os.fsencode(output), 1) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), str(output))


def main(argv=None):
    parser = argparse.ArgumentParser(description='只读 X11 截图或图片，提取猪的位置和朝向候选。')
    parser.add_argument('--level', required=True, type=int, help='关卡编号（正整数）')
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--image', type=Path, help='已保存的游戏窗口截图')
    source.add_argument('--window-id', type=parse_window_id, help='X11 游戏窗口 ID，例如 0x3c00003')
    parser.add_argument('--display', default=':1', help='X11 显示器，默认 :1')
    parser.add_argument('--crop', type=parse_rect, help='可选 X11 窗口内裁剪区域 x,y,宽,高')
    parser.add_argument('--board', type=parse_rect, help='棋盘在游戏截图内的 x,y,宽,高；默认按参考窗口等比缩放')
    parser.add_argument('--grid', type=parse_grid, help='可选人工校准网格：首格中心 x,y,格距,列数,行数')
    parser.add_argument('--output', type=Path, help='新输出目录；默认 docs/references/pig-game/extractions/level-编号')
    args = parser.parse_args(argv)
    if args.level <= 0:
        parser.error('关卡编号必须大于 0')
    if args.image and args.crop:
        parser.error('--crop 仅适用于 X11 窗口')
    output = args.output or Path('docs/references/pig-game/extractions') / f'level-{args.level:02d}'
    output = output.absolute()
    if output.exists():
        parser.error(f'输出目录已存在，不覆盖：{output}')
    started = time.perf_counter()
    try:
        image, source = read_image(args.image, args.display, args.crop, args.window_id)
        captured = time.perf_counter()
        board = valid_board(image, args.board)
        gestures = find_gesture(image, board)
        pigs, board, warnings = identify(image, board, gestures)
        if args.grid:
            apply_grid(pigs, args.grid, warnings)
        marked = annotate(image, pigs, board, gestures)
        analyzed = time.perf_counter()
        output.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=f'.{output.name}-', dir=output.parent))
        try:
            original = staging / 'original.png'
            if not cv2.imwrite(str(original), image) or not cv2.imwrite(str(staging / 'annotated.png'), marked):
                raise OSError('截图写入失败')
            data = {'level': args.level, 'status': 'candidates_unverified', 'source': source,
                    'original_sha256': hashlib.sha256(original.read_bytes()).hexdigest(),
                    'image_size': [image.shape[1], image.shape[0]], 'board': list(board),
                    'grid_parameters': list(args.grid) if args.grid else None, 'gesture_candidates': gestures,
                    'coordinates': '游戏窗口左上角为原点，x 向右，y 向下；角度从右侧顺时针',
                    'count': len(pigs), 'unknown_directions': sum(pig['direction'] == 'unknown' for pig in pigs),
                    'warnings': warnings, 'pigs': pigs,
                    'timing_ms': {'capture_or_read': round((captured - started) * 1000, 1), 'recognition': round((analyzed - captured) * 1000, 1)}}
            (staging / 'level.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            publish_directory(staging, output)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
        print(f"关卡 {args.level}：候选 {len(pigs)} 只，方向待核对 {data['unknown_directions']} 只；输出 {output}")
        print('结果是截图候选，请检查 annotated.png 与 original.png。')
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f'提取失败：{error}\n')


if __name__ == '__main__':
    raise SystemExit(main())
