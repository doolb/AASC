import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pig_hint_test', ROOT / 'scripts/play-pig-lock-stages.py')
hints = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hints)


class HintTest(unittest.TestCase):
    def test_elephant_path_needs_confirmed_direction_and_empty_lane(self):
        data = {'grid': [0, 0, 10, 6, 6], 'object_direction': 'west',
                'unknown_entities': [{'bbox': [20, 20, 20, 20], 'estimated_grid_cells': [[2, 2]]}],
                'blockers': [[2, 2]], 'pigs': [{'grid': {'cells': [[1, 3]]}}]}
        self.assertFalse(hints.elephant_path_clear(data))
        data['pigs'][0]['grid']['cells'] = [[1, 5]]
        self.assertTrue(hints.elephant_path_clear(data))
        data.pop('object_direction')
        self.assertFalse(hints.elephant_path_clear(data))

    def test_exit_updates_locks_without_mutating_original(self):
        data = {'grid': [0, 0, 10, 4, 2], 'locks': {'2': 2},
                'pigs': [{'id': 1, 'direction': 'west', 'center': [5, 0], 'grid': {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}},
                         {'id': 2, 'direction': 'west', 'center': [5, 10], 'grid': {'col': 0, 'row': 1, 'cells': [[0, 1], [1, 1]]}}]}
        result = hints.updated_layout(data, [None, (0, 1)], 0, True)
        self.assertEqual(result['locks'], {'2': 1})
        self.assertEqual([p['id'] for p in result['pigs']], [2])
        self.assertEqual(data['locks'], {'2': 2})
        self.assertEqual(len(data['pigs']), 2)
        result = hints.updated_layout(result, [None], 0, True)
        self.assertEqual(result['locks'], {})

    def test_rope_unlocks_when_last_scissors_exits(self):
        data = {'grid': [0, 0, 10, 4, 2], 'locks': {}, 'scissors': [1], 'ropes': [2],
                'pigs': [{'id': 1, 'direction': 'west', 'center': [5, 0], 'grid': {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}},
                         {'id': 2, 'direction': 'west', 'center': [5, 10], 'grid': {'col': 0, 'row': 1, 'cells': [[0, 1], [1, 1]]}}]}
        result = hints.updated_layout(data, [None, (0, 1)], 0, True)
        self.assertEqual(result['scissors'], [])
        self.assertEqual(result['ropes'], [])


if __name__ == '__main__':
    unittest.main()
