#!/usr/bin/env python3
"""执行一次高层提出的棋盘试探，并保存操作前后的真实画面。"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import time

import cv2
import numpy as np
import pig_ocr

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pig_probe_executor', ROOT / 'scripts/pig-nav-execute.py')
executor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(executor)


def check_target(board, point, shape):
    executor.validate_board(board, shape)
    if not isinstance(point, list) or len(point) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) for v in point):
        raise ValueError('试探坐标无效')
    x, y, width, height = board
    if not (x <= point[0] < x + width and y <= point[1] < y + height):
        raise ValueError('试探坐标不在棋盘内')


def same_board(reference, current, board):
    if reference is None or reference.shape != current.shape:
        return False
    x, y, width, height = (round(v) for v in board)
    before = reference[y:y + height, x:x + width].astype(np.int16)
    after = current[y:y + height, x:x + width].astype(np.int16)
    return bool(before.size and np.mean(np.max(np.abs(before - after), axis=2) > 45) < 0.08)


def probe(adapter, reference, board, point, level, output, hypothesis, expectation):
    output.mkdir(parents=True, exist_ok=True)
    before = adapter.capture()
    check_target(board, point, before.shape)
    if not same_board(reference, before, board):
        raise ValueError('现场棋盘与采集画面不一致')
    summary, _ = pig_ocr.inspect(before, output, [], [], {'short_side': 640, 'timeout': 45, 'display_id': None})
    if ((summary.get('title') or {}).get('recognized') or {}).get('value') != level:
        raise ValueError('当前关卡编号未能确认')
    current = adapter.capture()
    if not same_board(before, current, board):
        raise ValueError('识别期间棋盘发生变化')
    if not cv2.imwrite(str(output / 'before.png'), current):
        raise OSError('无法保存试探前截图')
    record = {'level': level, 'point': point, 'hypothesis': hypothesis, 'expectation': expectation, 'status': 'click_started'}
    # 先落盘再点击，中途退出时保留现场不确定的证据。
    with (output / 'result.json').open('x', encoding='utf-8') as handle:
        json.dump(record, handle, ensure_ascii=False, indent=2)
    adapter.click(point, (current.shape[1], current.shape[0]))
    time.sleep(2)
    after = adapter.capture()
    if not cv2.imwrite(str(output / 'after.png'), after):
        raise OSError('无法保存试探后截图')
    comparison = np.hstack((current, after))
    if not cv2.imwrite(str(output / 'comparison.png'), comparison):
        raise OSError('无法保存试探对比图')
    record['status'] = 'observed'
    x, y, width, height = (round(v) for v in board)
    difference = np.max(np.abs(current[y:y + height, x:x + width].astype(np.int16)
                               - after[y:y + height, x:x + width].astype(np.int16)), axis=2)
    # 像素差异包含动画，不能仅据阈值断言棋盘是否变化。
    record['changed_pixel_fraction'] = round(float(np.mean(difference > 45)), 6)
    (output / 'result.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('layout', 'image', 'request', 'output', 'window-id'):
        parser.add_argument('--' + flag, required=True)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--level', required=True, type=int)
    args = parser.parse_args()
    try:
        layout = json.loads(Path(args.layout).read_text(encoding='utf-8'))
        request = json.loads(Path(args.request).read_text(encoding='utf-8'))
        if layout.get('level') != args.level:
            raise ValueError('采集的关卡编号不一致')
        adapter_module = executor.load_executor()
        window = adapter_module.app.player.extract.parse_window_id(args.window_id)
        adapter = adapter_module.app.player.X11Adapter(args.display, window)
        try:
            result = probe(adapter, cv2.imread(args.image), layout['board'], request['point'], args.level,
                           Path(args.output), request['hypothesis'], request['expectation'])
            print(json.dumps(result, ensure_ascii=False))
        finally:
            adapter.close()
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        parser.exit(1, f'试探停止：{error}\n')


if __name__ == '__main__':
    main()
