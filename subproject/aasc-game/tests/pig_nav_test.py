import hashlib
import copy
import json
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import numpy as np
import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('pig_nav_plan_test', ROOT / 'scripts/pig-nav-plan.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
middle_spec = importlib.util.spec_from_file_location('pig_nav_middle_test', ROOT / 'scripts/pig-nav-middle.py')
middle = importlib.util.module_from_spec(middle_spec)
middle_spec.loader.exec_module(middle)
stage_spec = importlib.util.spec_from_file_location('pig_nav_reviewed_cage_test', ROOT / 'scripts/pig-nav-reviewed-cage.py')
stage = importlib.util.module_from_spec(stage_spec)
stage_spec.loader.exec_module(stage)


class PigNavigationTest(unittest.TestCase):
    def test_middle_reuses_only_identical_victory_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / 'current'
            current.mkdir()
            (current / 'level.json').write_text(json.dumps({'level': 81, 'unknown_directions': 1, 'other_entities': []}))
            archive = root / 'archive'
            old = archive / 'level-81-historical'
            old.mkdir(parents=True)
            (old / 'original.png').write_bytes(b'image')
            (old / 'level-reviewed.json').write_text(json.dumps(self.layout()))
            (old / 'plan.json').write_text(json.dumps({**self.layout(), 'actions': [{'pig_id': 1}]}))
            (old / 'result.json').write_text(json.dumps({'level': 81, 'status': 'victory'}))
            self.assertEqual(middle.inspect(current, b'image', 81, archive)['status'], 'gap')
            (old / 'victory.png').write_bytes(b'victory')
            self.assertEqual(middle.inspect(current, b'changed', 81, archive)['status'], 'gap')
            result = middle.inspect(current, b'image', 81, archive)
            self.assertEqual(result['status'], 'reviewed')
            self.assertEqual(app.validate_layout(result['layout'], b'image', 81)[1], hashlib.sha256(b'image').hexdigest())
            (old / 'plan.json').write_text(json.dumps({**self.layout(), 'actions': [{'pig_id': 1}], 'blockers': [[2, 1]]}))
            self.assertEqual(middle.inspect(current, b'image', 81, archive)['status'], 'gap')
            self.assertEqual(middle.inspect(current, b'image', 80, archive)['status'], 'gap')

    def test_middle_ignores_only_pixels_outside_board(self):
        first = np.zeros((20, 20, 3), np.uint8)
        second = first.copy()
        second[0, 0] = 255
        encode = lambda image: cv2.imencode('.png', image)[1].tobytes()
        self.assertTrue(middle.same_board(encode(first), encode(second), [5, 5, 10, 10]))
        second[7, 7] = 255
        self.assertFalse(middle.same_board(encode(first), encode(second), [5, 5, 10, 10]))

    def test_local_cage_rejects_unknown_or_special_outside(self):
        image = np.full((100, 100, 3), 255, np.uint8)
        mask = np.zeros((100, 100), np.uint8)
        mask[30:60, 30:60] = 255
        cage = {'bbox': [30, 30, 30, 30], 'mask': mask}
        candidates = {'board': [0, 0, 100, 100], 'pigs': [
            {'center': [10, 10], 'direction': 'east'},
            {'center': [40, 40], 'direction': 'unknown'},
        ], 'other_entities': []}
        encode = lambda value: cv2.imencode('.png', value)[1].tobytes()
        with patch.object(middle.pig_cage, 'detect', return_value=[cage]):
            self.assertTrue(middle.can_handle_cage(encode(image), candidates))
            unknown = copy.deepcopy(candidates)
            unknown['pigs'][0]['direction'] = 'unknown'
            self.assertFalse(middle.can_handle_cage(encode(image), unknown))
            special = copy.deepcopy(candidates)
            special['pigs'][0]['kind'] = 'spring'
            self.assertFalse(middle.can_handle_cage(encode(image), special))
            blue = image.copy()
            blue[10:20, 10:20] = [255, 0, 0]
            self.assertFalse(middle.can_handle_cage(encode(blue), candidates))
            entity = copy.deepcopy(candidates)
            entity['other_entities'] = [{'center': [15, 15]}]
            self.assertFalse(middle.can_handle_cage(encode(image), entity))

    def test_reviewed_stage_requires_special_markers_and_unknowns_to_be_blocked(self):
        image = np.full((100, 100, 3), 255, np.uint8)
        screenshot = cv2.imencode('.png', image)[1].tobytes()
        grid = [10, 10, 10, 8, 8]
        box = [20, 20, 5, 5]
        cage_cells = {(4, 4)}
        protected = stage.protected_cells(box, grid) | cage_cells
        cage = {'bbox': [40, 40, 10, 10], 'mask': np.zeros((100, 100), np.uint8)}
        layout = {'level': 81, 'reviewed': True, 'mechanicsReviewed': True, 'stage_mode': 'conservative_cage',
                  'mechanics': ['ordinary', 'cage'], 'source_sha256': hashlib.sha256(screenshot).hexdigest(),
                  'board': [0, 0, 90, 80], 'grid': grid, 'blockers': [list(c) for c in protected],
                  'cage_cells': [[4, 4]], 'cage_unknown': [{'center': [22, 22], 'bbox': box, 'direction': 'unknown'}],
                  'pigs': [{'id': 1, 'direction': 'west'}], 'cage_counters': [4], 'locks': {}, 'ducks': []}
        executor = SimpleNamespace(
            app=SimpleNamespace(player=SimpleNamespace(solver=SimpleNamespace(prepare=lambda *_: ([(7, 7)], ['west']))),
                                auto=SimpleNamespace(find_yellow_ducks=lambda *_: [])),
            validate_plan=lambda *_args, **_kwargs: None,
            match_cage_frame=lambda *_: {}, cage_blue_regions=lambda *_: [])
        execute = SimpleNamespace(validate_board=lambda *_: None)
        middle_stub = SimpleNamespace(outside_special_boxes=lambda *_: [box])
        with patch.object(stage, 'load', side_effect=lambda name, _file: middle_stub if 'middle' in name else execute), \
             patch.object(stage.pig_cage, 'detect', return_value=[cage]), \
             patch.object(stage.pig_cage, 'cells', return_value=cage_cells), \
             patch.object(stage.candidate, 'locked_module', return_value=executor):
            stage.validate_layout(layout, screenshot, 81)
            unsafe = copy.deepcopy(layout)
            unsafe['blockers'].remove([0, 0])
            with self.assertRaisesRegex(ValueError, '未知物件周边'):
                stage.validate_layout(unsafe, screenshot, 81)
            with self.assertRaisesRegex(ValueError, '绑定'):
                stage.validate_layout(layout, b'changed', 81)

    def test_reviewed_stage_waits_for_two_stable_matching_frames(self):
        layout = {'pigs': [1], 'grid': [0, 0, 10, 2, 2], 'board': [0, 0, 20, 20],
                  'cage_cells': [[1, 1]], 'cage_unknown': []}
        adapter = SimpleNamespace(capture=lambda: object())
        solver = SimpleNamespace(prepare=lambda *_: ([0], ['east']))
        executor = SimpleNamespace(app=SimpleNamespace(player=SimpleNamespace(solver=solver)))
        outcomes = iter([ValueError('动画碎片'), {}, None, {}, {}])
        def match(*_args, **_kwargs):
            result = next(outcomes)
            if isinstance(result, Exception):
                raise result
            return result
        executor.match_cage_frame = match
        with patch.object(stage.time, 'sleep', return_value=None):
            self.assertIsNotNone(stage.capture_matching(adapter, executor, layout, attempts=5))
        executor.match_cage_frame = lambda *_args, **_kwargs: None
        with patch.object(stage.time, 'sleep', return_value=None), self.assertRaisesRegex(ValueError, '连续核对失败'):
            stage.capture_matching(adapter, executor, layout, attempts=2)

    def test_reviewed_red_hint_must_be_unique_and_frozen(self):
        image = np.full((100, 100, 3), 255, np.uint8)
        screenshot = cv2.imencode('.png', image)[1].tobytes()
        grid, box = [10, 10, 10, 8, 8], [20, 20, 5, 5]
        blocked = stage.protected_cells(box, grid, padding=0) | {(1, 1), (4, 4)}
        cage = {'bbox': [40, 40, 10, 10], 'mask': np.zeros((100, 100), np.uint8)}
        frozen = {'id': 40, 'center': [22, 22], 'direction': 'east', 'grid': {'cells': [[1, 1]]}}
        layout = {'level': 81, 'reviewed': True, 'mechanicsReviewed': True, 'stage_mode': 'conservative_cage',
                  'mechanics': ['ordinary', 'cage'], 'source_sha256': hashlib.sha256(screenshot).hexdigest(),
                  'board': [0, 0, 90, 80], 'grid': grid, 'blockers': [list(c) for c in blocked],
                  'cage_cells': [[4, 4]], 'cage_unknown': [frozen], 'reviewed_red_hints': [40],
                  'pigs': [{'id': 1, 'direction': 'west'}], 'cage_counters': [4], 'locks': {}, 'ducks': []}
        detected = [{'center': [22, 22], 'highlighted_clickable': True}]
        executor = SimpleNamespace(
            app=SimpleNamespace(player=SimpleNamespace(solver=SimpleNamespace(prepare=lambda *_: ([(7, 7)], ['west'])),
                                                       with_grid=lambda items, _grid: items,
                                                       extract=SimpleNamespace(identify=lambda *_: (detected, None, []))),
                                auto=SimpleNamespace(find_yellow_ducks=lambda *_: [])),
            validate_plan=lambda *_args, **_kwargs: None, match_cage_frame=lambda *_: {}, cage_blue_regions=lambda *_: [])
        with patch.object(stage, 'load', side_effect=lambda name, _file: SimpleNamespace(outside_special_boxes=lambda *_: [box])
                          if 'middle' in name else SimpleNamespace(validate_board=lambda *_: None)), \
             patch.object(stage.pig_cage, 'detect', return_value=[cage]), \
             patch.object(stage.pig_cage, 'cells', return_value={(4, 4)}), \
             patch.object(stage.candidate, 'locked_module', return_value=executor):
            stage.validate_layout(layout, screenshot, 81)
            detected[0]['highlighted_clickable'] = False
            with self.assertRaisesRegex(ValueError, '未被保守阻挡|未能与唯一'):
                stage.validate_layout(layout, screenshot, 81)

    def layout(self):
        return {'level': 81, 'reviewed': True, 'mechanicsReviewed': True, 'mechanics': ['ordinary'],
                'source_sha256': hashlib.sha256(b'image').hexdigest(),
                'grid': [10, 10, 20, 3, 2], 'board': [0, 0, 80, 60], 'locks': {},
                'pigs': [{'id': 1, 'center': [20, 10], 'direction': 'east', 'length': 2,
                          'grid': {'col': 0, 'row': 0, 'cells': [[0, 0], [1, 0]]}}]}

    def test_requires_current_image_review_and_rejects_bombs(self):
        layout = self.layout()
        with self.assertRaisesRegex(ValueError, '首屏'):
            app.validate_layout(layout, b'other', 81)
        layout['pigs'][0]['kind'] = 'bomb'
        with self.assertRaisesRegex(ValueError, '特殊'):
            app.validate_layout(layout, b'image', 81)
        layout = self.layout()
        layout['reviewed'] = False
        with self.assertRaisesRegex(ValueError, '复核'):
            app.validate_layout(layout, b'image', 81)
        layout = self.layout()
        layout['other_entities'] = [{'kind': 'unknown'}]
        with self.assertRaisesRegex(ValueError, '尚未核对'):
            app.validate_layout(layout, b'image', 81)
        layout = self.layout()
        layout['locks'] = {'1': 1}
        with self.assertRaisesRegex(ValueError, '未声明'):
            app.validate_layout(layout, b'image', 81)
        layout = self.layout()
        layout['mechanics'].append('cage')
        layout['cage_cells'] = [[1, 1]]
        with self.assertRaisesRegex(ValueError, '铁笼占格'):
            app.validate_layout(layout, b'image', 81)

    def test_auto_solver_plan_is_independently_replayed(self):
        layout = self.layout()
        plan = app.build_plan(layout, b'image', 81)
        self.assertEqual(plan['status'], 'solved')
        self.assertEqual(plan['navigation']['strategy'], 'auto')
        self.assertTrue(plan['navigation']['replayed'])
        self.assertTrue(plan['actions'])
        app.candidate.locked_module().validate_plan(plan, require_complete=True)
        execute_spec = importlib.util.spec_from_file_location('pig_nav_execute_test', ROOT / 'scripts/pig-nav-execute.py')
        execute = importlib.util.module_from_spec(execute_spec)
        execute_spec.loader.exec_module(execute)
        execute.verify(plan, layout, b'image', 81)
        modified = copy.deepcopy(plan)
        modified['actions'][0]['pig_id'] = 999
        with self.assertRaises(ValueError):
            execute.verify(modified, layout, b'image', 81)

    def test_bomb_layout_can_be_planned_but_never_executed_without_visual_check(self):
        layout = self.layout()
        layout.update({'mechanics': ['ordinary', 'bomb'], 'bombs': {'1': 3}, 'bomb_policy': 'avoid_contact'})
        layout['pigs'][0]['kind'] = 'bomb'
        plan = app.build_plan(layout, b'image', 81)
        self.assertEqual(plan['status'], 'solved')
        execute_spec = importlib.util.spec_from_file_location('pig_nav_execute_bomb_test', ROOT / 'scripts/pig-nav-execute.py')
        execute = importlib.util.module_from_spec(execute_spec)
        execute_spec.loader.exec_module(execute)
        execute.verify(plan, layout, b'image', 81)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'plan.json').write_text(json.dumps(plan))
            (root / 'layout.json').write_text(json.dumps(layout))
            (root / 'image.png').write_bytes(b'image')
            argv = ['pig-nav-execute', '--plan', str(root / 'plan.json'), '--layout', str(root / 'layout.json'),
                    '--image', str(root / 'image.png'), '--level', '81', '--window-id', '0x123', '--output', str(root / 'execution')]
            with patch.object(sys, 'argv', argv), patch.object(execute, 'load_executor', wraps=execute.load_executor) as loader:
                with self.assertRaises(SystemExit):
                    execute.main()
                self.assertEqual(loader.call_count, 1)  # verify 的独立重放；未打开窗口。

    def test_refuses_partial_or_unvalidated_plan(self):
        layout = self.layout()
        with patch.object(app.candidate, 'solve', return_value={'status': 'partial', 'actions': []}):
            with self.assertRaisesRegex(ValueError, '完整路线'):
                app.build_plan(layout, b'image', 81)

    def test_wrong_live_level_stops_before_execution(self):
        execute_spec = importlib.util.spec_from_file_location('pig_nav_execute_level_test', ROOT / 'scripts/pig-nav-execute.py')
        execute = importlib.util.module_from_spec(execute_spec)
        execute_spec.loader.exec_module(execute)
        class Adapter:
            def capture(self): return np.zeros((942, 530, 3), dtype=np.uint8)
            def close(self): pass
        fake = SimpleNamespace(app=SimpleNamespace(player=SimpleNamespace(
            extract=SimpleNamespace(parse_window_id=lambda value: int(value, 16)), X11Adapter=lambda *_: Adapter())),
            run=lambda *_: self.fail('关卡不一致时不能执行点击'))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'plan.json').write_text('{"board":[74,205,391,602]}')
            (root / 'layout.json').write_text('{}')
            (root / 'image.png').write_bytes(b'image')
            argv = ['pig-nav-execute', '--plan', str(root / 'plan.json'), '--layout', str(root / 'layout.json'),
                    '--image', str(root / 'image.png'), '--level', '81', '--window-id', '0x123', '--output', str(root / 'execution')]
            with patch.object(sys, 'argv', argv), patch.object(execute, 'verify'), patch.object(execute, 'load_executor', return_value=fake), \
                 patch.object(execute.pig_ocr, 'inspect', return_value=({'title': {'recognized': {'value': 80}}}, [])):
                with self.assertRaises(SystemExit) as error:
                    execute.main()
            self.assertEqual(error.exception.code, 1)
        with self.assertRaisesRegex(ValueError, '底部道具'):
            execute.validate_board([0, 200, 530, 720], (942, 530, 3))

    def test_probe_records_before_after_and_rejects_stale_or_outside_board(self):
        probe_spec = importlib.util.spec_from_file_location('pig_nav_probe_test', ROOT / 'scripts/pig-nav-probe.py')
        probe = importlib.util.module_from_spec(probe_spec)
        probe_spec.loader.exec_module(probe)
        image = np.zeros((942, 530, 3), dtype=np.uint8)
        class Adapter:
            clicks = []
            def capture(self):
                result = image.copy()
                if self.clicks:
                    result[250:350, 100:200] = 255
                return result
            def click(self, point, size): self.clicks.append((point, size))
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(probe.pig_ocr, 'inspect', return_value=({'title': {'recognized': {'value': 81}}}, [])), \
             patch.object(probe.time, 'sleep'):
            adapter = Adapter()
            result = probe.probe(adapter, image, [74, 205, 392, 603], [120, 300], 81, Path(directory), '验证碰撞', '观察变化')
            self.assertEqual(result['status'], 'observed')
            self.assertEqual(adapter.clicks, [([120, 300], (530, 942))])
            self.assertTrue((Path(directory) / 'comparison.png').exists())
            with self.assertRaisesRegex(ValueError, '不在棋盘'):
                probe.check_target([74, 205, 392, 603], [120, 850], image.shape)
            self.assertFalse(probe.same_board(image, np.full_like(image, 255), [74, 205, 392, 603]))


if __name__ == '__main__':
    unittest.main()
