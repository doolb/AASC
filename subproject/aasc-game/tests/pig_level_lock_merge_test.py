import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pig_lock_merge_test', ROOT / 'scripts/merge-pig-lock-stages.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class LockMergeTest(unittest.TestCase):
    def test_replays_unlock_and_requires_verified_victory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pig = lambda i, row: {'id': i, 'direction': 'west', 'center': [30, 30 + row * 20],
                                   'grid': {'col': 0, 'row': row, 'cells': [[0, row], [1, row]]}}
            layout = {'grid': [10, 10, 20, 4, 2], 'pigs': [pig(1, 0)],
                      'locks': [{'pig': pig(2, 1), 'unlock_after': 1}]}
            (root / 'layout.json').write_text(json.dumps(layout))
            image = np.zeros((100, 100, 3), dtype=np.uint8)
            cv2.imwrite(str(root / 'original.png'), image)
            first = {'status': 'confirmed', 'action': {'pig_id': 1, 'direction': 'west', 'from': [0, 0],
                                                        'to': None, 'exited': True, 'travel_cells': 0}}
            (root / 'first.json').write_text(json.dumps(first))
            stage = root / 'stage'; stage.mkdir()
            second = {'action': {'pig_id': 2, 'direction': 'west', 'from': [0, 1],
                                 'to': None, 'exited': True, 'travel_cells': 0}}
            (stage / 'action-001.json').write_text(json.dumps(second))
            (stage / 'result.json').write_text(json.dumps({'status': 'victory', 'confirmed': 1}))
            cv2.imwrite(str(stage / 'victory.png'), image)
            self.assertEqual(app.merge(root / 'layout.json', [('action', root / 'first.json'), ('stage', stage)], root / 'out'), 2)
            self.assertEqual(json.loads((root / 'out/solution-order.json').read_text())['status'], 'victory_verified')
            with self.assertRaisesRegex(ValueError, '锁定'):
                app.merge(root / 'layout.json', [('stage', stage)], root / 'bad')


if __name__ == '__main__':
    unittest.main()
