#!/usr/bin/env python3
"""使用原关卡网格搜索有限离场阶段，再逐步核对并执行。"""
import argparse
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import time

import cv2

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pig_progress_stage', ROOT / 'scripts/unlock-pig-object.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
app = stage.app


def locks_visible(image, regions):
    """已复核的锁区域必须仍有足够黄色像素；不把该判断当成计数识别。"""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    height, width = hsv.shape[:2]
    for x, y, w, h in regions:
        if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > width or y + h > height:
            raise ValueError('锁区域超出画面')
        mask = cv2.inRange(hsv[y:y+h, x:x+w], (18, 100, 120), (40, 255, 255))
        if cv2.countNonZero(mask) < 80:
            return False
    return True


def run(adapter, level, output, layout, goal):
    reference = json.loads(Path(layout).read_text())
    grid, pigs = tuple(reference['grid']), reference['pigs']
    if reference.get('ducks'):
        raise ValueError('有限消除阶段暂不支持小鸭')
    blockers = tuple(tuple(cell) for cell in reference.get('blockers', []))
    lock_regions = reference.get('lock_regions', [])
    initial, directions, plan, explored = stage.search(pigs, grid, blockers, None, remove_goal=goal)
    output.mkdir(parents=True, exist_ok=False)
    image = adapter.capture()
    board = app.player.extract.valid_board(image, reference.get('board'))
    app.save_or_error(output / 'original.png', image)
    app.player.write_json(output / 'level.json', {'level': level, 'grid': grid, 'pigs': pigs,
                          'blockers': blockers, 'board': board, 'lock_regions': lock_regions,
                          'note': '保留首屏网格的有限消除阶段'})
    app.player.write_json(output / 'plan.json', {'status': 'stage_plan', 'states': explored, 'actions': plan})
    expected = list(initial)
    lengths = [pig.get('length', 2) for pig in pigs]
    confirmed = []
    pending = None
    latest = image
    try:
        for action in plan:
            for _ in range(25):
                latest = adapter.capture()
                if lock_regions and not locks_visible(latest, lock_regions):
                    raise ValueError('锁区域外观变化，停止并重新识别')
                detected, _, _ = app.player.extract.identify(latest, board)
                try:
                    matched = app.player.match_expected(detected, expected, directions, grid, lengths)
                except ValueError:
                    matched = None
                if matched is not None:
                    break
                time.sleep(.37)
            else:
                raise ValueError('阶段操作前棋盘与计划不一致')
            if pending is not None:
                confirmed.append(pending)
                app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
                pending = None
            pig = matched.get(tuple(action['from']))
            if pig is None:
                raise ValueError('阶段目标未匹配')
            pending = {'action': action, 'observed_center': pig['center']}
            adapter.click(pig['center'], latest.shape[1::-1])
            expected[action['index']] = tuple(action['to']) if action['to'] is not None else None
            time.sleep(1.5)
        for _ in range(25):
            latest = adapter.capture()
            if lock_regions and not locks_visible(latest, lock_regions):
                raise ValueError('锁区域外观变化，停止并重新识别')
            detected, _, _ = app.player.extract.identify(latest, board)
            try:
                matched = app.player.match_expected(detected, expected, directions, grid, lengths)
            except ValueError:
                matched = None
            if matched is not None:
                break
            time.sleep(.37)
        else:
            raise ValueError('阶段最后一步未确认')
        if pending is not None:
            confirmed.append(pending)
            app.player.write_json(output / f'action-{len(confirmed):03d}.json', pending)
        app.save_or_error(output / 'result.png', latest)
        cv2.imwrite(str(output / 'solution-order.png'), app.auto.render_solution(image, pigs, [x['action'] for x in confirmed]))
        app.player.write_json(output / 'result.json', {'status': 'stage_complete', 'confirmed': len(confirmed)})
    except (Exception, KeyboardInterrupt) as error:
        app.save_or_error(output / 'interrupted.png', latest)
        app.player.write_json(output / 'result.json', {'status': 'interrupted', 'confirmed': len(confirmed),
                              'pending_action': pending, 'reason': str(error)})
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--level', type=int, required=True)
    parser.add_argument('--window-id', required=True, type=app.player.extract.parse_window_id)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--reviewed-layout', required=True, type=Path)
    parser.add_argument('--remove', type=int, default=5)
    args = parser.parse_args()
    if args.remove < 1:
        parser.error('消除目标必须为正整数')
    output = ROOT / 'docs/references/pig-game/play-runs' / f"level-{args.level:02d}-progress-{datetime.now():%Y%m%d-%H%M%S-%f}"
    print('阶段记录:', output, flush=True)
    adapter = app.player.X11Adapter(args.display, args.window_id)
    try:
        run(adapter, args.level, output, args.reviewed_layout, args.remove)
    finally:
        adapter.close()


if __name__ == '__main__':
    main()
