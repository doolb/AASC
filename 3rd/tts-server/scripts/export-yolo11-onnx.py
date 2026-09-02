#!/usr/bin/env python3
"""将本地五个 YOLO11 PyTorch 权重导出为 Android 使用的静态 ONNX 模型。"""

import argparse
import shutil
import sys
from pathlib import Path


MODEL_NAMES = ("yolo11n", "yolo11s", "yolo11m", "yolo11l", "yolo11x")
IMAGE_SIZE = 640


class ExportError(RuntimeError):
    """表示模型导出前置条件或导出过程失败。"""


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True, help="YOLO11 .pt 权重所在目录")
    parser.add_argument("--output-dir", type=Path, required=True, help="生成 ONNX 资产目录")
    parser.add_argument(
        "--models",
        nargs="+",
        choices=MODEL_NAMES,
        default=MODEL_NAMES,
        help="只导出的模型名称，默认导出全部五个模型",
    )
    return parser.parse_args()


def validate_sources(input_dir: Path, model_names: tuple[str, ...] = MODEL_NAMES) -> tuple[Path, ...]:
    sources = tuple(input_dir / f"{model_name}.pt" for model_name in model_names)
    missing = tuple(source for source in sources if not source.is_file())
    if missing:
        missing_text = ", ".join(str(path) for path in missing)
        raise ExportError(f"缺少 YOLO11 权重: {missing_text}")
    return sources


def load_yolo_class():
    try:
        from ultralytics import YOLO

        return YOLO
    except ImportError as error:
        raise ExportError(
            "当前 Python 环境没有安装 ultralytics，请先安装 ultralytics 和 PyTorch"
        ) from error


def export_one(yolo_class, source: Path, output_dir: Path) -> Path:
    target = output_dir / f"{source.stem}.onnx"
    temporary = output_dir / f"{source.stem}.onnx.tmp"
    output_dir.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size > 0 and target.stat().st_mtime >= source.stat().st_mtime:
        print(f"已复用 {target}")
        return target
    try:
        model = yolo_class(str(source))
        exported = model.export(
            format="onnx",
            imgsz=IMAGE_SIZE,
            dynamic=False,
            simplify=True,
            device="cpu",
        )
        exported_path = Path(str(exported))
        if not exported_path.is_file():
            raise ExportError(f"导出结果不存在: {exported_path}")
        shutil.copyfile(exported_path, temporary)
        if temporary.stat().st_size <= 0:
            raise ExportError(f"导出结果为空: {source.name}")
        temporary.replace(target)
        return target
    except ExportError:
        raise
    except Exception as error:
        raise ExportError(f"导出 {source.name} 失败: {error}") from error
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> int:
    arguments = parse_arguments()
    try:
        sources = validate_sources(arguments.input_dir, tuple(arguments.models))
        yolo_class = load_yolo_class()
        for source in sources:
            target = export_one(yolo_class, source, arguments.output_dir)
            print(f"已生成 {target}")
        return 0
    except ExportError as error:
        print(f"YOLO11 ONNX 导出失败: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
