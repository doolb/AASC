import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import pig_hypothesis_solver as hypothesis
import pig_level_solver as solver


def piece(pig_id, col, row, direction, kind='normal'):
    return {'id': pig_id, 'direction': direction, 'kind': kind, 'length': 2,
            'grid': {'col': col, 'row': row,
                     'cells': [list(cell) for cell in solver.cells((col, row), direction, 2)]}}


def layout():
    return {'grid': [0, 0, 1, 12, 19], 'locks': {}, 'bombs': {}, 'pigs': [
        piece(12, 7, 2, 'east'), piece(69, 9, 2, 'south', 'spring'),
        piece(54, 9, 16, 'west'), piece(79, 8, 15, 'north', 'spring'),
        piece(17, 3, 3, 'west'), piece(68, 2, 2, 'south', 'spring'),
        piece(48, 1, 15, 'east'), piece(76, 3, 15, 'north', 'spring'),
    ]}


class HypothesisTest(unittest.TestCase):
    def test_two_independent_cycles_and_direction_hypotheses(self):
        data = layout()
        base = hypothesis.pinned(data)
        self.assertEqual(base['pinned_ids'], [12, 17, 48, 54, 68, 69, 76, 79])
        self.assertEqual(base['dependencies']['12'], [69])
        self.assertEqual(base['dependencies']['69'], [54])
        self.assertEqual(base['dependencies']['54'], [79])
        self.assertEqual(base['dependencies']['79'], [12])
        self.assertEqual(hypothesis.pinned(data, direction_flips=(12,))['pinned_ids'], [17, 48, 68, 76])
        self.assertEqual(hypothesis.pinned(data, direction_flips=(12, 17))['pinned_ids'], [])

    def test_collision_hypotheses_are_not_solutions(self):
        data = layout()
        self.assertEqual(hypothesis.pinned(data, movable_springs=(69,))['pinned_ids'], [17, 48, 68, 76])
        self.assertEqual(hypothesis.pinned(data, movable_springs=(68, 69))['pinned_ids'], [])
        result = hypothesis.analyze(data)
        self.assertEqual(result['status'], 'conditional_analysis_not_solution')
        self.assertEqual(result['max_hypothesis_changes'], 2)
        self.assertTrue(result['direction_hypotheses'])
        self.assertTrue(result['collision_hypotheses'])
        self.assertTrue(all(not candidate['executable'] for candidate in
                            result['direction_hypotheses'] + result['collision_hypotheses']))

    def test_clear_path_does_not_report_deadlock(self):
        data = layout()
        data['pigs'] = [data['pigs'][0]]
        result = hypothesis.analyze(data)
        self.assertEqual(result['base']['pinned_ids'], [])
        self.assertEqual(result['hypothesis_status'], 'not_needed')
        self.assertEqual(result['direction_hypotheses'], [])

    def test_enumeration_limit_preserves_base_analysis(self):
        with mock.patch.object(hypothesis, 'MAX_FIXED_PIGS', 7):
            result = hypothesis.analyze(layout())
        self.assertEqual(len(result['base']['pinned_ids']), 8)
        self.assertEqual(result['hypothesis_status'], 'limit_exceeded')
        self.assertEqual(result['direction_hypotheses'], [])

    def test_unsupported_mechanisms_and_invalid_hypotheses_rejected(self):
        for field, value in [('ducks', [[0, 0]]), ('locks', {'12': 3}), ('scissors', [12])]:
            data = layout()
            data[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                hypothesis.analyze(data)
        data = layout()
        data['pigs'][0]['kind'] = 'bomb'
        with self.assertRaises(ValueError):
            hypothesis.analyze(data)
        with self.assertRaises(ValueError):
            hypothesis.pinned(layout(), direction_flips=(999,))
        with self.assertRaises(ValueError):
            hypothesis.pinned(layout(), movable_springs=(12,))

    def test_input_is_not_mutated(self):
        data = layout()
        before = copy.deepcopy(data)
        hypothesis.analyze(data)
        self.assertEqual(data, before)

    def test_cli_rejects_overwriting_input(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'layout.json'
            content = json.dumps(layout())
            source.write_text(content, encoding='utf-8')
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/pig_hypothesis_solver.py'),
                                     '--input', str(source), '--output', str(source)],
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(source.read_text(encoding='utf-8'), content)


if __name__ == '__main__':
    unittest.main()
