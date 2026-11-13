#!/usr/bin/env python3
"""独立复算已确认阶段，在原网格上校验当前画面并生成新复核布局。"""
import argparse
import importlib.util
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('advance_pig_auto', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def replay(reference, stage_path):
    grid, pigs = tuple(reference['grid']), reference['pigs']
    if reference.get('ducks'):
        raise ValueError('暂不支持小鸭阶段布局重放')
    state, directions = app.player.solver.prepare(pigs, grid[3], grid[4])
    state = list(state)
    lengths = [pig.get('length', 2) for pig in pigs]
    files = sorted(stage_path.glob('action-*.json'))
    result = json.loads((stage_path / 'result.json').read_text())
    if result.get('status') != 'stage_complete' or result.get('confirmed') != len(files):
        raise ValueError('阶段未完成或确认数量不一致')
    for file in files:
        action = json.loads(file.read_text())['action']
        index = action['index']
        if type(index) is not int or not 0 <= index < len(pigs) or state[index] is None:
            raise ValueError('阶段目标编号无效')
        destination = tuple(action['to']) if action['to'] is not None else None
        proposed = (action['exited'], index, destination, action['travel_cells'])
        if (action['pig_id'] != pigs[index]['id'] or action['direction'] != directions[index]
                or tuple(action['from']) != state[index]
                or proposed not in app.player.solver.actions(state, directions, grid[3], grid[4], lengths=lengths)):
            raise ValueError('阶段动作无法由原网格合法重放')
        state[index] = destination
    remaining = []
    for index, pig in enumerate(pigs):
        if state[index] is None:
            continue
        item = dict(pig)
        cells = app.player.solver.cells(state[index], directions[index], lengths[index])
        item['grid'] = {'col': state[index][0], 'row': state[index][1], 'cells': cells}
        remaining.append(item)
    return grid, remaining


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--layout', required=True, type=Path)
    parser.add_argument('--stage', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--display', default=':1')
    parser.add_argument('--window-id', required=True, type=app.player.extract.parse_window_id)
    args = parser.parse_args()
    reference = json.loads(args.layout.read_text())
    grid, pigs = replay(reference, args.stage)
    state, directions = app.player.solver.prepare(pigs, grid[3], grid[4])
    adapter = app.player.X11Adapter(args.display, args.window_id)
    try:
        for attempt in range(12):
            image = adapter.capture()
            board = app.player.extract.valid_board(image, None)
            observed, _, _ = app.player.extract.identify(image, board)
            try:
                matched = app.player.match_expected(observed, state, directions, grid, [p.get('length', 2) for p in pigs])
                ducks, _ = app.filter_yellow_candidates(app.auto.find_yellow_ducks(image, board), grid,
                                                        app.player.with_grid(observed, grid))
                if matched is not None and not ducks and not app.auto.find_blue_elephants(image, board):
                    break
            except ValueError:
                pass
            time.sleep(.4)
        else:
            raise ValueError('当前画面与重放状态不一致')
        app.player.write_json(args.output, {'level': reference.get('level'), 'grid': grid, 'pigs': pigs, 'ducks': [],
                              'note': '由已确认动作在首屏网格重放并与稳定画面核对', 'source_stage': str(args.stage)})
        print('已校验剩余小猪:', len(pigs), '输出:', args.output)
    finally:
        adapter.close()


if __name__ == '__main__':
    main()
