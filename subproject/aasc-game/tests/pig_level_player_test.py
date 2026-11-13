import ctypes
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('pig_play', ROOT / 'scripts/play-pig-level.py')
play = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(play)
REFERENCES = ROOT / 'docs/references/pig-game'


class FakeWindow:
    def __init__(self, frames, output):
        self.frames = frames
        self.output = output
        self.clicks = []

    def capture(self):
        return self.frames[min(len(self.clicks), len(self.frames) - 1)].copy()

    def click(self, center, image_size):
        # 首次输入之前必须已有原图和候选记录。
        assert (self.output / 'step-000.png').exists()
        assert (self.output / 'state-000.json').exists()
        self.clicks.append(center)


class PigPlayerTest(unittest.TestCase):
    def test_highlight_does_not_override_unknown_direction(self):
        pig = {'id': 1, 'center': [20, 20], 'bbox': [15, 10, 10, 20], 'direction': 'unknown', 'highlighted_clickable': True}
        self.assertIsNone(play.choose_pig([pig], []))
        self.assertIsNone(play.choose_pig([pig], [(20, 20)]))

    def test_ximage_decoder_honors_row_padding_and_copies_pixels(self):
        data = (ctypes.c_ubyte * 24)(1, 2, 3, 0, 4, 5, 6, 0, 99, 99, 99, 99,
                                    7, 8, 9, 0, 10, 11, 12, 0, 99, 99, 99, 99)
        header = play.XImageHeader(width=2, height=2, xoffset=0, format=2, data=ctypes.addressof(data),
                                   byte_order=0, depth=24, bytes_per_line=12, bits_per_pixel=32,
                                   red_mask=0xff0000, green_mask=0xff00, blue_mask=0xff)
        frame = play.decode_ximage(header)
        self.assertEqual(frame.tolist(), [[[1, 2, 3], [4, 5, 6]], [[7, 8, 9], [10, 11, 12]]])
        data[0] = 0
        self.assertEqual(int(frame[0, 0, 0]), 1)
        header.bits_per_pixel = 24
        with self.assertRaises(ValueError):
            play.decode_ximage(header)

    def image(self, name):
        result = cv2.imread(str(REFERENCES / name))
        self.assertIsNotNone(result)
        return result

    def test_victory_detection(self):
        self.assertTrue(play.victory_visible(self.image('level-01-victory.png')))
        self.assertFalse(play.victory_visible(self.image('level-01-initial.png')))
        self.assertFalse(play.victory_visible(self.image('level-02-initial.png')))

    def test_blocker_and_candidate_order(self):
        self.assertTrue(play.intersects_ray((10, 10), (1, 0), [20, 5, 5, 10], 0))
        self.assertFalse(play.intersects_ray((10, 10), (-1, 0), [20, 5, 5, 10], 0))
        first = {'id': 1, 'center': [10, 10], 'bbox': [8, 8, 4, 4], 'direction': 'east'}
        second = {'id': 2, 'center': [25, 10], 'bbox': [23, 8, 4, 4], 'direction': 'east'}
        self.assertEqual(play.choose_pig([first, second], set())['id'], 2)
        self.assertIsNone(play.choose_pig([first, second], {(25, 10)}))
        self.assertIsNone(play.choose_pig([dict(first, direction='unknown')], set()))
        # 前方方向未知的小猪仍是障碍，动画使已尝试目标漂移也不能再次选择。
        self.assertIsNone(play.choose_pig([first, dict(second, direction='unknown')], set()))
        moved = dict(second, center=[27.0, 11.0])
        self.assertIsNone(play.choose_pig([moved], {(25, 10)}))

    def test_layout_tolerates_jitter_but_detects_direction_change(self):
        pig = {'id': 1, 'center': [10, 10], 'bbox': [8, 8, 12, 24], 'direction': 'east'}
        self.assertTrue(play.same_layout([pig], [dict(pig, center=[12, 11])]))
        self.assertFalse(play.same_layout([pig], [dict(pig, direction='west')]))
        self.assertFalse(play.same_layout([pig], []))
        result = play.reconcile_layout([dict(pig, direction='unknown')], [pig])
        self.assertEqual(result[0]['direction'], 'unknown')
        self.assertIsNone(play.choose_pig(result, set()))

    def test_first_level_manual_value_requires_exact_layout(self):
        image = self.image('level-01-initial.png')
        pigs, _, _ = play.extract.identify(image)
        play.use_recorded_manual_direction(1, image, pigs)
        matched = [pig for pig in pigs if pig.get('direction_source') == 'matched_manual_reference']
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]['direction'], 'north_west')
        pigs, _, _ = play.extract.identify(image)
        pigs[1]['center'][0] += 10
        play.use_recorded_manual_direction(1, image, pigs)
        self.assertTrue(any(pig['direction'] == 'unknown' for pig in pigs))

    def test_stop_on_victory_without_clicking_next(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'run'
            fake = FakeWindow([self.image('level-01-initial.png'), self.image('level-01-victory.png')], output)
            self.assertEqual(play.run_session(fake, output, 1, 5, 0), 'victory')
            self.assertEqual(len(fake.clicks), 1)
            result = json.loads((output / 'result.json').read_text())
            self.assertEqual(result['screenshot'], 'result.png')
            self.assertTrue((output / result['screenshot']).exists())
            self.assertEqual(json.loads((output / 'state-000.json').read_text())['state_kind'], 'observed_at_start')

    def test_unchanged_board_stops_without_repeating_forever(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'run'
            fake = FakeWindow([self.image('level-01-initial.png')], output)
            self.assertEqual(play.run_session(fake, output, 1, 2, 0), 'step_limit')
            self.assertEqual(len(fake.clicks), 2)
            self.assertNotEqual(fake.clicks[0], fake.clicks[1])

    def test_changed_screen_is_recorded_before_any_click(self):
        class ChangedWindow(FakeWindow):
            def capture(self):
                image = self.frames[0].copy()
                self.reads = getattr(self, 'reads', 0) + 1
                if self.reads > 1:
                    image[263:735, 74:465] = 0
                return image
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'run'
            fake = ChangedWindow([self.image('level-01-initial.png')], output)
            self.assertEqual(play.run_session(fake, output, 1, 5, 0), 'screen_changed')
            self.assertEqual(fake.clicks, [])
            self.assertTrue((output / 'result.png').exists())

    def test_recomputes_unblocked_pig_after_each_move(self):
        first = {'id': 1, 'center': [100, 300], 'bbox': [90, 290, 20, 20], 'direction': 'east'}
        second = {'id': 2, 'center': [150, 300], 'bbox': [140, 290, 20, 20], 'direction': 'east'}
        initial = self.image('level-01-initial.png')
        after = self.image('level-01-after-first-action.png')
        victory = self.image('level-01-victory.png')
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'run'
            fake = FakeWindow([initial, after, victory], output)
            detections = [([first, second], None, []), ([first, second], None, []),
                          ([first], None, []), ([first], None, [])]
            with patch.object(play.extract, 'identify', side_effect=detections):
                self.assertEqual(play.run_session(fake, output, 2, 5, 0), 'victory')
            self.assertEqual(fake.clicks, [[150, 300], [100, 300]])
            self.assertEqual(sorted(p.name for p in output.glob('*.png')), ['result.png', 'step-000.png'])

    def test_no_unblocked_candidate_is_stuck_without_clicking(self):
        first = {'id': 1, 'center': [100, 300], 'bbox': [90, 290, 20, 20], 'direction': 'east'}
        second = {'id': 2, 'center': [150, 300], 'bbox': [140, 290, 20, 20], 'direction': 'west'}
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'run'
            fake = FakeWindow([self.image('level-01-initial.png')], output)
            with patch.object(play.extract, 'identify', return_value=([first, second], None, [])):
                self.assertEqual(play.run_session(fake, output, 2, 5, 0), 'stuck')
            self.assertEqual(fake.clicks, [])
            self.assertTrue((output / 'result.png').exists())


if __name__ == '__main__':
    unittest.main()
