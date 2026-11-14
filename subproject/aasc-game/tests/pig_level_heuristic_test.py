"""验证启发式候选的接入边界和独立重放。"""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import pig_locked_candidate as candidate


def cage_layout():
    pigs = [{'id': index + 1, 'direction': 'west', 'grid': {'col': 0, 'row': index,
             'cells': [[0, index], [1, index]]}} for index in range(2)]
    return {'grid': [0, 0, 1, 4, 2], 'pigs': pigs, 'board': [0, 0, 4, 2], 'locks': {},
            'dynamic_cages': [{'unlock_exits': 1, 'cells': [[0, 1], [1, 1]]}]}


class HeuristicTest(unittest.TestCase):
    def test_cage_unlock_plan_is_independently_validated(self):
        result = candidate.solve(cage_layout(), strategy='heuristic', time_limit=5)
        self.assertEqual(result['status'], 'solved')
        self.assertEqual([action['pig_id'] for action in result['actions']], [1, 2])
        candidate.locked_module().validate_plan(result)

    def test_rejects_unsupported_objects_and_bad_limits(self):
        for key, value in [('ducks', [[3, 0]]), ('blockers', [[3, 0]]), ('scissors', [1]), ('ropes', [1])]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, '暂不支持'):
                candidate.solve(dict(cage_layout(), **{key: value}), strategy='heuristic')
        with self.assertRaisesRegex(ValueError, '搜索时间'):
            candidate.solve(cage_layout(), strategy='heuristic', time_limit=float('nan'))

    def test_partial_plan_requires_explicit_permission(self):
        def fake_run(command, **kwargs):
            output = Path(command[command.index('--out') + 1])
            output.write_text(json.dumps({'best': {'complete': False, 'steps': [
                {'id': 1, 'from': [[0, 0], [1, 0]], 'to': 'exit'}]}}))
        with patch.object(candidate.subprocess, 'run', side_effect=fake_run):
            with self.assertRaisesRegex(ValueError, '未找到完整解'):
                candidate.solve(cage_layout(), strategy='heuristic', time_limit=5)
            result = candidate.solve(cage_layout(), strategy='heuristic', time_limit=5, allow_partial=True)
        self.assertEqual(result['status'], 'partial')
        candidate.locked_module().validate_plan(result, require_complete=False)

    def test_rejects_candidate_that_clicks_locked_pig(self):
        def fake_run(command, **kwargs):
            output = Path(command[command.index('--out') + 1])
            output.write_text(json.dumps({'best': {'complete': True, 'steps': [
                {'id': 2, 'from': [[0, 1], [1, 1]], 'to': 'exit'}]}}))
        with patch.object(candidate.subprocess, 'run', side_effect=fake_run):
            with self.assertRaises(ValueError):
                candidate.solve(cage_layout(), strategy='heuristic', time_limit=5)


if __name__ == '__main__':
    unittest.main()
