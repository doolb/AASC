#!/usr/bin/env python3
"""复核导航计划、当前关卡与实时棋盘后执行。"""
import argparse
import importlib.util
import json
import math
from pathlib import Path

import pig_ocr

ROOT = Path(__file__).resolve().parent.parent
plan_spec = importlib.util.spec_from_file_location('pig_nav_plan', ROOT / 'scripts/pig-nav-plan.py')
pig_nav_plan = importlib.util.module_from_spec(plan_spec)
plan_spec.loader.exec_module(pig_nav_plan)


def load_executor():
    spec = importlib.util.spec_from_file_location('pig_navigation_executor', ROOT / 'scripts/play-pig-locked.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify(plan, layout, screenshot, level):
    expected, digest = pig_nav_plan.validate_layout(layout, screenshot, level)
    pig_nav_plan.validate_layout(plan, screenshot, level)
    navigation = plan.get('navigation', {})
    if navigation != {'source_sha256': digest, 'level': level, 'strategy': 'auto', 'replayed': True}:
        raise ValueError('计划与本次首屏或求解策略不匹配')
    for key in ('pigs', 'grid', 'board', 'locks', 'ducks', 'blockers', 'dynamic_cages', 'scissors', 'ropes'):
        if plan.get(key, [] if key not in ('locks',) else {}) != expected.get(key, [] if key not in ('locks',) else {}):
            raise ValueError('计划布局与复核布局不一致：' + key)
    if plan.get('bombs', {}) != expected.get('bombs', {}) or plan.get('bomb_policy') != expected.get('bomb_policy'):
        raise ValueError('计划布局与复核布局不一致：炸弹')
    if plan.get('status') != 'solved' or not plan.get('actions'):
        raise ValueError('计划不完整')
    load_executor().validate_plan(plan, require_complete=True)


def validate_board(board, shape):
    if not isinstance(board, (list, tuple)) or len(board) != 4 or any(type(v) not in (int, float) or not math.isfinite(v) for v in board):
        raise ValueError('棋盘范围无效')
    x, y, width, height = board
    # 棋盘检测的下边界为半开区间，标准 942 像素画面可到 808；道具位于更下方。
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > shape[1] or y + height > round(shape[0] * 810 / 942):
        raise ValueError('棋盘范围超界或触及底部道具')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--layout', required=True, type=Path)
    parser.add_argument('--image', required=True, type=Path)
    parser.add_argument('--level', required=True, type=int)
    parser.add_argument('--window-id', required=True)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text(encoding='utf-8'))
        layout = json.loads(args.layout.read_text(encoding='utf-8'))
        verify(plan, layout, args.image.read_bytes(), args.level)
        if plan.get('bombs'):
            raise ValueError('炸弹猪的实机画面核对尚未实现，禁止执行')
        executor = load_executor()
        window = executor.app.player.extract.parse_window_id(args.window_id)
        adapter = executor.app.player.X11Adapter(args.display, window)
        try:
            current = adapter.capture()
            validate_board(plan['board'], current.shape)
            # 不凭调用方给出的关卡号推断当前画面；OCR 不可用或不一致均不点击。
            verification = args.output.parent / 'level-verification'
            verification.mkdir(exist_ok=False)
            summary, _ = pig_ocr.inspect(current, verification, [], [],
                                         {'short_side': 640, 'timeout': 45, 'display_id': None})
            title = (summary.get('title') or {}).get('recognized') or {}
            if title.get('value') != args.level:
                raise ValueError('当前关卡编号未能确认')
            status = executor.run(adapter, plan, plan['board'], args.output)
            if status != 'victory':
                raise ValueError('未确认通关')
        finally:
            adapter.close()
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        parser.exit(1, f'导航执行停止：{error}\n')


if __name__ == '__main__':
    main()
