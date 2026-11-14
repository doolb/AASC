#!/usr/bin/env python3
"""从当前棋盘提取铁笼候选；方向被遮挡时不推测笼内小猪。"""
import cv2
import numpy as np


def detect(image, board):
    """提取灰蓝笼条并闭合条间空隙，保留 L 形等实际轮廓。"""
    if image is None or image.size == 0:
        raise ValueError('铁笼图像无效')
    height, width = image.shape[:2]
    scale = width / 530
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    blue = cv2.inRange(hsv, (94, 28, 55), (114, 160, 245))
    restricted = np.zeros_like(blue)
    x, y, w, h = board
    restricted[y:y+h, x:x+w] = blue[y:y+h, x:x+w]
    def kernel(size):
        n = max(1, round(size * scale))
        return cv2.getStructuringElement(cv2.MORPH_RECT, (n, n))
    joined = cv2.morphologyEx(restricted, cv2.MORPH_CLOSE, kernel(9))
    filled = cv2.morphologyEx(joined, cv2.MORPH_CLOSE, kernel(29))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(filled)
    result = []
    for i in range(1, count):
        bx, by, bw, bh, area = (int(v) for v in stats[i])
        if bw < 55*scale or bh < 55*scale or area < 1200*scale*scale:
            continue
        # 大片蓝色背景和实体小象不是细栏杆；不据其生成笼体占格。
        if bw > w*.8 or bh > h*.8:
            continue
        blue_area = cv2.countNonZero(restricted[by:by+bh, bx:bx+bw])
        if blue_area > bw*bh*.35:
            continue
        mask = np.uint8(labels == i) * 255
        # 检查笼体内实际灰蓝像素，不把仅经闭合得到的区域当真实物件。
        if cv2.countNonZero(cv2.bitwise_and(restricted, mask)) < 500*scale*scale:
            continue
        # 计数字体会遮住栏杆并产生封闭空洞；填充轮廓内部但保留 L 形外边界。
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(mask, contours, -1, 255, cv2.FILLED)
        result.append({'bbox': [bx, by, bw, bh], 'mask': mask})
    return result


def contains(cage, point):
    x, y = (int(round(v)) for v in point)
    mask = cage['mask']
    return 0 <= y < mask.shape[0] and 0 <= x < mask.shape[1] and bool(mask[y, x])


def cells(cages, grid):
    """用每个网格中心投影笼体轮廓，允许非矩形和多个笼体。"""
    x0, y0, step, columns, rows = grid
    return {(col, row) for col in range(columns) for row in range(rows)
            if any(contains(cage, (x0 + col*step, y0 + row*step)) for cage in cages)}


def public(cage):
    return {key: value for key, value in cage.items() if key != 'mask'}


def counter_boxes(image, cage):
    """定位大号黑边数字，再交 OCR 识别，不从像素形状猜具体数字。"""
    x, y, width, height = cage['bbox']
    scale = image.shape[1] / 530
    gray = cv2.cvtColor(image[y:y+height, x:x+width], cv2.COLOR_BGR2GRAY)
    mask = cv2.threshold(gray, 65, 255, cv2.THRESH_BINARY_INV)[1]
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    candidates = []
    for index in range(1, count):
        bx, by, bw, bh, area = (int(v) for v in stats[index])
        if not (8*scale <= bw <= 90*scale and 20*scale <= bh <= 65*scale and area >= 100*scale*scale):
            continue
        if not contains(cage, (x + bx + bw/2, y + by + bh/2)):
            continue
        candidates.append([x + bx, y + by, bw, bh])
    # 数字内部孔洞的深色连通域不是另一个数字。
    return [box for box in candidates if not any(box != other and other[0] <= box[0] and other[1] <= box[1]
            and box[0]+box[2] <= other[0]+other[2] and box[1]+box[3] <= other[1]+other[3]
            for other in candidates)]
