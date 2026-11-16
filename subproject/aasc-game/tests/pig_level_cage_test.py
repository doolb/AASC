import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import pig_cage
import pig_cage_stage
import pig_locked_candidate

spec = importlib.util.spec_from_file_location('cage_test_auto', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
REF = ROOT / 'docs/references/pig-game/play-runs'


class CageTest(unittest.TestCase):
    def test_cage_frame_checks_locked_pig_and_keeps_it_hidden(self):
        executor = pig_locked_candidate.locked_module()
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        image[35:55, 35:55] = (0, 200, 255)
        pigs = [{'id': 1, 'center': [45, 45], 'direction': 'east',
                 'grid': {'col': 1, 'row': 1, 'cells': [[1, 1], [2, 1]]}}]
        grid = [10, 10, 20, 4, 4]
        with patch.object(executor.app.auto, 'ui_state', return_value='unknown'), \
             patch.object(executor.pig_cage, 'detect', return_value=[]), \
             patch.object(executor.pig_cage, 'cells', return_value=set()), \
             patch.object(executor.app.player.extract, 'identify', return_value=([], None, [])):
            self.assertEqual(executor.match_cage_frame(image, [0, 0, 100, 100], pigs, [(1, 1)],
                             ['east'], grid, [], locks={1: 3}, exits=0), {})
            image[:] = 0
            self.assertIsNone(executor.match_cage_frame(image, [0, 0, 100, 100], pigs, [(1, 1)],
                              ['east'], grid, [], locks={1: 3}, exits=0))
            self.assertIsNone(executor.match_cage_frame(image, [0, 0, 100, 100], pigs, [(1, 1)],
                              ['east'], grid, [], locks={1: 3}, exits=3))

    def test_connected_gold_lock_at_board_edge_is_detected(self):
        path = REF / 'level-59-run-20261115-003612-758516/cage-stage-006/play/interrupted.png'
        if not path.exists():
            self.skipTest('本地锁标粘连样本不可用')
        image = cv2.imread(str(path))
        board = app.player.extract.valid_board(image, None)
        candidates = app.auto.find_yellow_ducks(image, board)
        self.assertTrue(any(abs(p['center'][0] - 87) < 5 and abs(p['center'][1] - 659) < 5
                            and p.get('detection_source') == 'separated_gold' for p in candidates))

    def test_cage_outside_lock_candidate_stops_before_search(self):
        path = REF / 'level-59-run-20261115-003612-758516/cage-stage-006/play/original.png'
        if not path.exists():
            self.skipTest('本地铁笼和锁猪混合样本不可用')
        image = cv2.imread(str(path))
        board = app.player.extract.valid_board(image, None)
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(pig_cage_stage, 'read_counters', return_value=[30]), \
                 patch.object(pig_cage_stage, 'exclude_lock_yellow', return_value=([], [{'center': [86, 664]}])):
                with self.assertRaisesRegex(ValueError, '未建模锁猪'):
                    pig_cage_stage.prepare(app, image, board, Path(directory), {})
            self.assertTrue((Path(directory) / 'cage-lock-candidates.json').exists())

    def test_observed_cage_shapes(self):
        for name in ('level-51-cage-initial/original.png', 'level-52-cages-initial/original.png',
                     'level-53-run-20261114-083705-516303/original.png'):
            path = REF / name
            if not path.exists():
                self.skipTest('本地铁笼取证样本不可用')
            image = cv2.imread(str(path))
            board = app.player.extract.valid_board(image, None)
            cages = pig_cage.detect(image, board)
            self.assertEqual(len(cages), 1, name)
            if name.startswith('level-53'):
                self.assertTrue(pig_cage.contains(cages[0], (300, 350)))
                self.assertTrue(pig_cage.contains(cages[0], (200, 450)))
                self.assertFalse(pig_cage.contains(cages[0], (200, 350)))

    def test_53_visible_pigs_and_ocr_crop(self):
        path = REF / 'level-53-run-20261114-083705-516303/original.png'
        if not path.exists():
            self.skipTest('本地第 53 关样本不可用')
        image = cv2.imread(str(path))
        board = app.player.extract.valid_board(image, None)
        payload = {'imageWidth': 158, 'imageHeight': 158, 'boxes': [{'text': '70', 'score': .99,
                   'points': [[80, 80], [120, 80], [120, 120], [80, 120]]}]}
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(app.ocr, 'request_crop', return_value=payload):
                data, count = pig_cage_stage.prepare(app, image, board, Path(directory), {})
            self.assertEqual(count, 70)
            self.assertEqual(len(data['cage_unknown']), 1)
            self.assertEqual(len(data['cage_cells']), 16)
            state, directions = app.player.solver.prepare(data['pigs'], data['grid'][3], data['grid'][4])
            locked = app.locked_candidate.locked_module()
            self.assertIsNotNone(locked.match_cage_frame(image, board, data['pigs'], state, directions,
                                                        data['grid'], data['cage_cells'], data['cage_unknown']))

    def test_continuous_flow_routes_cage_before_elephant(self):
        path = REF / 'level-53-run-20261114-083705-516303/original.png'
        if not path.exists():
            self.skipTest('本地第 53 关样本不可用')
        image = cv2.imread(str(path))
        class Adapter:
            def capture(self): return image.copy()
        calls = []
        stages = SimpleNamespace(run=lambda *args: calls.append(args) or 'cage_unlock_pending')
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(app, 'load_module', return_value=stages):
                status, _ = app.run_level(Adapter(), Path(directory) / 'run', 53)
        self.assertEqual(status, 'cage_unlock_pending')
        self.assertEqual(len(calls), 1)

    def test_elephant_and_blue_background_are_not_cages(self):
        for name in ('level-21-new-animal-observation/original.png',
                     'level-34-run-20261113-155215-143779/original.png',
                     'level-31-full-board/second-unlock-stable.png'):
            path = REF / name
            if not path.exists():
                self.skipTest('本地普通关和小象样本不可用')
            image = cv2.imread(str(path))
            self.assertEqual(pig_cage.detect(image, (74, 205, 392, 603)), [], name)

    def test_counter_does_not_punch_holes_in_cage(self):
        base = REF / 'level-53-run-20261114-090312-950749/cage-stage-001/play'
        if not (base / 'interrupted.png').exists():
            self.skipTest('本地数字遮挡样本不可用')
        plan = json.loads((base / 'plan.json').read_text())
        before = cv2.imread(str(base / 'original.png'))
        after = cv2.imread(str(base / 'interrupted.png'))
        a = pig_cage.cells(pig_cage.detect(before, plan['board']), plan['grid'])
        b = pig_cage.cells(pig_cage.detect(after, plan['board']), plan['grid'])
        self.assertEqual(a, b)
        self.assertEqual(len(a), 16)

    def test_overlapping_cages_keep_both_counters(self):
        path = REF / 'level-52-cages-initial/original.png'
        if not path.exists():
            self.skipTest('本地第 52 关样本不可用')
        image = cv2.imread(str(path))
        board = app.player.extract.valid_board(image, None)
        boxes = [{'text': str(n), 'score': .99, 'points': [[5, 5], [35, 5], [35, 35], [5, 35]]} for n in (25, 40)]
        payload = {'imageWidth': 221, 'imageHeight': 221, 'boxes': boxes}
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(app.ocr, 'request_crop', return_value=payload):
                data, count = pig_cage_stage.prepare(app, image, board, Path(directory), {})
        self.assertEqual(count, 25)
        self.assertEqual(data['cage_counters'], [25, 40])
        self.assertEqual(len(data['cage_cells']), 41)

    def test_unknown_direction_resolved_by_consistent_frames(self):
        path = REF / 'level-53-run-20261114-083705-516303/original.png'
        if not path.exists():
            self.skipTest('本地第 53 关样本不可用')
        image = cv2.imread(str(path))
        board = app.player.extract.valid_board(image, None)
        raw, _, warnings = app.player.extract.identify(image, board)
        corrected = [dict(pig, direction='east') if pig['direction'] == 'unknown' else dict(pig) for pig in raw]
        payload = {'imageWidth': 158, 'imageHeight': 158, 'boxes': [{'text': '70', 'score': .99,
                   'points': [[80, 80], [120, 80], [120, 120], [80, 120]]}]}
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(app.ocr, 'request_crop', return_value=payload), patch.object(
                    app.player.extract, 'identify', side_effect=[(raw, board, warnings),
                                                                (corrected, board, warnings),
                                                                (corrected, board, warnings)]):
                data, _ = pig_cage_stage.prepare(app, image, board, Path(directory), {}, [image, image])
        self.assertFalse(data['cage_unknown'])
        self.assertEqual(len([pig for pig in data['pigs'] if pig.get('direction_source') == 'cage_outside_multiframe']), 1)

    def test_single_digit_counter_uses_smaller_crop_after_ocr_failure(self):
        path = REF / 'level-53-run-20261114-093425-061784/original.png'
        if not path.exists():
            self.skipTest('本地单数字铁笼样本不可用')
        image = cv2.imread(str(path))
        cage = pig_cage.detect(image, app.player.extract.valid_board(image, None))[0]
        self.assertEqual(pig_cage.counter_boxes(image, cage), [[282, 425, 27, 36]])
        weak = {'imageWidth': 158, 'imageHeight': 158, 'boxes': [{'text': 'FL', 'score': .64}]}
        strong = {'imageWidth': 39, 'imageHeight': 48, 'boxes': [{'text': '7', 'score': .99,
                  'points': [[5, 0], [34, 0], [34, 46], [5, 46]]}]}
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(app.ocr, 'request_crop', side_effect=[weak, strong]):
                counters = pig_cage_stage.read_counters(app, image, [cage], Path(directory), {})
        self.assertEqual(counters, [7])

    def test_dynamic_cage_blocks_until_exit(self):
        pigs = [{'id': i+1, 'direction': 'west', 'grid': {'col': 0, 'row': i,
                'cells': [[0, i], [1, i]]}} for i in range(2)]
        data = {'grid': [0, 0, 1, 4, 2], 'pigs': pigs, 'board': [0, 0, 4, 2], 'locks': {},
                'dynamic_cages': [{'unlock_exits': 1, 'cells': [[0, 1], [1, 1]]}]}
        solution = pig_locked_candidate.solve(data, seeds=(1,))
        self.assertEqual([step['pig_id'] for step in solution['actions']], [1, 2])
        locked = pig_locked_candidate.locked_module()
        locked.validate_plan(solution)
        bad = dict(solution, actions=[dict(solution['actions'][1], index=1, **{'from': [0, 1]})])
        with self.assertRaisesRegex(ValueError, '铁笼'):
            locked.validate_plan(bad, require_complete=False)

    def test_search_can_avoid_unresponsive_first_pig(self):
        pigs = [{'id': i+1, 'direction': 'west', 'grid': {'col': 0, 'row': i,
                'cells': [[0, i], [1, i]]}} for i in range(2)]
        data = {'grid': [0, 0, 1, 4, 2], 'pigs': pigs, 'board': [0, 0, 4, 2], 'locks': {}}
        solution = pig_locked_candidate.solve(data, seeds=(1,), forbid_first=1)
        self.assertEqual(solution['actions'][0]['pig_id'], 2)
        pig_locked_candidate.locked_module().validate_plan(solution)

    def test_cage_stage_only_needs_the_exit_target(self):
        pigs = [
            {'id': 1, 'direction': 'west', 'grid': {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}},
            {'id': 2, 'direction': 'east', 'grid': {'col': 0, 'row': 1, 'cells': [[0, 1], [1, 1]]}},
        ]
        data = {'grid': [0, 0, 1, 4, 2], 'pigs': pigs, 'board': [0, 0, 4, 2],
                'locks': {}, 'blockers': [[2, 1]]}
        solution = pig_locked_candidate.solve(data, seeds=(1,), target_exits=1)
        self.assertEqual(solution['status'], 'partial')
        self.assertEqual([action['pig_id'] for action in solution['actions']], [1])
        pig_locked_candidate.locked_module().validate_plan(solution, require_complete=False)

    def test_unresponsive_action_is_recorded_and_not_confirmed(self):
        image = np.zeros((10, 10, 3), dtype=np.uint8)
        action = {'index': 0, 'pig_id': 1, 'direction': 'west', 'from': [0, 0],
                  'to': None, 'exited': True, 'travel_cells': 0}
        pending = {'action': action, 'observed_center': [1, 1]}
        pig = {'id': 1, 'center': [1, 1], 'direction': 'west',
               'grid': {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}}
        data = {'pigs': [pig], 'grid': [0, 0, 1, 4, 2], 'cage_cells': [[1, 1]],
                'cage_unknown': [], 'cage_counters': [3]}

        class Executor:
            calls = 0
            def match_cage_frame(self, *args):
                self.calls += 1
                return None if self.calls == 4 else {(0, 0): pig}
            def run(self, adapter, solution, board, output, wait):
                output.mkdir()
                (output / 'result.json').write_text(json.dumps({'confirmed': 0, 'pending_action': pending}))
                raise ValueError('动作后画面不一致')
        class Adapter:
            def capture(self): return image.copy()

        executor = Executor()
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(pig_cage_stage, 'prepare', side_effect=[(data, 3), ValueError('测试结束')]), \
                 patch.object(app.locked_candidate, 'locked_module', return_value=executor), \
                 patch.object(app.locked_candidate, 'solve', return_value={'actions': [action]}), \
                 patch.object(app.player.solver, 'prepare', return_value=(((0, 0),), ['west'])):
                with self.assertRaisesRegex(ValueError, '测试结束'):
                    pig_cage_stage.run(app, Adapter(), image, [0, 0, 10, 10], Path(directory), {}, level=53)
            record = json.loads((Path(directory) / 'cage-stage-001/play/reconciliation.json').read_text())
        self.assertEqual(record['status'], 'pending_action_not_applied')
        self.assertEqual(record['confirmed'], 0)

    def test_opening_is_confirmed_before_reidentification(self):
        image = np.zeros((10, 10, 3), dtype=np.uint8)
        pigs = [{'id': 1, 'direction': 'west', 'center': [0.5, 0]},
                {'id': 2, 'direction': 'east', 'center': [2.5, 0]}]
        data = {'pigs': pigs, 'grid': [0, 0, 1, 5, 2], 'cage_cells': [[2, 1]],
                'cage_unknown': [], 'cage_counters': [1]}
        action = {'index': 0, 'pig_id': 1, 'from': [0, 0], 'to': None, 'exited': True}
        class Adapter:
            clicks = []
            def capture(self): return image.copy()
            def click(self, center, size): self.clicks.append((center, size))
        adapter = Adapter()
        executor = SimpleNamespace(match_cage_frame=lambda *args: {(0, 0): {'center': [0.5, 0]}})
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(app.player.solver, 'prepare', return_value=(((0, 0), (2, 0)), ['west', 'east'])), \
                 patch.object(app.auto, 'ui_state', return_value='unknown'), \
                 patch.object(app.cage_vision, 'detect', return_value=[]), \
                 patch.object(app.player.extract, 'identify', return_value=([{'center': [2.5, 0]}], None, [])), \
                 patch.object(app.player, 'match_expected', return_value={(2, 0): {}}), \
                 patch.object(pig_cage_stage.time, 'sleep'):
                pig_cage_stage.confirm_open(app, executor, adapter, data, action, [0, 0, 10, 10],
                                             Path(directory), 1, {})
            record = json.loads((Path(directory) / 'open-confirmed.json').read_text())
        self.assertEqual(record['status'], 'confirmed')
        self.assertEqual(len(adapter.clicks), 1)

    def test_level_52_confirmed_plan_replays_dynamic_cages(self):
        base = REF / 'level-52-complete-verified'
        if not (base / 'level.json').exists() or not (base / 'solution-order.json').exists():
            self.skipTest('本地第 52 关实机证据不可用')
        data = json.loads((base / 'level.json').read_text())
        data['actions'] = json.loads((base / 'solution-order.json').read_text())['steps']
        data['dynamic_cages'] = [
            {'unlock_exits': 25, 'cells': [[x, y] for x in range(3, 8) for y in range(7, 12)]},
            {'unlock_exits': 40, 'cells': [[x, y] for x in range(5, 10) for y in range(9, 14)
                                           if x >= 8 or y >= 12]},
        ]
        pig_locked_candidate.locked_module().validate_plan(data)
        self.assertEqual(len(data['actions']), 164)


if __name__ == '__main__':
    unittest.main()
