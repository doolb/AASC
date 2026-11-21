import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import pig_level_solver as solver


def piece(pig_id, col, row, direction, kind='normal'):
    positions = solver.cells((col, row), direction, 2)
    return {'id': pig_id, 'direction': direction, 'kind': kind, 'length': 2,
            'grid': {'col': col, 'row': row, 'cells': [list(value) for value in positions]}}


class SpringSolverTest(unittest.TestCase):
    def test_blocked_spring_does_not_slide(self):
        pigs = [piece(1, 0, 1, 'east', 'spring'), piece(2, 4, 0, 'south')]
        state, directions = solver.prepare(pigs, 7, 4)
        moves = solver.actions(state, directions, 7, 4, springs={0})
        self.assertFalse(any(move[1] == 0 for move in moves))
        self.assertIn((False, 0, (2, 1), 2), solver.actions(state, directions, 7, 4))

    def test_clear_spring_can_exit(self):
        pigs = [piece(1, 0, 1, 'east', 'spring')]
        state, directions = solver.prepare(pigs, 7, 4)
        self.assertIn((True, 0, None, 5), solver.actions(state, directions, 7, 4, springs={0}))

    def test_replay_rejects_false_partial_slide(self):
        pigs = [piece(1, 0, 1, 'east', 'spring'), piece(2, 4, 0, 'south')]
        candidate = [{'index': 0, 'pig_id': 1, 'direction': 'east', 'from': [0, 1],
                      'to': [2, 1], 'exited': False, 'travel_cells': 2}]
        with self.assertRaises(ValueError):
            solver.validate_candidate_plan(pigs, [], 7, 4, candidate, require_complete=False)

    def test_native_search_waits_for_obstacle_to_leave(self):
        spec = importlib.util.spec_from_file_location('candidate', ROOT / 'scripts/pig_locked_candidate.py')
        candidate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(candidate)
        pigs = [piece(1, 0, 1, 'east', 'spring'), piece(2, 4, 0, 'south')]
        data = {'grid': [0, 0, 1, 7, 4], 'pigs': pigs, 'locks': {}, 'bombs': {}}
        result = candidate.solve(data, seeds=(17,), strategy='native')
        self.assertEqual([action['pig_id'] for action in result['actions']], [2, 1])
        self.assertTrue(all(action['exited'] for action in result['actions']))


if __name__ == '__main__':
    unittest.main()
