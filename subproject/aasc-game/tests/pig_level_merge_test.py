import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / 'docs/references/pig-game/play-runs'
spec = importlib.util.spec_from_file_location('pig_merge_test', ROOT / 'scripts/merge-pig-stages.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MergeTest(unittest.TestCase):
    def test_delayed_elephant_exit_requires_independent_evidence(self):
        stage_two = RUNS / 'level-21-unlock-20261113-085102-033013'
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            observation = json.loads((stage_two / 'object-action.json').read_text())
            observation['after'] = observation['before']
            path = base / 'object-action.json'
            path.write_text(json.dumps(observation))
            shutil.copyfile(stage_two / 'object-after.png', base / 'later.png')
            (base / 'object-reconciliation.json').write_text(json.dumps({'status': 'delayed_exit_confirmed',
                'initial_action': path.name, 'screenshot': 'later.png'}))
            events = [('stage', RUNS / 'level-21-unlock-20261113-084810-441430'),
                      ('object', RUNS / 'level-21-elephant-open-path-20261113/observation.json'),
                      ('stage', stage_two), ('object', path), ('stage', RUNS / 'level-21-run-20261113-085627-654622')]
            self.assertEqual(module.merge(events, base / 'out'), 102)
            (base / 'later.png').unlink()
            with self.assertRaisesRegex(ValueError, '离场复核'):
                module.merge(events, base / 'invalid')

    def test_reconciled_pending_action_is_counted_once(self):
        original = RUNS / 'level-21-unlock-20261113-084810-441430'
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / 'first'
            shutil.copytree(original, first)
            pending = json.loads((first / 'action-001.json').read_text())
            (first / 'result.json').write_text(json.dumps({'status': 'interrupted', 'confirmed': 0, 'pending_action': pending}))
            (first / 'reconciliation.json').write_text(json.dumps({'status': 'pending_action_confirmed', 'confirmed': 1}))
            events = [('stage', first), ('object', RUNS / 'level-21-elephant-open-path-20261113/observation.json'),
                      ('stage', RUNS / 'level-21-unlock-20261113-085102-033013'),
                      ('object', RUNS / 'level-21-unlock-20261113-085102-033013/object-action.json'),
                      ('stage', RUNS / 'level-21-run-20261113-085627-654622')]
            self.assertEqual(module.merge(events, Path(tmp) / 'out'), 102)
            (first / 'reconciliation.json').write_text(json.dumps({'status': 'pending_action_confirmed', 'confirmed': 2}))
            with self.assertRaisesRegex(ValueError, '核对记录'):
                module.merge(events, Path(tmp) / 'invalid')

    def test_real_level_21_stage_identity_and_elephant_steps(self):
        events = [
            ('stage', RUNS / 'level-21-unlock-20261113-084810-441430'),
            ('object', RUNS / 'level-21-elephant-open-path-20261113/observation.json'),
            ('stage', RUNS / 'level-21-unlock-20261113-085102-033013'),
            ('object', RUNS / 'level-21-unlock-20261113-085102-033013/object-action.json'),
            ('stage', RUNS / 'level-21-run-20261113-085627-654622'),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'out'
            self.assertEqual(module.merge(events, output), 102)
            result = json.loads((output / 'solution-order.json').read_text())
            self.assertEqual([i + 1 for i, item in enumerate(result['steps']) if item.get('kind') == 'elephant'], [2, 52])
            self.assertTrue((output / 'victory.png').exists())


if __name__ == '__main__':
    unittest.main()
