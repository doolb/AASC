#!/usr/bin/env python3
"""中层独立复核并执行可识别的铁笼关卡；异常时保留现场。"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np
import pig_cage_stage
import pig_ocr

ROOT = Path(__file__).resolve().parent.parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True, type=Path)
    parser.add_argument('--image-sha256', required=True)
    parser.add_argument('--level', required=True, type=int)
    parser.add_argument('--window-id', required=True)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    adapter = None
    try:
        source = (args.evidence / 'original.png').read_bytes()
        candidates = json.loads((args.evidence / 'level.json').read_text(encoding='utf-8'))
        if hashlib.sha256(source).hexdigest() != args.image_sha256 or candidates.get('level') != args.level:
            raise ValueError('铁笼阶段首屏摘要或关卡不匹配')
        middle = load('pig_nav_middle_stage', 'pig-nav-middle.py')
        if not middle.can_handle_cage(source, candidates):
            raise ValueError('笼外物件未能安全确认')
        app = load('pig_nav_cage_auto', 'auto-pig-levels.py')
        probe = load('pig_nav_cage_probe', 'pig-nav-probe.py')
        executor = load('pig_nav_cage_executor', 'pig-nav-execute.py')
        window = app.player.extract.parse_window_id(args.window_id)
        adapter = app.player.X11Adapter(args.display, window)
        args.output.mkdir(parents=True, exist_ok=False)
        current = adapter.capture()
        board = candidates['board']
        executor.validate_board(board, current.shape)
        reference = cv2.imdecode(np.frombuffer(source, dtype=np.uint8), cv2.IMREAD_COLOR)
        if not probe.same_board(reference, current, board):
            raise ValueError('现场棋盘与采集画面不一致')
        options = {'short_side': 640, 'timeout': 45, 'display_id': None}
        verification = args.output / 'level-verification'
        verification.mkdir()
        title, _ = pig_ocr.inspect(current, verification, [], [], options)
        if ((title.get('title') or {}).get('recognized') or {}).get('value') != args.level:
            raise ValueError('当前关卡编号未能确认')
        current = adapter.capture()
        ok, encoded = cv2.imencode('.png', current)
        if not ok or not probe.same_board(reference, current, board) or not middle.can_handle_cage(encoded.tobytes(), candidates):
            raise ValueError('执行前出现未确认的笼外物件')
        status = pig_cage_stage.run(app, adapter, current, board, args.output, options, level=args.level)
        if status != 'victory' or not (args.output / 'victory.png').is_file():
            raise ValueError('本地阶段未确认通关，必须重新采集')
        (args.output / 'result.json').write_text(json.dumps({'status': 'victory', 'level': args.level}) + '\n', encoding='utf-8')
        print('本地铁笼阶段通关并保存截图')
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, cv2.error) as error:
        if adapter is not None and args.output.is_dir():
            try:
                cv2.imwrite(str(args.output / 'interrupted.png'), adapter.capture())
            except (OSError, ValueError, RuntimeError, cv2.error):
                pass
            (args.output / 'result.json').write_text(json.dumps({'status': 'interrupted', 'reason': str(error)}, ensure_ascii=False) + '\n', encoding='utf-8')
        parser.exit(1, f'本地铁笼阶段停止：{error}\n')
    finally:
        if adapter is not None:
            adapter.close()


if __name__ == '__main__':
    main()
