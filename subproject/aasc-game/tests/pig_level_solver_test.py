import importlib.util
import json
import random
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('pig_play_solver_test', ROOT / 'scripts/play-pig-level.py')
play = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(play)
solver = play.solver


def pig(identifier, col, row, direction):
    dx, _ = solver.VECTORS[direction]
    occupied = [[col, row], [col + 1, row]] if dx else [[col, row], [col, row + 1]]
    return {'id': identifier, 'direction': direction, 'grid': {'col': col, 'row': row, 'cells': occupied},
            'center': [100 + col * 30 + (15 if dx else 0), 299 + row * 30 + (0 if dx else 15)],
            'bbox': [0, 0, 40 if dx else 20, 20 if dx else 40]}


class SolverTest(unittest.TestCase):
    def test_rectangular_entity_checks_all_front_cells(self):
        elephant = {'id': 1, 'direction': 'south', 'length': 3, 'width': 2,
                    'grid': {'col': 0, 'row': 0, 'cells': [[x, y] for y in range(3) for x in range(2)]}}
        other = pig(2, 1, 3, 'south')
        state, directions = solver.prepare([elephant, other], 3, 6)
        choices = solver.actions(state, directions, 3, 6, lengths=[3, 2], widths=[2, 1])
        self.assertFalse(any(option[1] == 0 for option in choices))
        self.assertEqual(solver.solve([elephant, other], 3, 6)['status'], 'solved')

    def test_unknown_blockers_prevent_moves_and_duck_escape(self):
        pigs = [pig(1, 0, 0, 'east')]
        fixed = [(3, 0)]
        state, directions = solver.prepare(pigs, 4, 1)
        self.assertEqual(solver.actions(state, directions, 4, 1, fixed), [(False, 0, (1, 0), 1)])
        self.assertEqual(solver.solve(pigs, 4, 1, blockers=fixed)['status'], 'no_solution_in_model')
        with self.assertRaises(ValueError):
            solver.solve(pigs, 4, 1, blockers=[(0, 0)])
        state, directions = solver.prepare([pig(1, 0, 0, 'east')], 3, 3)
        remaining, departed = solver.settle_ducks(state, directions, [(1, 1)], 3, 3,
                                                   blockers=[(0, 1), (2, 1), (1, 2)])
        self.assertEqual(remaining, ((1, 1),))
        self.assertEqual(departed, ())
        with self.assertRaises(ValueError):
            solver.solve_duck_hypothesis([pig(1, 0, 0, 'east')], [(1, 1)], 3, 3, blockers=[(1, 1)])

    def test_fixed_blockers_never_report_full_game_completion(self):
        pigs = [pig(1, 0, 0, 'east')]
        solution = solver.solve(pigs, 4, 2, blockers=[(0, 1)])
        self.assertEqual(solution['status'], 'solved_with_fixed_blockers')
        checked = solver.validate_candidate_plan(pigs, [], 4, 2, solution['actions'], blockers=[(0, 1)])
        self.assertEqual(checked['status'], 'solved_with_fixed_blockers')
        with self.assertRaises(ValueError):
            solver.validate_candidate_plan(pigs, [], 4, 2, solution['actions'], blockers=[(3, 0)])

    def test_initial_tracking_accepts_animation_but_not_another_cell(self):
        image = cv2.imread(str(ROOT / 'docs/references/pig-game/level-01-initial.png'))
        candidate = pig(1, 0, 0, 'east')
        shifted = dict(candidate, center=[candidate['center'][0] + 9, candidate['center'][1]])
        class FakeWindow:
            def capture(self): return image.copy()
        with patch.object(play.extract, 'identify', side_effect=[([candidate], None, []), ([shifted], None, [])]):
            result = play.stable_initial(FakeWindow(), 2, image, samples=2)
        self.assertEqual(result[0]['direction'], 'east')
        shifted['center'] = [candidate['center'][0] + 16, candidate['center'][1]]
        with patch.object(play.extract, 'identify', side_effect=[([candidate], None, []), ([shifted], None, [])]):
            with self.assertRaises(ValueError):
                play.stable_initial(FakeWindow(), 2, image, samples=2)

    def test_moves_can_stop_before_obstacle(self):
        pigs = [pig(1, 0, 0, 'east'), pig(2, 4, 0, 'south')]
        state, directions = solver.prepare(pigs, 6, 4)
        options = solver.actions(state, directions, 6, 4)
        self.assertIn((False, 0, (2, 0), 2), options)
        solution = solver.solve(pigs, 6, 4)
        self.assertEqual(solution['status'], 'solved')
        self.assertTrue(all(a['exited'] for a in solution['actions']))

    def test_three_cell_pig_blocks_and_slides_with_full_body(self):
        long_pig = pig(1, 0, 0, 'east')
        long_pig['length'] = 3
        long_pig['grid']['cells'] = [[0, 0], [1, 0], [2, 0]]
        blocker = pig(2, 5, 0, 'south')
        state, directions = solver.prepare([long_pig, blocker], 7, 4)
        options = solver.actions(state, directions, 7, 4, lengths=[3, 2])
        self.assertIn((False, 0, (2, 0), 2), options)
        answer = solver.solve([long_pig, blocker], 7, 4)
        self.assertEqual(answer['status'], 'solved')
        with self.assertRaises(ValueError):
            solver.prepare([long_pig, pig(3, 2, 0, 'south')], 7, 4)
        with self.assertRaises(ValueError):
            solver.solve_duck_hypothesis([long_pig, blocker], [(2, 0)], 7, 4)

    def test_blocked_cycle_and_limits(self):
        blocked = [pig(1, 0, 0, 'east'), pig(2, 2, 0, 'west')]
        self.assertEqual(solver.solve(blocked, 4, 1)['status'], 'no_solution_in_model')
        self.assertEqual(solver.solve([pig(1, 0, 0, 'east')], 4, 1, max_states=1)['status'], 'search_limit')

    def test_duck_hypothesis_handles_obstacles_and_chain_departures(self):
        # 中间两只鸭互相阻挡，外侧通道开放后应连续离开。
        pigs = [pig(1, 0, 0, 'east')]
        state, directions = solver.prepare(pigs, 4, 3)
        remaining, departed = solver.settle_ducks(state, directions, [(1, 1), (2, 1)], 4, 3)
        self.assertEqual(remaining, ())
        self.assertEqual(set(departed), {(1, 1), (2, 1)})
        answer = solver.solve_duck_hypothesis(pigs, [(1, 1), (2, 1)], 4, 3)
        self.assertEqual(answer['status'], 'solved_hypothesis')
        self.assertEqual(set(answer['initial_duck_departures']), {(1, 1), (2, 1)})
        with self.assertRaises(ValueError):
            solver.solve_duck_hypothesis(pigs, [(0, 0)], 4, 3)

    def test_optimized_duck_closure_matches_iterative_reference(self):
        rng = random.Random(19)
        columns, rows = 6, 5
        for _ in range(100):
            occupied = set(); pigs = []
            for identifier in range(8):
                col, row = rng.randrange(columns - 1), rng.randrange(rows)
                cells = {(col, row), (col + 1, row)}
                if cells & occupied: continue
                occupied.update(cells); pigs.append(pig(identifier, col, row, 'east'))
            if not pigs: continue
            state, directions = solver.prepare(pigs, columns, rows)
            free = [(x, y) for x in range(columns) for y in range(rows) if (x, y) not in occupied]
            ducks = set(rng.sample(free, min(len(free), rng.randrange(8))))
            remaining = set(ducks)
            while True:
                found = None
                for start in sorted(remaining):
                    visited = {start}; queue = [start]
                    while queue and found is None:
                        x, y = queue.pop()
                        for dx, dy in solver.VECTORS.values():
                            point = (x + dx, y + dy)
                            if not (0 <= point[0] < columns and 0 <= point[1] < rows):
                                found = start; break
                            if point not in occupied and point not in remaining and point not in visited:
                                visited.add(point); queue.append(point)
                    if found is not None: break
                if found is None: break
                remaining.remove(found)
            actual, departed = solver.settle_ducks(state, directions, ducks, columns, rows)
            self.assertEqual(set(actual), remaining)
            self.assertEqual(set(departed), ducks - remaining)

    def test_rejects_overlap_and_unknown(self):
        with self.assertRaises(ValueError):
            solver.prepare([pig(1, 0, 0, 'east'), pig(2, 1, 0, 'west')], 4, 1)
        item = pig(1, 0, 0, 'east'); item['direction'] = 'unknown'
        with self.assertRaises(ValueError):
            solver.prepare([item], 4, 1)

    def test_saved_level_two_full_hypothesis_requires_sliding(self):
        data = json.loads((ROOT / 'docs/references/pig-game/extractions/level-02-original/level.json').read_text())
        answer = solver.solve(data['pigs'], 12, 15)
        self.assertEqual(answer['status'], 'solved')
        self.assertEqual(sum(action['exited'] for action in answer['actions']), 61)
        self.assertTrue(any(not action['exited'] for action in answer['actions']))

    def test_level_fifteen_reordered_actions_find_valid_complete_plan(self):
        path = ROOT / 'docs/references/pig-game/play-runs/level-15-run-20261113-053746-730032/level-reviewed.json'
        data = json.loads(path.read_text())
        pigs = data['pigs']; columns, rows = data['grid'][3:]
        answer = solver.solve(pigs, columns, rows, order_seed=3)
        self.assertEqual(answer['status'], 'solved')
        state, directions = solver.prepare(pigs, columns, rows)
        lengths = [item['length'] for item in pigs]
        for action in answer['actions']:
            valid = solver.actions(state, directions, columns, rows, lengths=lengths)
            destination = tuple(action['to']) if action['to'] is not None else None
            self.assertIn((action['exited'], action['index'], destination, action['travel_cells']), valid)
            state = tuple(destination if i == action['index'] else pos for i, pos in enumerate(state))
        self.assertTrue(all(position is None for position in state))

    def test_external_candidate_is_replayed_and_rejects_bad_moves(self):
        base = ROOT / 'docs/references/pig-game/play-runs/level-16-run-20261113-060659-207301'
        layout = json.loads((base / 'reviewed-layout.json').read_text())
        candidate = json.loads((base / 'candidate-plan-independent-checked.json').read_text())['actions']
        result = solver.validate_candidate_plan(layout['pigs'], layout['ducks'], *layout['grid'][3:], candidate)
        self.assertEqual(result['status'], 'solved_hypothesis')
        self.assertEqual(len(result['actions']), 157)
        bad = [dict(action) for action in candidate]
        bad[0]['travel_cells'] += 1
        with self.assertRaises(ValueError):
            solver.validate_candidate_plan(layout['pigs'], layout['ducks'], *layout['grid'][3:], bad)
        with self.assertRaises(ValueError):
            solver.validate_candidate_plan(layout['pigs'], layout['ducks'], *layout['grid'][3:], candidate[:-1])

    def test_reference_fills_only_matching_complete_layout(self):
        data = json.loads((ROOT / 'docs/references/pig-game/extractions/level-02-original/level.json').read_text())
        candidates = [dict(item) for item in data['pigs']]
        expected = candidates[0]['direction']
        candidates[0]['direction'] = 'unknown'
        self.assertTrue(play.fill_initial_reference(candidates, 2))
        self.assertEqual(candidates[0]['direction'], expected)
        self.assertEqual(candidates[0]['direction_source'], 'matched_complete_initial_reference')
        candidates[0]['direction'] = 'unknown'
        candidates[1]['center'] = [0, 0]
        self.assertFalse(play.fill_initial_reference(candidates, 2))
        self.assertEqual(candidates[0]['direction'], 'unknown')

    def test_planned_session_writes_plan_before_click_and_stops_at_victory(self):
        initial = cv2.imread(str(ROOT / 'docs/references/pig-game/level-01-initial.png'))
        victory = cv2.imread(str(ROOT / 'docs/references/pig-game/level-01-victory.png'))
        candidate = pig(1, 0, 0, 'east')
        class FakeWindow:
            def __init__(self, output):
                self.output, self.clicks = output, []
            def capture(self):
                return (victory if self.clicks else initial).copy()
            def click(self, center, size):
                self.assert_plan()
                self.clicks.append(center)
            def assert_plan(self):
                assert (self.output / 'initial.png').exists()
                assert json.loads((self.output / 'plan.json').read_text())['status'] == 'solved'
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'run'
            fake = FakeWindow(output)
            with patch.object(play, 'stable_initial', return_value=[candidate]), \
                 patch.object(play.extract, 'identify', return_value=([candidate], None, [])):
                status = play.run_planned_session(fake, output, 2, (100, 299, 30, 4, 2), wait_seconds=0)
            self.assertEqual(status, 'victory')
            self.assertEqual(len(fake.clicks), 1)
            self.assertEqual(sorted(p.name for p in output.glob('*.png')), ['initial.png', 'result.png'])

    def test_plan_mismatch_refuses_click(self):
        image = cv2.imread(str(ROOT / 'docs/references/pig-game/level-01-initial.png'))
        candidate = pig(1, 0, 0, 'east')
        mismatch = pig(1, 1, 0, 'east')
        class FakeWindow:
            clicks = 0
            def capture(self): return image.copy()
            def click(self, center, size): self.clicks += 1
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'run'; fake = FakeWindow()
            with patch.object(play, 'stable_initial', return_value=[candidate]), \
                 patch.object(play.extract, 'identify', return_value=([mismatch], None, [])):
                status = play.run_planned_session(fake, output, 2, (100, 299, 30, 4, 2), wait_seconds=0)
            self.assertEqual(status, 'plan_mismatch')
            self.assertEqual(fake.clicks, 0)


if __name__ == '__main__':
    unittest.main()
