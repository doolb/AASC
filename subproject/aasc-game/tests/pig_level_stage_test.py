import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import cv2

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pig_stage_test', ROOT / 'scripts/unlock-pig-object.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
advance_spec = importlib.util.spec_from_file_location('pig_advance_test', ROOT / 'scripts/advance-pig-layout.py')
advance = importlib.util.module_from_spec(advance_spec)
advance_spec.loader.exec_module(advance)
progress_spec = importlib.util.spec_from_file_location('pig_progress_test', ROOT / 'scripts/progress-pig-level.py')
progress = importlib.util.module_from_spec(progress_spec)
progress_spec.loader.exec_module(progress)


class StageTest(unittest.TestCase):
    def test_reviewed_lock_regions_must_remain_visible(self):
        frame = cv2.imread(str(ROOT / 'docs/references/pig-game/play-runs/level-31-full-board/first-exit-confirmed.png'))
        self.assertIsNotNone(frame)
        regions = [[356, 314, 38, 49], [265, 648, 38, 50]]
        self.assertTrue(progress.locks_visible(frame, regions))
        x, y, width, height = regions[0]
        frame[y:y+height, x:x+width] = 0
        self.assertFalse(progress.locks_visible(frame, regions))

    def test_replay_stage_keeps_grid_and_rejects_invalid_action(self):
        runs = ROOT / 'docs/references/pig-game/play-runs'
        reference = json.loads((runs / 'level-26-original-grid-reviewed.json').read_text())
        source = runs / 'level-26-progress-20261113-102732-735854'
        grid, remaining = advance.replay(reference, source)
        self.assertEqual(list(grid), reference['grid'])
        self.assertEqual(len(remaining), 24)
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / 'stage'
            shutil.copytree(source, copy)
            path = copy / 'action-001.json'
            data = json.loads(path.read_text())
            data['action']['travel_cells'] += 1
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, '合法重放'):
                advance.replay(reference, copy)

    def test_search_progress_is_partial_and_replays_valid_moves(self):
        pigs = [{'id': 1, 'direction': 'east', 'grid': {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}},
                {'id': 2, 'direction': 'west', 'grid': {'col': 0, 'row': 1, 'cells': [[0, 1], [1, 1]]}}]
        initial, directions, actions, _ = stage.search(pigs, (0, 0, 1, 4, 2), (), None, remove_goal=1)
        self.assertEqual(len(actions), 1)
        self.assertTrue(actions[0]['exited'])
        self.assertIn((actions[0]['exited'], actions[0]['index'], actions[0]['to'], actions[0]['travel_cells']),
                      stage.app.player.solver.actions(initial, directions, 4, 2))

    def test_stage_geometry_uses_full_cross_section_and_direction(self):
        projected = [(x, y) for x in range(2, 5) for y in (3, 4)]
        entity = {'estimated_grid_cells': projected}
        blockers = tuple(cell for cell in projected if cell != (2, 3))
        fixed, target = stage.stage_geometry([entity], blockers, ((2, 3),), (0, 0, 1, 8, 8), 'west')
        self.assertEqual(set(fixed), {(3, 3), (3, 4), (4, 3), (4, 4)})
        self.assertEqual(target, {(2, 3), (2, 4)})
        _, target = stage.stage_geometry([entity], tuple(projected), (), (0, 0, 1, 8, 8), 'east')
        self.assertEqual(target, {(5, 3), (5, 4)})

    def test_stage_search_can_open_target_without_clearing_board(self):
        pig = {'id': 1, 'direction': 'east', 'grid': {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}}
        initial, _, actions, _ = stage.search([pig], (0, 0, 1, 5, 1), ((3, 0),), {(0, 0)})
        self.assertEqual(initial, ((0, 0),))
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0]['to'], (1, 0))
        self.assertFalse(actions[0]['exited'])

    def test_limit_does_not_claim_no_solution(self):
        pig = {'id': 1, 'direction': 'east', 'grid': {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}}
        with self.assertRaisesRegex(ValueError, '上限'):
            stage.search([pig], (0, 0, 1, 5, 1), ((3, 0),), {(0, 0)}, limit=1)


if __name__ == '__main__':
    unittest.main()
