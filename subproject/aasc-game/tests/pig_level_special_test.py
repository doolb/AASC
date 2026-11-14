import importlib.util
from pathlib import Path
import unittest

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('special_auto_test', ROOT / 'scripts/auto-pig-levels.py')
auto = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auto)


class SpecialVisionTest(unittest.TestCase):
    def test_recorded_special_markers_and_directions(self):
        samples = {
            'level-41-complete-verified': [('scissors','north'),('scissors','north'),('scissors','north'),('rope','west')],
            'level-44-run-20261113-222839-048421': [('scissors','south'),('scissors','east'),('scissors','south'),('rope','east')],
            'level-45-run-20261113-224854-381427': [('scissors','north'),('scissors','south'),('scissors','south'),('rope','west'),('rope','north')],
            'level-46-run-20261113-225610-960656': [('scissors','east'),('scissors','south'),('scissors','south'),('rope','south')],
            'level-49-run-20261113-235610-908574': [('scissors','north'),('scissors','south'),('scissors','north'),('rope','east'),('rope','south')],
            'level-50-run-20261114-002402-782679': [('scissors','north'),('scissors','east'),('scissors','south'),('rope','east')],
        }
        tested = 0
        for name, expected in samples.items():
            path = ROOT / 'docs/references/pig-game/play-runs' / name / 'original.png'
            if not path.exists():
                continue
            tested += 1
            with self.subTest(level=name):
                image = cv2.imread(str(path))
                board = auto.player.extract.valid_board(image, None)
                detected = auto.special_vision.detect(image, board, auto.player.extract)
                self.assertCountEqual([(item['kind'], item['direction']) for item in detected], expected)
        if tested == 0:
            self.skipTest('本机关卡截图不可用')

    def test_empty_frame_rejected(self):
        image = np.zeros((942, 530, 3), np.uint8)
        with self.assertRaisesRegex(ValueError, '无法同时确认'):
            auto.special_vision.build_layout(image, (74, 205, 391, 602), auto.player.extract, auto.auto, auto.player)

    def test_split_scissors_handles_join_and_match_level_50_board(self):
        path = ROOT / 'docs/references/pig-game/play-runs/level-50-run-20261114-002402-782679/original.png'
        if not path.exists():
            self.skipTest('本地第 50 关样本不可用')
        image = cv2.imread(str(path))
        board = auto.player.extract.valid_board(image, None)
        data = auto.special_vision.build_layout(image, board, auto.player.extract, auto.auto, auto.player)
        self.assertEqual((len(data['pigs']), len(data['scissors']), len(data['ropes'])), (91, 3, 1))
        state, directions = auto.player.solver.prepare(data['pigs'], data['grid'][3], data['grid'][4])
        executor = auto.locked_candidate.locked_module()
        matched = executor.match_scissors_frame(image, board, data['pigs'], state, directions, data['grid'],
                                                set(data['scissors']), set(data['ropes']), [])
        self.assertEqual(len(matched), 91)

    def test_detected_layout_agrees_with_reviewed_positions_and_directions(self):
        import json
        tested = 0
        for name in ('level-44-run-20261113-222839-048421', 'level-46-run-20261113-225610-960656', 'level-49-run-20261113-235610-908574'):
            directory = ROOT / 'docs/references/pig-game/play-runs' / name
            if not (directory / 'rope-reviewed-layout.json').exists():
                continue
            tested += 1
            with self.subTest(level=name):
                reviewed = json.loads((directory / 'rope-reviewed-layout.json').read_text())
                image = cv2.imread(str(directory / 'original.png'))
                board = auto.player.extract.valid_board(image, None)
                found = auto.special_vision.build_layout(image, board, auto.player.extract, auto.auto, auto.player)
                def layout(data):
                    return {(pig['grid']['col'], pig['grid']['row'], pig['direction'],
                             'scissors' if pig['id'] in data['scissors'] else 'rope' if pig['id'] in data['ropes'] else 'normal')
                            for pig in data['pigs']}
                self.assertEqual(layout(found), layout(reviewed))
        if tested == 0:
            self.skipTest('本地人工复核布局不可用')


if __name__ == '__main__':
    unittest.main()
