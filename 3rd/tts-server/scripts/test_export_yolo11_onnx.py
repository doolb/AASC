import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("export-yolo11-onnx.py")


def load_export_module():
    spec = importlib.util.spec_from_file_location("export_yolo11_onnx", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ExportYolo11OnnxTest(unittest.TestCase):
    """模型导出脚本的输入校验测试。"""

    def test_selected_model_only_requires_selected_weight(self):
        module = load_export_module()
        with tempfile.TemporaryDirectory(prefix="yolo11-export-test-") as directory:
            source = Path(directory) / "yolo11n.pt"
            source.write_bytes(b"pt")

            sources = module.validate_sources(Path(directory), ("yolo11n",))

        self.assertEqual((source,), sources)

    def test_missing_model_reports_exact_filename(self):
        with tempfile.TemporaryDirectory(prefix="yolo11-export-test-") as directory:
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--input-dir",
                    directory,
                    "--output-dir",
                    directory,
                ],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("yolo11n.pt", result.stderr)

    def test_reuses_newer_onnx_without_loading_ultralytics(self):
        module = load_export_module()
        with tempfile.TemporaryDirectory(prefix="yolo11-export-test-") as directory:
            source = Path(directory) / "yolo11n.pt"
            output = Path(directory) / "generated"
            target = output / "yolo11n.onnx"
            source.write_bytes(b"pt")
            output.mkdir()
            target.write_bytes(b"existing-onnx")
            os.utime(target, (source.stat().st_atime + 10, source.stat().st_mtime + 10))

            def fail_if_called(_source):
                raise AssertionError("不应重新加载 ultralytics")

            reused = module.export_one(fail_if_called, source, output)
            reused_name = reused.name
            reused_content = reused.read_bytes()

        self.assertEqual("yolo11n.onnx", reused_name)
        self.assertEqual(reused_content, b"existing-onnx")

    def test_writes_model_class_names_to_sidecar_json(self):
        module = load_export_module()
        with tempfile.TemporaryDirectory(prefix="yolo11-export-test-") as directory:
            source = Path(directory) / "yolo11n.pt"
            output = Path(directory) / "generated"
            source.write_bytes(b"pt")

            class FakeModel:
                names = {0: "person", 1: "car", 32: "sports ball"}

            class FakeYolo:
                def __new__(cls, _source):
                    return FakeModel()

            labels = module.ensure_class_names(FakeYolo, source, output)
            payload = json.loads(labels.read_text(encoding="utf-8"))

        self.assertEqual("yolo11n", payload["model"])
        self.assertEqual("person", payload["names"][0])
        self.assertEqual("car", payload["names"][1])
        self.assertEqual("sports ball", payload["names"][32])

    def test_reuses_current_class_names_without_loading_model(self):
        module = load_export_module()
        with tempfile.TemporaryDirectory(prefix="yolo11-export-test-") as directory:
            source = Path(directory) / "yolo11n.pt"
            output = Path(directory) / "generated"
            source.write_bytes(b"pt")
            output.mkdir()
            labels = output / "yolo11n.classes.json"
            labels.write_text('{"model":"yolo11n","names":["person"]}', encoding="utf-8")
            os.utime(labels, (source.stat().st_atime + 10, source.stat().st_mtime + 10))

            def fail_if_called(_source):
                raise AssertionError("不应重新加载 ultralytics")

            reused = module.ensure_class_names(fail_if_called, source, output)

        self.assertEqual(labels, reused)


if __name__ == "__main__":
    unittest.main()
