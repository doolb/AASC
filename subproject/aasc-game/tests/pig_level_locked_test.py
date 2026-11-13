import importlib.util
import json
from pathlib import Path
import unittest
import subprocess
import tempfile
from unittest.mock import patch
import sys
import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import pig_locked_candidate

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pig_locked_test', ROOT / 'scripts/play-pig-locked.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class LockedPlanTest(unittest.TestCase):
    def test_search_limit_returns_verified_partial_path(self):
        with tempfile.TemporaryDirectory() as directory:
            executable = str(Path(directory) / 'solver')
            subprocess.run(['g++', '-O2', '-std=c++17', str(ROOT / 'scripts/pig_fast_locked_solver.cpp'), '-o', executable], check=True)
            payload = '3 4 3 0 0\n0 0 west 2 1 1 0 0 0\n0 1 west 2 1 2 0 0 0\n0 2 west 2 1 3 0 0 0\n'
            result = subprocess.run([executable, '1', '1'], input=payload, text=True, capture_output=True)
            self.assertEqual(result.returncode, 3)
            self.assertEqual(len(result.stdout.splitlines()), 1)
        data = {'grid': [0, 0, 1, 4, 2], 'pigs': [
            {'id': n, 'direction': 'west', 'grid': {'col': 0, 'row': n - 1, 'cells': [[0, n - 1], [1, n - 1]]}} for n in (1, 2)],
            'locks': {}, 'actions': [{'index': 0, 'pig_id': 1, 'direction': 'west', 'from': [0, 0], 'to': None, 'exited': True, 'travel_cells': 0}]}
        self.assertEqual(app.validate_plan(data, require_complete=False), {})
        with self.assertRaisesRegex(ValueError, '未清空'):
            app.validate_plan(data)

    def test_partial_execution_confirms_final_frame_without_claiming_victory(self):
        pigs = [{'id': n, 'direction': 'west', 'center': [5, 10 * (n - 1)], 'grid': {'col': 0, 'row': n - 1,
                 'cells': [[0, n - 1], [1, n - 1]]}} for n in (1, 2)]
        action = {'index': 0, 'pig_id': 1, 'direction': 'west', 'from': [0, 0], 'to': None, 'exited': True, 'travel_cells': 0}
        data = {'grid': [0, 0, 10, 4, 2], 'board': [0, 0, 40, 20], 'pigs': pigs, 'locks': {}, 'actions': [action], 'status': 'partial'}
        class Window:
            def capture(self): return np.zeros((20, 40, 3), np.uint8)
            def click(self, center, size): pass
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(app.app.player.extract, 'annotate', side_effect=lambda image, *args: image.copy()), \
             patch.object(app, 'match_frame', side_effect=[{(0, 0): {'center': [5, 5]}}, {(0, 1): {'center': [5, 15]}}]), \
             patch.object(app.time, 'sleep'):
            output = Path(directory) / 'stage'
            self.assertEqual(app.run(Window(), data, data['board'], output), 'stage_complete')
            self.assertEqual(json.loads((output / 'result.json').read_text())['confirmed'], 1)
            self.assertFalse((output / 'victory.png').exists())

    def test_scissors_layout_matches_recorded_frame(self):
        path = ROOT / 'docs/references/pig-game/play-runs/level-41-review-20261113-211105-121808'
        if not (path / 'rope-reviewed-layout.json').exists():
            self.skipTest('本地第 41 关复核样本不可用')
        data = json.loads((path / 'rope-reviewed-layout.json').read_text())
        image = cv2.imread(str(path / 'red-highlight.png'))
        if image is None:
            self.skipTest('本地第 41 关高亮样本不可用')
        state, directions = app.app.player.solver.prepare(data['pigs'], data['grid'][3], data['grid'][4])
        result = app.match_scissors_frame(image, data['board'], data['pigs'], state, directions, data['grid'],
                                          set(data['scissors']), set(data['ropes']), data['ducks'])
        self.assertEqual(len(result), len(data['pigs']))
        changed = image.copy()
        changed[315:352, 240:270] = 0
        self.assertIsNone(app.match_scissors_frame(changed, data['board'], data['pigs'], state, directions, data['grid'],
                                                  set(data['scissors']), set(data['ropes']), data['ducks']))

    def test_scissors_must_exit_before_rope_can_move(self):
        pigs = [{'id': n, 'direction': 'west', 'grid': {'col': 0, 'row': n - 1,
                 'cells': [[0, n - 1], [1, n - 1]]}} for n in (1, 2, 3)]
        data = {'grid': [0, 0, 1, 4, 3], 'pigs': pigs, 'locks': {}, 'board': [0, 0, 4, 3],
                'scissors': [1, 2], 'ropes': [3]}
        solved = pig_locked_candidate.solve(data, seeds=(1,))
        self.assertEqual(solved['actions'][-1]['pig_id'], 3)
        self.assertEqual(app.validate_plan(solved), {})
        bad = dict(solved, actions=[solved['actions'][-1]] + solved['actions'][:-1])
        with self.assertRaisesRegex(ValueError, '绳子尚未全部解除'):
            app.validate_plan(bad)
        moved = dict(solved, actions=[dict(solved['actions'][0], exited=False), solved['actions'][-1]])
        with self.assertRaisesRegex(ValueError, '绳子尚未全部解除'):
            app.validate_plan(moved)

    def test_duck_departures_advance_lock_counter(self):
        data = {'pigs': [{'id': 1}, {'id': 2}], 'ducks': [[2, 2]], 'grid': [0, 0, 1, 5, 5], 'locks': {2: 2}, 'actions': []}
        verified = {'actions': [{'pig_id': 1, 'exited': True, 'duck_departures': [[2, 2]]},
                                {'pig_id': 2, 'exited': True, 'duck_departures': []}]}
        with patch.object(app.app.player.solver, 'validate_candidate_plan', return_value=verified):
            self.assertEqual(app.validate_plan(data), {2: 2})
            verified['actions'][0]['duck_departures'] = []
            with self.assertRaisesRegex(ValueError, '尚未解锁'):
                app.validate_plan(data)

    def test_mixed_lock_and_duck_plan_replays(self):
        path = ROOT / 'docs/references/pig-game/play-runs/level-39-run-20261113-174554-452700/mixed-full-verified.json'
        data = json.loads(path.read_text())
        self.assertEqual(len(data['ducks']), 16)
        self.assertEqual(len(app.validate_plan(data)), 2)
        changed = json.loads(json.dumps(data))
        changed['actions'][0]['ducks_after'] = []
        with self.assertRaises(ValueError):
            app.validate_plan(changed)

    def test_search_respects_locked_pig(self):
        pigs = [{'id': 1, 'direction': 'west', 'grid': {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}},
                {'id': 2, 'direction': 'west', 'grid': {'col': 0, 'row': 1, 'cells': [[0, 1], [1, 1]]}}]
        data = {'grid': [0, 0, 1, 4, 2], 'pigs': pigs, 'locks': {2: 1}, 'board': [0, 0, 4, 2]}
        solved = pig_locked_candidate.solve(data, seeds=(1,))
        self.assertEqual([action['pig_id'] for action in solved['actions']], [1, 2])
        self.assertEqual(app.validate_plan(solved), {2: 1})

    def test_plan_must_wait_for_unlock_and_clear_all_pigs(self):
        def pig(number, row):
            return {'id': number, 'direction': 'west', 'grid': {'col': 0, 'row': row,
                    'cells': [[0, row], [1, row]]}}
        def action(index, row):
            return {'index': index, 'pig_id': index + 1, 'direction': 'west', 'from': [0, row],
                    'to': None, 'exited': True, 'travel_cells': 0}
        data = {'grid': [0, 0, 1, 4, 2], 'pigs': [pig(1, 0), pig(2, 1)], 'locks': {'2': 1},
                'actions': [action(0, 0), action(1, 1)]}
        self.assertEqual(app.validate_plan(data), {2: 1})
        with self.assertRaisesRegex(ValueError, '尚未解锁'):
            app.validate_plan({**data, 'actions': [action(1, 1), action(0, 0)]})
        with self.assertRaisesRegex(ValueError, '未清空'):
            app.validate_plan({**data, 'actions': [action(0, 0)]})


if __name__ == '__main__':
    unittest.main()
