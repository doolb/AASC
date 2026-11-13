#!/usr/bin/env python3
"""复用 AASC OCR CLI 对关卡标题和疑似锁的局部图片识别。"""
import json
import os
from pathlib import Path
import re
import subprocess
import time

import cv2
import numpy as np

AASC_ROOT = Path(__file__).resolve().parents[3]
OCR_SCRIPT = AASC_ROOT / 'scripts/api/vision-ocr.js'
MIN_SCORE = 0.90


def title_box(image):
    """根据已验证的游戏窗口尺寸定位顶部关卡标题，不包含金币。"""
    height, width = image.shape[:2]
    return (round(width * 204 / 530), round(height * 87 / 942),
            round(width * 131 / 530), round(height * 48 / 942))


def looks_like_lock(image, candidate):
    """数字锁通常有较多深色字边；这是候选筛选，不能据此判定为锁。"""
    x, y, width, height = candidate['bbox']
    region = image[max(0, y):y + height, max(0, x):x + width]
    if region.size == 0:
        return False
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    scale = (image.shape[1] / 530) * (image.shape[0] / 942)
    return int(np.count_nonzero(gray < 95)) >= max(12, round(25 * scale))


def crop_image(image, bbox, padding=0):
    x, y, width, height = (int(value) for value in bbox)
    left, top = max(0, x - padding), max(0, y - padding)
    right, bottom = min(image.shape[1], x + width + padding), min(image.shape[0], y + height + padding)
    if right <= left or bottom <= top:
        raise ValueError('OCR 局部区域无效')
    return image[top:bottom, left:right], [left, top, right - left, bottom - top]


def request_crop(crop, image_path, options):
    """顺序调用现有 CLI；不通过 shell 拼接参数，避免并发占用显示端。"""
    if not cv2.imwrite(str(image_path), crop):
        raise OSError('无法保存 OCR 局部图片')
    command = ['node', str(OCR_SCRIPT), '--image', str(image_path), '--short-side', str(options['short_side'])]
    if options.get('display_id'):
        command.extend(['--display', options['display_id']])
    env = dict(os.environ, AASC_TIMEOUT_SECONDS=str(options['timeout']))
    for attempt in range(2):
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=options['timeout'] + 5, env=env)
        except (OSError, subprocess.TimeoutExpired) as error:
            return {'status': 'error', 'message': str(error)[:300]}
        try:
            payload = json.loads(result.stdout)
        except (TypeError, json.JSONDecodeError):
            return {'status': 'error', 'message': (result.stderr or result.stdout or 'OCR 返回无效 JSON')[:300]}
        if isinstance(payload, dict) and payload.get('status') == 'error' and '忙' in str(payload.get('message', '')) and attempt == 0:
            time.sleep(0.5)
            continue
        if result.returncode or not isinstance(payload, dict) or payload.get('success') is not True or payload.get('status') == 'error':
            return {'status': 'error', 'message': str(payload.get('message', 'OCR 请求失败'))[:300] if isinstance(payload, dict) else 'OCR 返回无效对象'}
        if payload.get('imageWidth') != crop.shape[1] or payload.get('imageHeight') != crop.shape[0]:
            return {'status': 'error', 'message': 'OCR 返回图片尺寸与裁剪图不一致'}
        return payload
    return {'status': 'error', 'message': 'OCR 显示端繁忙'}


def recognized_number(payload, kind):
    """只接受一个高置信的独立数字；歧义或格式不合格时返回未知。"""
    values = []
    for box in payload.get('boxes', []):
        if not isinstance(box, dict) or not isinstance(box.get('text'), str):
            continue
        score = box.get('score')
        if not isinstance(score, (int, float)) or not np.isfinite(score) or score < MIN_SCORE:
            continue
        points = box.get('points')
        width, height = payload.get('imageWidth'), payload.get('imageHeight')
        if not isinstance(points, list) or len(points) < 3 or not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
            continue
        if any(not isinstance(point, list) or len(point) != 2 or any(not isinstance(v, (int, float)) or not np.isfinite(v) for v in point)
               or not (0 <= point[0] <= width and 0 <= point[1] <= height) for point in points):
            continue
        text = re.sub(r'\s+', '', box['text'])
        match = re.fullmatch(r'第(\d{1,4})关', text) if kind == 'title' else re.fullmatch(r'\d{1,3}', text)
        if match:
            number = int(match.group(1) if kind == 'title' else match.group(0))
            if kind == 'title' and number == 0:
                continue
            values.append((number, float(score), text))
    unique = {value[0] for value in values}
    if len(unique) != 1:
        return None
    number, score, text = max(values, key=lambda item: item[1])
    return {'value': number, 'score': score, 'text': text}


def inspect(image, output, yellow_candidates, known_locks, options):
    """先裁剪再识别；只对有数字特征的黄色候选请求 OCR。"""
    evidence = output / 'ocr'
    evidence.mkdir(exist_ok=True)
    record = {'status': 'success', 'title': None, 'locks': [], 'errors': []}
    title, title_rect = crop_image(image, title_box(image))
    payload = request_crop(title, evidence / 'title.png', options)
    record['title'] = {'bbox': title_rect, 'image': 'ocr/title.png', 'result': payload,
                       'recognized': recognized_number(payload, 'title')}
    if payload.get('status') == 'error':
        record['status'] = 'unavailable'
        record['errors'].append('标题 OCR：' + payload.get('message', '请求失败'))
        return record, known_locks
    if record['title']['recognized'] is None:
        record['status'] = 'partial'
        record['errors'].append('标题 OCR 无唯一高置信关卡编号，使用原有识别')
    existing = {tuple(item['bbox']): dict(item) for item in known_locks}
    rotation_map = {'north': 0, 'south': 180, 'west': 90, 'east': 270}
    rotations = {0: None, 90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    for candidate in yellow_candidates:
        key = tuple(candidate['bbox'])
        old = existing.get(key)
        if old is None and not looks_like_lock(image, candidate):
            continue
        padding = max(3, round(8 * image.shape[1] / 530))
        crop, rect = crop_image(image, candidate['bbox'], padding)
        preferred = rotation_map.get(old.get('direction') if old else None)
        angles = [preferred] if preferred is not None else [0, 90, 270, 180]
        attempts = []
        for angle in angles:
            rotated = crop if angle == 0 else cv2.rotate(crop, rotations[angle])
            filename = f"lock-{candidate['id']:02d}-{angle}.png"
            payload = request_crop(rotated, evidence / filename, options)
            number = recognized_number(payload, 'number')
            attempts.append({'rotation': angle, 'image': 'ocr/' + filename, 'result': payload, 'recognized': number})
            if number is not None or payload.get('status') == 'error':
                break
        entry = {'candidate_id': candidate['id'], 'bbox': rect, 'attempts': attempts}
        record['locks'].append(entry)
        if payload.get('status') == 'error':
            record['status'] = 'partial'
            record['errors'].append(f"锁候选 {candidate['id']} OCR：" + payload.get('message', '请求失败'))
            continue
        if number is None:
            if old is not None:
                record['status'] = 'partial'
                record['errors'].append(f"锁候选 {candidate['id']} OCR 无唯一高置信数字，使用原有识别")
            continue
        lock = old if old is not None else dict(candidate, kind='locked_pig_candidate', detection_source='ocr')
        original_count = lock.get('unlock_exits')
        lock['ocr_count'] = number['value']
        lock['ocr_score'] = number['score']
        if original_count is not None and original_count != number['value']:
            # 与人工模板冲突时保留两种证据，但禁止自动假定哪一个正确。
            lock.pop('unlock_exits', None)
            lock['count_conflict'] = {'template': original_count, 'ocr': number['value']}
        else:
            lock['unlock_exits'] = number['value']
        existing[key] = lock
    return record, list(existing.values())
