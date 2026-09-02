#!/usr/bin/env python3
"""将本地五个 YOLO11 PyTorch 权重导出为 Android 使用的静态 ONNX 模型。"""

import argparse
import json
import shutil
import sys
from pathlib import Path


MODEL_NAMES = ("yolo11n", "yolo11s", "yolo11m", "yolo11l", "yolo11x")
IMAGE_SIZE = 640


class ExportError(RuntimeError):
    """表示模型导出前置条件或导出过程失败。"""


def class_names_path(source: Path, output_dir: Path) -> Path:
    return output_dir / f"{source.stem}.classes.json"


def normalize_class_names(names) -> list[str]:
    if isinstance(names, dict):
        try:
            indexed_names = {int(index): str(name).strip() for index, name in names.items()}
        except (TypeError, ValueError) as error:
            raise ExportError("YOLO 模型类别名称索引无效") from error
        if not indexed_names or min(indexed_names) < 0:
            raise ExportError("YOLO 模型类别名称为空或索引无效")
        result = [""] * (max(indexed_names) + 1)
        for index, name in indexed_names.items():
            if not name:
                raise ExportError(f"YOLO 模型类别名称为空: {index}")
            result[index] = name
        return result
    if isinstance(names, (list, tuple)):
        result = [str(name).strip() for name in names]
        if not result or any(not name for name in result):
            raise ExportError("YOLO 模型类别名称为空")
        return result
    raise ExportError("YOLO 模型缺少可识别的类别名称")


def write_class_names(source: Path, output_dir: Path, names) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    target = class_names_path(source, output_dir)
    temporary = output_dir / f"{target.name}.tmp"
    payload = {
        "model": source.stem,
        "source": "Ultralytics model.names",
        "names": normalize_class_names(names),
    }
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)
    return target


def ensure_class_names(yolo_class, source: Path, output_dir: Path) -> Path:
    target = class_names_path(source, output_dir)
    if target.is_file() and target.stat().st_size > 0 and target.stat().st_mtime >= source.stat().st_mtime:
        return target
    model = yolo_class(str(source))
    return write_class_names(source, output_dir, model.names)


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
        write_class_names(source, output_dir, model.names)
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
            ensure_class_names(yolo_class, source, arguments.output_dir)
            print(f"已生成 {target}")
        return 0
    except ExportError as error:
        print(f"YOLO11 ONNX 导出失败: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
