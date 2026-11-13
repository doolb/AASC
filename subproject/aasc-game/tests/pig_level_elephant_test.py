import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / 'docs/references/pig-game/play-runs'
spec = importlib.util.spec_from_file_location('elephant_test', ROOT / 'scripts/play-pig-elephant.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class ElephantTest(unittest.TestCase):
    def test_incomplete_candidate_never_clicks(self):
        class Fake:
            def __init__(self): self.clicks = []
            def capture(self): raise AssertionError('不完整计划不能读取执行画面')
            def click(self, center, size): self.clicks.append(center)
        candidate = json.loads((RUNS / 'level-26-elephant-candidate.json').read_text())
        candidate['actions'].pop()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'candidate.json'
            path.write_text(json.dumps(candidate))
            fake = Fake()
            with self.assertRaises(ValueError):
                app.run(fake, 26, Path(tmp) / 'output', RUNS / 'level-26-elephant-model.json', path)
            self.assertFalse(fake.clicks)


if __name__ == '__main__':
    unittest.main()
