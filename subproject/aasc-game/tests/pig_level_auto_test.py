import importlib.util
import json
import shutil
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('pig_auto_test', ROOT / 'scripts/auto-pig-levels.py')
app = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(app)
RESUME_SPEC = importlib.util.spec_from_file_location('pig_resume_test', ROOT / 'scripts/resume-pig-level.py')
resume_app = importlib.util.module_from_spec(RESUME_SPEC)
RESUME_SPEC.loader.exec_module(resume_app)
REF = ROOT / 'docs/references/pig-game'


def image(path):
    value = cv2.imread(str(path))
    if value is None: raise AssertionError(str(path))
    return value


def candidate():
    return {'id': 1, 'center': [119.0, 299.0], 'bbox': [99, 289, 40, 20],
            'visual_bbox': [90, 280, 58, 38], 'direction': 'east', 'direction_degrees': 0,
            'confidence': 'medium', 'gesture_occluded': False}


class AutoTest(unittest.TestCase):
    def test_initial_stability_retries_whole_frames_without_click(self):
        first, second = object(), object()
        class Fake:
            def capture(self): return second
        with patch.object(app.player, 'stable_initial', side_effect=[ValueError('动画帧'), ['稳定']]) as match:
            self.assertEqual(app.stable_initial_with_retries(Fake(), 28, first), ['稳定'])
        self.assertIs(match.call_args_list[0].args[2], first)
        self.assertIs(match.call_args_list[1].args[2], second)
        with patch.object(app.player, 'stable_initial', side_effect=ValueError('动画帧')):
            with self.assertRaisesRegex(ValueError, '多组采样'):
                app.stable_initial_with_retries(Fake(), 28, first, attempts=2)

    def test_reviewed_layout_can_extend_board_to_include_edge_pigs(self):
        base = REF / 'play-runs/level-31-full-board'
        frame = image(base / 'second-unlock-stable.png')
        self.assertEqual(app.auto.find_blue_elephants(frame, (74, 205, 391, 602)), [])
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return frame.copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output, fake = Path(tmp) / 'level', Fake()
            with patch.object(app.time, 'sleep'), patch.object(app.player.solver, 'solve', return_value={'status': 'no_solution_in_model', 'states': 1, 'actions': []}):
                with self.assertRaises(ValueError):
                    app.run_level(fake, output, 31, reviewed_layout=base / 'after-second-unlock-layout.json', filter_outside_yellow=True)
            self.assertEqual(json.loads((output / 'level.json').read_text())['board'], [74, 205, 391, 602])
            self.assertFalse(fake.clicks)

    def test_level_30_dense_ducks_match_reviewed_layout(self):
        base = REF / 'play-runs/level-30-run-20261113-120136-876985'
        stage = image(base / 'original.png')
        reference = json.loads((base / 'level-reviewed.json').read_text())
        board = app.player.extract.valid_board(stage, None)
        pigs, _, _ = app.player.extract.identify(stage, board)
        pigs = app.player.with_grid(pigs, reference['grid'])
        ducks, excluded = app.filter_yellow_candidates(app.auto.find_yellow_ducks(stage, board), reference['grid'], pigs)
        self.assertEqual(app.duck_cells(ducks, reference['grid']), {tuple(cell) for cell in reference['ducks']})
        self.assertEqual(len(ducks), 24)
        self.assertTrue(excluded)

    def test_level_27_reviewed_ducks_match_complete_frame(self):
        base = REF / 'play-runs/level-27-ducks-reviewed'
        stage = image(base / 'reviewed-frame.png')
        reference = json.loads((base / 'reviewed-layout.json').read_text())
        board = app.player.extract.valid_board(stage, None)
        pigs, _, _ = app.player.extract.identify(stage, board)
        pigs = app.player.with_grid(pigs, reference['grid'])
        ducks, _ = app.filter_yellow_candidates(app.auto.find_yellow_ducks(stage, board), reference['grid'], pigs)
        self.assertEqual(app.duck_cells(ducks, reference['grid']), {tuple(cell) for cell in reference['ducks']})
        self.assertEqual(len(ducks), 13)
        state, directions = resume_app.app.player.solver.prepare(reference['pigs'], reference['grid'][3], reference['grid'][4])
        matched = resume_app.match_frame(stage, state, directions, {tuple(cell) for cell in reference['ducks']},
                                         reference['grid'], board, [pig.get('length', 2) for pig in reference['pigs']],
                                         filter_outside_yellow=True)
        self.assertIsNotNone(matched)

    def test_sparse_reviewed_layout_keeps_original_grid(self):
        stage = image(REF / 'play-runs/level-26-unlock-20261113-101014-423525/object-confirmed-after.png')
        layout = REF / 'play-runs/level-26-original-grid-reviewed.json'
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return stage.copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output, fake = Path(tmp) / 'level', Fake()
            with patch.object(app.time, 'sleep'), patch.object(app.player.solver, 'solve', return_value={'status': 'no_solution_in_model', 'states': 1, 'actions': []}):
                with self.assertRaises(ValueError):
                    app.run_level(fake, output, 26, reviewed_layout=layout, filter_outside_yellow=True)
            result = json.loads((output / 'level.json').read_text())
            reference = json.loads(layout.read_text())
            self.assertEqual(result['grid_parameters'], reference['grid'])
            self.assertEqual(result['grid_parameters'][3:], [12, 19])
            self.assertFalse(fake.clicks)

    def test_scattered_ducks_near_pigs_use_multiple_templates(self):
        stage = image(REF / 'play-runs/level-25-run-20261113-094109-109533/original.png')
        board = app.player.extract.valid_board(stage, None)
        pigs, _, _ = app.player.extract.identify(stage, board)
        grid = app.auto.infer_grid(pigs, stage.shape[1::-1])
        pigs = app.player.with_grid(pigs, grid)
        ducks, excluded = app.filter_yellow_candidates(app.auto.find_yellow_ducks(stage, board), grid, pigs)
        self.assertEqual(app.duck_cells(ducks, grid), {(3, 1), (3, 16), (4, 1), (4, 4), (4, 7), (4, 10),
                                                      (5, 4), (6, 1), (6, 3), (6, 8), (7, 9)})
        self.assertTrue(excluded)

    def test_ducks_on_sand_are_not_merged_into_background(self):
        stage = image(REF / 'play-runs/level-23-run-20261113-091249-543193/original.png')
        board = app.player.extract.valid_board(stage, None)
        pigs, _, _ = app.player.extract.identify(stage, board)
        grid = app.auto.infer_grid(pigs, stage.shape[1::-1])
        pigs = app.player.with_grid(pigs, grid)
        ducks, excluded = app.filter_yellow_candidates(app.auto.find_yellow_ducks(stage, board), grid, pigs)
        self.assertEqual(app.duck_cells(ducks, grid), {(x, y) for x in (8, 9, 10) for y in (3, 4, 5)})
        self.assertTrue(excluded)

    def test_explicit_filter_records_outside_yellow_decoration(self):
        stage = image(REF / 'play-runs/level-22-unlock-20261113-090827-291008/object-after.png')
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return stage.copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output, fake = Path(tmp) / 'level', Fake()
            with patch.object(app.player.solver, 'solve', return_value={'status': 'no_solution_in_model', 'states': 1, 'actions': []}):
                with self.assertRaises(ValueError):
                    app.run_level(fake, output, 22, duck_auto=True, filter_outside_yellow=True)
            data = json.loads((output / 'level.json').read_text())
            self.assertTrue(data['excluded_yellow_candidates'])
            self.assertFalse(data['other_entities'])
            self.assertFalse(fake.clicks)

    def test_elephant_candidate_becomes_estimated_blocker(self):
        stage = image(REF / 'play-runs/level-21-new-animal-observation/original.png')
        entities = app.auto.find_blue_elephants(stage, (74, 205, 391, 602))
        self.assertEqual(len(entities), 1)
        self.assertIsNone(entities[0]['blocking_bbox'])
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return stage.copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            fake = Fake()
            output = Path(tmp) / 'level'
            with patch.object(app.player.solver, 'solve', return_value={'status': 'no_solution_in_model', 'states': 1, 'actions': []}) as search:
                with self.assertRaises(ValueError):
                    app.run_level(fake, output, 21, duck_auto=True)
            self.assertEqual(json.loads((output / 'result.json').read_text())['status'], 'interrupted')
            self.assertEqual(fake.clicks, [])
            self.assertTrue(search.call_args.kwargs['blockers'])
            self.assertTrue(any(e['kind'] == 'blue_elephant_candidate' for e in json.loads((output / 'level.json').read_text())['other_entities']))

    def test_visual_blockers_record_overlap(self):
        entity = {'bbox': [85, 185, 60, 30]}
        blockers, conflicts = app.auto.estimate_entity_blockers([entity], (100, 200, 30, 3, 2), {(1, 0)})
        self.assertEqual(blockers, ((0, 0),))
        self.assertEqual(conflicts, ((1, 0),))

    def test_infer_grids_from_two_real_levels(self):
        for name in ['extractions/level-02-original/level.json', 'play-runs/level-03-color-arrows/level-reviewed.json']:
            data = json.loads((REF / name).read_text())
            grid = app.auto.infer_grid(data['pigs'], data['image_size'])
            pigs = app.player.with_grid(data['pigs'], grid)
            self.assertEqual(len(pigs), data['count'])
            self.assertAlmostEqual(grid[2], 29.85, delta=0.5)
            self.assertEqual(grid[3:], (12, 15) if 'level-02' in name else (12, 19))

    def test_level_eleven_estimates_five_three_cell_pigs(self):
        frame = image(REF / 'play-runs/level-11-new-animal-observation/original.png')
        candidates, _, _ = app.player.extract.identify(frame)
        grid = app.auto.infer_grid(candidates, frame.shape[1::-1])
        pigs = app.player.with_grid(candidates, grid)
        self.assertEqual(len(pigs), 91)
        self.assertEqual(sum(pig['length'] == 3 for pig in pigs), 5)
        self.assertTrue(all(len(pig['grid']['cells']) == pig['length'] for pig in pigs))

    def test_ui_classification(self):
        cases = [('level-01-initial.png', 'unknown'), ('level-01-victory.png', 'victory'),
                 ('play-runs/level-03-color-arrows/victory.png', 'victory'),
                 ('play-runs/level-03-color-arrows/reward-popup.png', 'reward'),
                 ('play-runs/level-03-color-arrows/ranking-popup.png', 'ranking'),
                 ('play-runs/level-05-run-20261113-001017-609693/original.png', 'animal_guide'),
                 ('play-runs/level-05-color-arrows/original.png', 'unknown')]
        for path, state in cases:
            with self.subTest(path=path): self.assertEqual(app.auto.ui_state(image(REF / path)), state)

    def test_yellow_ducks_are_recorded_and_never_ignored(self):
        board = (74, 205, 391, 602)
        for path in ('level-02-initial.png', 'play-runs/level-03-color-arrows/original.png',
                     'play-runs/level-04-color-arrows/original.png'):
            self.assertEqual(app.auto.find_yellow_ducks(image(REF / path), board), [])
        stage = image(REF / 'play-runs/level-05-color-arrows/original.png')
        self.assertEqual(len(app.auto.find_yellow_ducks(stage, board)), 12)
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return stage.copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'level'; fake = Fake()
            status, _ = app.run_level(fake, output, 5)
            self.assertEqual(status, 'unsupported_entity')
            self.assertEqual(fake.clicks, [])
            data = json.loads((output / 'level.json').read_text())
            self.assertEqual(len(data['other_entities']), 12)
            self.assertFalse((output / 'plan.json').exists())

    def test_new_animal_guide_is_preserved_without_click(self):
        guide = image(REF / 'play-runs/level-05-run-20261113-001017-609693/original.png')
        board = image(REF / 'play-runs/level-05-color-arrows/original.png')
        class Fake:
            def __init__(self, output): self.output, self.clicks = output, []
            def capture(self): return (board if self.clicks else guide).copy()
            def click(self, center, size):
                assert (self.output / 'animal-guide.png').exists()
                self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'level'; fake = Fake(output)
            with patch.object(app.time, 'sleep'):
                status, _ = app.run_level(fake, output, 5)
            self.assertEqual(status, 'new_animal_needs_review')
            self.assertEqual(fake.clicks, [])
            self.assertTrue((output / 'animal-guide.png').exists())
            self.assertFalse((output / 'original.png').exists())

    def test_duck_cells_rejects_overlap_and_out_of_bounds(self):
        grid = (100, 200, 30, 4, 4)
        self.assertEqual(app.duck_cells([{'center': [130, 230]}], grid), {(1, 1)})
        with self.assertRaises(ValueError):
            app.duck_cells([{'center': [130, 230]}, {'center': [131, 230]}], grid)
        with self.assertRaises(ValueError):
            app.duck_cells([{'center': [250, 230]}], grid)

    def test_reviewed_duck_layout_mismatch_never_clicks(self):
        sample = REF / 'play-runs/level-05-user-duck-evidence'
        frame = image(sample / 'after-user-moves.png')
        reference = json.loads((sample / 'reviewed-layout.json').read_text())
        reference['ducks'].pop()
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return frame.copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'layout.json'; source.write_text(json.dumps(reference))
            output = Path(tmp) / 'output'; fake = Fake()
            with patch.object(app.time, 'sleep'):
                with self.assertRaises(ValueError):
                    app.run_level(fake, output, 5, reviewed_layout=source)
            self.assertEqual(fake.clicks, [])
            self.assertFalse((output / 'plan.json').exists())

    def test_reviewed_duck_layout_waits_for_complete_frame(self):
        base = REF / 'play-runs'
        incomplete = image(base / 'level-07-run-20261113-025310-517794/original.png')
        full = image(base / 'level-07-run-20261113-025137-642881/original.png')
        source = base / 'level-07-run-20261113-025137-642881/reordered-reviewed-layout.json'
        class Fake:
            def __init__(self): self.frames, self.clicks = 0, []
            def capture(self):
                self.frames += 1
                return (incomplete if self.frames == 1 else full).copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'output'; fake = Fake()
            find_ducks = app.auto.find_yellow_ducks
            attempts = []
            def occasionally_incomplete(frame, board):
                ducks = find_ducks(frame, board)
                attempts.append(1)
                return ducks[:-2] if len(attempts) == 1 else ducks
            with patch.object(app.time, 'sleep'), \
                 patch.object(app.auto, 'find_yellow_ducks', side_effect=occasionally_incomplete), \
                 patch.object(app.fast, 'solve_fast', return_value={'status': 'search_limit', 'states': 0, 'actions': []}), \
                 patch.object(app.player.solver, 'solve_duck_hypothesis', return_value={
                     'status': 'search_limit', 'states': 1, 'actions': [], 'initial_duck_departures': ()}):
                with self.assertRaises(ValueError):
                    app.run_level(fake, output, 7, reviewed_layout=source)
            self.assertGreaterEqual(fake.frames, 2)
            self.assertEqual(fake.clicks, [])
            self.assertEqual(len(app.auto.find_yellow_ducks(image(output / 'original.png'), (74, 205, 391, 602))), 14)

    def test_adjacent_ducks_are_split_when_their_colors_touch(self):
        board = (74, 205, 391, 602)
        paths = ('play-runs/level-07-run-20261113-025137-642881/original.png',
                 'play-runs/level-07-run-20261113-025310-517794/original.png')
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(len(app.auto.find_yellow_ducks(image(REF / path), board)), 14)

    def test_duck_auto_search_limit_never_clicks(self):
        sample = REF / 'play-runs/level-05-user-duck-evidence'
        frame = image(sample / 'after-user-moves.png')
        reference = json.loads((sample / 'reviewed-layout.json').read_text())
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return frame.copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'output'; fake = Fake()
            with patch.object(app.player, 'stable_initial', return_value=reference['pigs']), \
                 patch.object(app.auto, 'infer_grid', return_value=tuple(reference['grid'])), \
                 patch.object(app.player, 'with_grid', side_effect=lambda pigs, grid: pigs), \
                 patch.object(app.fast, 'solve_fast', return_value={'status': 'search_limit', 'states': 0, 'actions': []}), \
                 patch.object(app.player.solver, 'solve_duck_hypothesis', return_value={
                     'status': 'search_limit', 'states': 1, 'actions': [], 'initial_duck_departures': ()}):
                with self.assertRaises(ValueError):
                    app.run_level(fake, output, 5, duck_auto=True)
            self.assertEqual(fake.clicks, [])
            self.assertEqual(json.loads((output / 'plan.json').read_text())['status'], 'search_limit')

    def test_no_duck_search_retries_but_still_requires_solution(self):
        frame = image(REF / 'level-02-initial.png'); item = candidate()
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return frame.copy()
            def click(self, center, size): self.clicks.append(center)
        results = [{'status': 'search_limit', 'states': 1, 'actions': []},
                   {'status': 'no_solution_in_model', 'states': 2, 'actions': []}]
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'output'; fake = Fake()
            with patch.object(app.player.extract, 'identify', return_value=([item], None, [])), \
                 patch.object(app.player.extract, 'find_gesture', return_value=[]), \
                 patch.object(app.player, 'stable_initial', return_value=[item]), \
                 patch.object(app.auto, 'infer_grid', return_value=(104, 299, 30, 4, 2)), \
                 patch.object(app.player.solver, 'solve', side_effect=results) as solve:
                with self.assertRaises(ValueError): app.run_level(fake, output, 15)
            self.assertEqual(solve.call_count, 2)
            self.assertEqual(fake.clicks, [])
            self.assertEqual(json.loads((output / 'plan.json').read_text())['status'], 'no_solution_in_model')

    def test_reviewed_no_duck_layout_uses_reviewed_order(self):
        frame = image(REF / 'level-02-initial.png'); item = candidate(); grid = (104, 299, 30, 4, 2)
        reviewed = app.player.with_grid([item], grid)
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return frame.copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'reviewed.json'
            source.write_text(json.dumps({'pigs': reviewed, 'grid': grid, 'ducks': []}))
            output = Path(tmp) / 'output'; fake = Fake()
            with patch.object(app.player.extract, 'identify', return_value=([item], None, [])), \
                 patch.object(app.player.extract, 'find_gesture', return_value=[]), \
                 patch.object(app.player.solver, 'solve', return_value={
                     'status': 'no_solution_in_model', 'states': 1, 'actions': []}) as solve:
                with self.assertRaises(ValueError): app.run_level(fake, output, 15, reviewed_layout=source)
            self.assertEqual(fake.clicks, [])
            self.assertEqual(solve.call_args.args[0], reviewed)

    def test_invalid_external_candidate_never_clicks(self):
        base = REF / 'play-runs/level-16-run-20261113-060659-207301'
        frame = image(base / 'original.png')
        candidate_plan = json.loads((base / 'candidate-plan-independent-checked.json').read_text())
        candidate_plan['actions'][0]['travel_cells'] += 1
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return frame.copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            plan = Path(tmp) / 'invalid.json'; plan.write_text(json.dumps(candidate_plan))
            output = Path(tmp) / 'output'; fake = Fake()
            with patch.object(app.time, 'sleep'):
                with self.assertRaises(ValueError):
                    app.run_level(fake, output, 16, reviewed_layout=base / 'reviewed-layout.json', candidate_plan=plan)
            self.assertEqual(fake.clicks, [])
            self.assertFalse((output / 'plan.json').exists())

    def test_fast_candidate_is_independently_checked(self):
        item = app.player.with_grid([candidate()], (104, 299, 30, 4, 2))[0]
        with self.assertRaises(ValueError):
            app.fast.decode_candidate('99 -1 0 1\n', [item], [], 4, 2)
        with patch.object(app.fast.shutil, 'which', return_value=None):
            self.assertEqual(app.fast.solve_fast([item], [], 4, 2)['status'], 'search_limit')
        if shutil.which('g++'):
            result = app.fast.solve_fast([item], [], 4, 2, seeds=(1,))
            self.assertEqual(result['status'], 'solved')
            self.assertEqual(len(result['actions']), 1)
            result = app.fast.solve_fast([item], [], 4, 2, seeds=(1,), blockers=[(0, 1)])
            self.assertEqual(result['status'], 'solved_with_fixed_blockers')
            with self.assertRaises(ValueError):
                app.fast.decode_candidate('0 -1 2 1\n', [item], [], 4, 2, blockers=[(3, 0)])
            elephant = {'id': 1, 'direction': 'south', 'length': 3, 'width': 2,
                        'grid': {'col': 0, 'row': 0, 'cells': [[x, y] for y in range(3) for x in range(2)]}}
            other = {'id': 2, 'direction': 'south', 'grid': {'col': 1, 'row': 3, 'cells': [[1, 3], [1, 4]]}}
            result = app.fast.solve_fast([elephant, other], [], 3, 6, seeds=(1,))
            self.assertEqual(result['status'], 'solved')
            self.assertEqual(result['actions'][0]['pig_id'], 2)

    def test_next_requires_verified_victory_and_changed_header(self):
        before = image(REF / 'level-02-initial.png'); after = image(REF / 'play-runs/level-03-color-arrows/original.png')
        win = image(REF / 'play-runs/level-02-planned-20261112-03/result.png')
        self.assertTrue(app.header_changed(before, after))
        self.assertFalse(app.header_changed(before, before))
        same_level = image(REF / 'play-runs/level-02-planned-20261112-03/initial.png')
        fourth = image(REF / 'play-runs/level-04-color-arrows/original.png')
        self.assertFalse(app.header_changed(before, same_level))
        self.assertTrue(app.header_changed(after, fourth))
        fifth = image(REF / 'play-runs/level-05-run-20261113-022612-550658/original.png')
        sixth = image(REF / 'play-runs/level-06-transition-20261113-023243-999673/transition-unverified.png')
        self.assertTrue(app.header_changed(fifth, sixth))
        class Fake:
            def __init__(self, frame): self.frame, self.clicks = frame, []
            def capture(self): return (after if self.clicks else self.frame).copy()
            def click(self, center, size): self.clicks.append(center)
        fake = Fake(win)
        with patch.object(app.player.extract, 'identify', return_value=([candidate()], None, [])), patch.object(app.time, 'sleep'):
            result = app.transition_to_next(fake, before)
        self.assertEqual(result.shape, after.shape)
        self.assertEqual(len(fake.clicks), 1)
        bad = Fake(before)
        with self.assertRaises(ValueError): app.transition_to_next(bad)
        self.assertEqual(bad.clicks, [])

        # 成功标题闪动时先出现低分帧，脚本等待确认后也只点击一次。
        flicker = Fake(win)
        with patch.object(app.auto, 'ui_state', side_effect=['unknown', 'unknown', 'victory', 'unknown', 'unknown', 'unknown']), \
             patch.object(app.player.extract, 'identify', return_value=([candidate()], None, [])), \
             patch.object(app.time, 'sleep'):
            app.transition_to_next(flicker, before)
        self.assertEqual(len(flicker.clicks), 1)

    def test_transition_waits_for_board_loading_to_finish(self):
        win = image(REF / 'play-runs/level-03-color-arrows/victory.png')
        loading = image(REF / 'play-runs/level-08-run-20261113-031707-204383/original.png')
        ready = image(REF / 'play-runs/level-08-initial-stable/original.png')
        self.assertLess(app.auto.ui_match(loading, 'board_ready'), 0.9)
        self.assertGreater(app.auto.ui_match(ready, 'board_ready'), 0.9)
        class Fake:
            def __init__(self): self.clicks = []; self.frames = 0
            def capture(self):
                if not self.clicks: return win.copy()
                self.frames += 1
                return (loading if self.frames < 3 else ready).copy()
            def click(self, center, size): self.clicks.append(center)
        fake = Fake()
        with patch.object(app.time, 'sleep'):
            result = app.transition_to_next(fake)
        self.assertEqual(len(fake.clicks), 1)
        self.assertGreaterEqual(fake.frames, 5)
        self.assertGreater(len(app.player.extract.identify(result)[0]), 1)

    def test_transition_retries_only_after_confirmed_unchanged_victory(self):
        win = image(REF / 'play-runs/level-03-color-arrows/victory.png')
        ready = image(REF / 'play-runs/level-04-color-arrows/original.png')
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return (ready if len(self.clicks) >= 2 else win).copy()
            def click(self, center, size): self.clicks.append(center)
        fake = Fake()
        with patch.object(app.time, 'sleep'), \
             patch.object(app.player.extract, 'identify', return_value=([candidate()], None, [])):
            app.transition_to_next(fake)
        self.assertEqual(len(fake.clicks), 2)

    def test_reward_and_ranking_are_recorded_before_dismissal(self):
        frames = [image(REF / 'play-runs/level-03-color-arrows'/name) for name in ('reward-popup.png','ranking-popup.png','victory.png')]
        class Fake:
            def __init__(self, output): self.clicks, self.output = [], output
            def capture(self): return frames[min(len(self.clicks),2)].copy()
            def click(self, center, size):
                assert (self.output / ('reward-01.png' if not self.clicks else 'ranking-01.png')).exists()
                self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp); fake = Fake(output)
            with patch.object(app.time, 'sleep'):
                result = app.await_victory(fake, output)
            self.assertIsNotNone(result)
            self.assertEqual(len(fake.clicks), 2)
            self.assertTrue((output/'victory.png').exists())

    def test_unconfirmed_transition_preserves_screen(self):
        win = image(REF / 'play-runs/level-03-color-arrows/victory.png')
        next_image = image(REF / 'play-runs/level-04-color-arrows/original.png')
        class Fake:
            def __init__(self): self.clicks = 0
            def capture(self): return (win if not self.clicks else next_image).copy()
            def click(self, center, size): self.clicks += 1
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'unverified'; fake = Fake()
            with patch.object(app, 'header_changed', return_value=False), patch.object(app.time, 'sleep'):
                with self.assertRaises(RuntimeError): app.transition_to_next(fake, next_image, output)
            self.assertEqual(fake.clicks, 1)
            self.assertTrue((output/'transition-unverified.png').exists())
            self.assertEqual(json.loads((output/'result.json').read_text())['status'], 'transition_unverified')

    def test_transition_stops_on_new_animal_guide(self):
        win = image(REF / 'play-runs/level-03-color-arrows/victory.png')
        guide = image(REF / 'play-runs/level-05-run-20261113-001017-609693/original.png')
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return (guide if self.clicks else win).copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'transition'; fake = Fake()
            with patch.object(app.time, 'sleep'):
                with self.assertRaises(RuntimeError): app.transition_to_next(fake, evidence_dir=output)
            self.assertEqual(len(fake.clicks), 1)
            self.assertTrue((output / 'animal-guide.png').exists())
            self.assertEqual(json.loads((output / 'result.json').read_text())['status'], 'new_animal_needs_review')

    def test_transition_preserves_and_dismisses_delayed_ranking(self):
        ranking = image(REF / 'play-runs/level-03-color-arrows/ranking-popup.png')
        win = image(REF / 'play-runs/level-03-color-arrows/victory.png')
        ready = image(REF / 'play-runs/level-04-color-arrows/original.png')
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return (ranking if not self.clicks else win if len(self.clicks) == 1 else ready).copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'transition'; fake = Fake()
            with patch.object(app.time, 'sleep'), \
                 patch.object(app.player.extract, 'identify', return_value=([candidate()], None, [])):
                app.transition_to_next(fake, evidence_dir=output)
            self.assertEqual(len(fake.clicks), 2)
            self.assertTrue((output / 'ranking-01.png').exists())
            self.assertTrue((output / 'victory.png').exists())

    def test_transition_handles_reward_after_first_next_click(self):
        reward = image(REF / 'play-runs/level-03-color-arrows/reward-popup.png')
        win = image(REF / 'play-runs/level-03-color-arrows/victory.png')
        ready = image(REF / 'play-runs/level-04-color-arrows/original.png')
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self):
                return (win if len(self.clicks) in (0, 2) else reward if len(self.clicks) == 1 else ready).copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'transition'; fake = Fake()
            with patch.object(app.time, 'sleep'), \
                 patch.object(app.player.extract, 'identify', return_value=([candidate()], None, [])):
                app.transition_to_next(fake, evidence_dir=output)
            self.assertEqual(len(fake.clicks), 3)
            self.assertTrue((output / 'reward-01.png').exists())
            self.assertTrue((output / 'victory.png').exists())

    def test_resume_pending_action_only_counts_after_matching_screen(self):
        initial = REF / 'level-01-initial.png'
        win = image(REF / 'level-01-victory.png')
        item = candidate()
        item['grid'] = {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}
        action = {'index': 0, 'pig_id': 1, 'from': [0, 0], 'to': None,
                  'direction': 'east', 'exited': True, 'travel_cells': 2}
        pending = {'action': action, 'observed_center': item['center']}
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return image(initial)
            def click(self, center, size): self.clicks.append(center)
        for already_done in (False, True):
            with self.subTest(already_done=already_done), tempfile.TemporaryDirectory() as tmp:
                source = Path(tmp) / 'source'; source.mkdir(); output = Path(tmp) / 'resume'; fake = Fake()
                for name in ('original.png', 'annotated.png'): shutil.copyfile(initial, source / name)
                (source / 'level.json').write_text('{}')
                (source / 'level-reviewed.json').write_text(json.dumps({'pigs': [item], 'grid': [104, 299, 30, 4, 2]}))
                (source / 'plan.json').write_text(json.dumps({'actions': [action]}))
                (source / 'result.json').write_text(json.dumps({'status': 'interrupted', 'confirmed': 0, 'pending_action': pending}))
                def matches(frame, state, directions, ducks, grid, board, lengths=None):
                    if state[0] is None:
                        return {} if already_done else None
                    return None if already_done else {(0, 0): item}
                with patch.object(resume_app, 'match_frame', side_effect=matches), \
                     patch.object(resume_app.app, 'await_victory', return_value=win), \
                     patch.object(resume_app.app.auto, 'ui_state', return_value='victory' if already_done else 'unknown'), \
                     patch.object(resume_app.time, 'sleep'):
                    self.assertEqual(resume_app.resume(fake, source, output), 'victory')
                self.assertEqual(len(fake.clicks), 0 if already_done else 1)
                self.assertEqual(json.loads((output / 'result.json').read_text())['confirmed'], 1)

    def test_order_image_shows_every_move_of_same_pig(self):
        canvas = image(REF / 'level-01-initial.png')
        pigs = [candidate()]
        actions = [{'pig_id': 1, 'exited': False, 'travel_cells': 2},
                   {'pig_id': 1, 'exited': True, 'travel_cells': 0}]
        original_put_text = app.auto.cv2.putText
        with patch.object(app.auto.cv2, 'putText', wraps=original_put_text) as put_text:
            result = app.auto.render_solution(canvas, pigs, actions)
        labels = [call.args[1] for call in put_text.call_args_list]
        self.assertIn('1/2', labels)
        self.assertGreater(result.shape[1], canvas.shape[1])

    def test_run_saves_verified_order_after_victory(self):
        before = image(REF / 'level-02-initial.png'); win = image(REF / 'play-runs/level-02-planned-20261112-03/result.png'); item = candidate()
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return (win if self.clicks else before).copy()
            def click(self, center, size): self.clicks.append(center)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)/'level'; fake = Fake()
            with patch.object(app.player.extract, 'identify', return_value=([item], None, [])), \
                 patch.object(app.player.extract, 'find_gesture', return_value=[]), \
                 patch.object(app.player, 'stable_initial', return_value=[item]), \
                 patch.object(app.auto, 'infer_grid', return_value=(104, 299, 30, 4, 2)), \
                 patch.object(app.time, 'sleep'):
                status, _ = app.run_level(fake, output, 2, wait_seconds=0)
            self.assertEqual(status, 'victory')
            self.assertEqual(len(fake.clicks), 1)
            for name in ('original.png','level.json','annotated.png','plan.json','victory.png','solution-order.png','solution-order.json','action-001.json','result.json'):
                self.assertTrue((output/name).exists(), name)
            self.assertEqual(json.loads((output/'result.json').read_text())['confirmed'], 1)

    def test_unconfirmed_step_is_not_exported_as_success(self):
        before = image(REF / 'level-02-initial.png'); item = candidate()
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): return before.copy()
            def click(self, center, size): self.clicks.append(center)
        # 两只独立小猪可形成两步计划，第一次点击后识别故意不匹配。
        second = dict(item, id=2, center=[179., 299.], bbox=[159,289,40,20])
        detections = [([item, second], None, []), ([item, second], None, [])] + [([], None, [])] * 25
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)/'level'; fake = Fake()
            with patch.object(app.player.extract, 'identify', side_effect=detections), \
                 patch.object(app.player.extract, 'find_gesture', return_value=[]), \
                 patch.object(app.player, 'stable_initial', return_value=[item, second]), \
                 patch.object(app.auto, 'infer_grid', return_value=(104,299,30,5,2)), \
                 patch.object(app.time, 'sleep'):
                with self.assertRaises(ValueError): app.run_level(fake, output, 2, wait_seconds=0)
            self.assertEqual(len(fake.clicks), 1)
            self.assertFalse((output/'action-001.json').exists())
            self.assertFalse((output/'solution-order.png').exists())
            self.assertEqual(json.loads((output/'result.json').read_text())['confirmed'], 0)


if __name__ == '__main__': unittest.main()
