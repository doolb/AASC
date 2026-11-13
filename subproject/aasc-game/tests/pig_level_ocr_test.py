import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pig_ocr_tested', ROOT / 'scripts/pig_ocr.py')
ocr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ocr)


def response(text, score=0.99):
    return {'success': True, 'status': 'success', 'imageWidth': 100, 'imageHeight': 100,
            'boxes': [{'text': text, 'score': score, 'points': [[1, 1], [80, 1], [80, 50], [1, 50]]}]}


class OcrTest(unittest.TestCase):
    def test_confidence_ambiguity_and_coordinates(self):
        self.assertEqual(ocr.recognized_number(response('第40关'), 'title')['value'], 40)
        self.assertIsNone(ocr.recognized_number(response('30', 0.5), 'number'))
        ambiguous = response('30')
        ambiguous['boxes'].extend(response('31')['boxes'])
        self.assertIsNone(ocr.recognized_number(ambiguous, 'number'))
        outside = response('30')
        outside['boxes'][0]['points'][0] = [101, 1]
        self.assertIsNone(ocr.recognized_number(outside, 'number'))

    def test_local_crops_and_lock_conflict(self):
        image = np.full((942, 530, 3), 200, np.uint8)
        candidate = {'id': 2, 'bbox': [260, 720, 42, 43]}
        existing = dict(candidate, direction='north', unlock_exits=30)
        sizes = []
        def fake(crop, path, options):
            sizes.append(crop.shape[:2])
            return response('第40关' if len(sizes) == 1 else '30')
        with tempfile.TemporaryDirectory() as directory, patch.object(ocr, 'request_crop', side_effect=fake):
            record, locks = ocr.inspect(image, Path(directory), [candidate], [existing], {})
        self.assertEqual(sizes, [(48, 131), (59, 58)])
        self.assertEqual(record['title']['recognized']['value'], 40)
        self.assertEqual(locks[0]['unlock_exits'], 30)
        existing['unlock_exits'] = 29
        with tempfile.TemporaryDirectory() as directory, patch.object(ocr, 'request_crop', side_effect=[response('第40关'), response('30')]):
            _, locks = ocr.inspect(image, Path(directory), [candidate], [existing], {})
        self.assertNotIn('unlock_exits', locks[0])
        self.assertEqual(locks[0]['count_conflict'], {'template': 29, 'ocr': 30})

    def test_unavailable_falls_back_and_unknown_direction_stays_unknown(self):
        image = np.zeros((942, 530, 3), np.uint8)
        candidate = {'id': 3, 'bbox': [200, 400, 30, 40]}
        with tempfile.TemporaryDirectory() as directory, patch.object(ocr, 'request_crop', return_value={'status': 'error', 'message': 'offline'}):
            record, locks = ocr.inspect(image, Path(directory), [candidate], [], {})
        self.assertEqual(record['status'], 'unavailable')
        self.assertEqual(locks, [])
        with tempfile.TemporaryDirectory() as directory, patch.object(ocr, 'request_crop', side_effect=[response('第40关'), response('35')]):
            _, locks = ocr.inspect(image, Path(directory), [candidate], [], {})
        self.assertEqual(locks[0]['unlock_exits'], 35)
        self.assertNotIn('direction', locks[0])

    def test_conflicting_title_stops_before_input(self):
        runner_spec = importlib.util.spec_from_file_location('pig_runner_ocr_test', ROOT / 'scripts/auto-pig-levels.py')
        runner = importlib.util.module_from_spec(runner_spec)
        runner_spec.loader.exec_module(runner)
        image = np.zeros((942, 530, 3), np.uint8)
        adapter = Mock()
        summary = {'status': 'success', 'title': {'recognized': {'value': 41}}, 'locks': [], 'errors': []}
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(runner.auto, 'ui_state', return_value='unknown'), \
             patch.object(runner.player.extract, 'identify', return_value=([], None, [])), \
             patch.object(runner.auto, 'find_yellow_ducks', return_value=[]), \
             patch.object(runner.auto, 'find_locked_pigs', return_value=[]), \
             patch.object(runner.ocr, 'inspect', return_value=(summary, [])):
            output = Path(directory) / 'run'
            with self.assertRaisesRegex(ValueError, '不一致'):
                runner.run_level(adapter, output, 40, initial=image, ocr_options={})
            self.assertTrue((output / 'ocr/result.json').exists())
            self.assertTrue((output / 'result.json').exists())
            adapter.click.assert_not_called()


if __name__ == '__main__':
    unittest.main()
