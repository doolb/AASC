import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/extract-pig-level.py'
SPEC = importlib.util.spec_from_file_location('pig_extract', SCRIPT)
extract = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extract)
REFERENCES = ROOT / 'docs/references/pig-game'


class PigExtractorTest(unittest.TestCase):
    def test_red_highlight_unique_association(self):
        image = np.full((120, 120, 3), 220, np.uint8)
        pigs = [{'bbox': [20, 20, 20, 40]}, {'bbox': [50, 20, 20, 40]}]
        cv2.rectangle(image, (17, 17), (43, 63), (0, 0, 255), 2)
        extract.mark_red_highlight(image, pigs, 1)
        self.assertTrue(pigs[0]['highlighted_clickable'])
        self.assertFalse(pigs[1]['highlighted_clickable'])
        cv2.rectangle(image, (47, 17), (73, 63), (0, 0, 255), 2)
        extract.mark_red_highlight(image, pigs, 1)
        self.assertFalse(any(pig['highlighted_clickable'] for pig in pigs))

    def test_eight_direction_candidate_scores(self):
        for index, name in enumerate(extract.DIRECTIONS):
            angle = math.radians(index * 45)
            axis = np.array([math.cos(angle), math.sin(angle)])
            scores = extract.direction_candidate_scores(axis, 12, 1)
            self.assertEqual(max(scores, key=scores.get), name)
            self.assertEqual(len(scores), 8)
        self.assertTrue(all(score == 0 for score in extract.direction_candidate_scores(np.array([1, 0]), 0, 0).values()))

    def test_estimated_blocking_box_uses_grid_not_visual_bounds(self):
        pigs = [{'id': 1, 'center': [130, 200], 'bbox': [104, 190, 52, 20],
                 'visual_bbox': [100, 184, 60, 32], 'direction': 'east', 'length': 3}]
        extract.apply_grid(pigs, (100, 200, 30, 5, 5), [])
        self.assertEqual(pigs[0]['blocking_bbox'], [85, 185, 90, 30])
        self.assertEqual(pigs[0]['blocking_bbox_source'], 'estimated_grid_occupancy')
        pigs[0]['direction'] = 'unknown'
        extract.apply_grid(pigs, (100, 200, 30, 5, 5), [])
        self.assertIsNone(pigs[0]['blocking_bbox'])

    def image(self, name):
        image = cv2.imread(str(REFERENCES / name))
        self.assertIsNotNone(image)
        return image

    def test_reference_counts_and_directions(self):
        for name, count in [('level-01-initial.png', 6), ('level-02-initial.png', 61), ('level-02-after-shuffle.png', 40)]:
            with self.subTest(name=name):
                pigs, _, _ = extract.identify(self.image(name))
                self.assertEqual(len(pigs), count)
        pigs, _, _ = extract.identify(self.image('level-02-initial.png'))
        for pig in pigs:
            x, y, w, h = pig['bbox']
            vx, vy, vw, vh = pig['visual_bbox']
            self.assertLessEqual(vx, x)
            self.assertLessEqual(vy, y)
            self.assertGreaterEqual(vx + vw, x + w)
            self.assertGreaterEqual(vy + vh, y + h)
        for x, y, direction in [(243.5, 300.5, 'east'), (136.5, 314, 'north'), (106, 315.5, 'south'), (418, 330.5, 'west')]:
            pig = min(pigs, key=lambda p: (p['center'][0] - x) ** 2 + (p['center'][1] - y) ** 2)
            self.assertEqual(pig['direction'], direction)
        pigs, _, warnings = extract.identify(self.image('level-01-initial.png'))
        self.assertTrue(any(p['direction'] == 'unknown' for p in pigs))
        self.assertTrue(any('不明确' in warning for warning in warnings))

    def test_title_and_wrong_window(self):
        extract.verify_game_window(self.image('level-02-initial.png'))
        with self.assertRaises(ValueError):
            extract.verify_game_window(np.full((941, 529, 3), 255, np.uint8))

    def test_gesture_and_overlay(self):
        image = self.image('level-01-initial.png')
        board = extract.valid_board(image, None)
        gestures = extract.find_gesture(image, board)
        self.assertEqual(len(gestures), 1)
        x, y, width, height = gestures[0]
        self.assertTrue(x <= 318 <= x + width and y <= 428 <= y + height)
        pigs, _, warnings = extract.identify(image, board, gestures)
        affected = [pig for pig in pigs if pig['gesture_occluded']]
        self.assertEqual(len(affected), 1)
        self.assertEqual(affected[0]['direction'], 'unknown')
        self.assertTrue(any('手指' in warning for warning in warnings))
        overlay = extract.annotate(image, pigs, board, gestures)
        self.assertGreater(overlay.shape[1], image.shape[1])
        self.assertTrue(np.any(overlay[:, image.shape[1]:] < 200))
        scaled = cv2.resize(image, None, fx=0.75, fy=0.75)
        self.assertEqual(len(extract.find_gesture(scaled, extract.valid_board(scaled, None))), 1)
        second = self.image('level-02-initial.png')
        self.assertEqual(extract.find_gesture(second, extract.valid_board(second, None)), [])

    def test_red_highlight_does_not_become_eye_features(self):
        image = self.image('play-runs/level-04-color-arrows/original.png')
        pigs, _, _ = extract.identify(image, (74, 205, 391, 602))
        for x, y in [(422, 390), (419, 450)]:
            pig = min(pigs, key=lambda item: (item['center'][0] - x) ** 2 + (item['center'][1] - y) ** 2)
            self.assertEqual(pig['direction'], 'east')

    def test_direction_colors_are_drawn_with_matching_legend(self):
        self.assertEqual(set(extract.DIRECTION_COLORS), set(extract.DIRECTIONS))
        self.assertEqual(len(set(extract.DIRECTION_COLORS.values())), 8)
        image = np.full((200, 200, 3), 245, np.uint8)
        pig = {'id': 1, 'bbox': [35, 40, 30, 20], 'center': [50, 50],
               'direction': 'east', 'direction_degrees': 0}
        overlay = extract.annotate(image, [pig], (0, 0, 199, 199), [])
        color = extract.DIRECTION_COLORS['east']
        self.assertEqual(tuple(int(v) for v in overlay[50, 55]), color)
        self.assertEqual(tuple(int(v) for v in overlay[20, 212]), color)
        unknown = dict(pig, direction='unknown', direction_degrees=None)
        overlay_unknown = extract.annotate(image, [unknown], (0, 0, 199, 199), [])
        self.assertEqual(tuple(int(v) for v in overlay_unknown[50, 55]), (245, 245, 245))

    def test_empty_and_invalid_board(self):
        pigs, _, warnings = extract.identify(np.zeros((941, 529, 3), np.uint8))
        self.assertEqual(pigs, [])
        self.assertTrue(any('没有识别' in warning for warning in warnings))
        with self.assertRaises(ValueError):
            extract.identify(self.image('level-02-initial.png'), (500, 900, 100, 100))

    def test_cli_outputs_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'level'
            command = [sys.executable, str(SCRIPT), '--level', '2', '--image', str(REFERENCES / 'level-02-initial.png'), '--output', str(output), '--grid', '104,299,29.85,12,15']
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            raw = (output / 'level.json').read_bytes()
            data = json.loads(raw)
            self.assertEqual(data['count'], 61)
            self.assertEqual(data['status'], 'candidates_unverified')
            self.assertEqual(data['original_sha256'], hashlib.sha256((output / 'original.png').read_bytes()).hexdigest())
            self.assertTrue((output / 'annotated.png').exists())
            self.assertEqual(data['gesture_candidates'], [])
            self.assertTrue(all(pig['grid'] is not None for pig in data['pigs']))
            self.assertFalse(any('重叠' in warning for warning in data['warnings']))
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual((output / 'level.json').read_bytes(), raw)

    def test_live_requires_explicit_window(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--level', '1', '--display', ':1'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--window-id', result.stderr)
        with self.assertRaises(Exception):
            extract.parse_window_id('0')


if __name__ == '__main__':
    unittest.main()
