#!/usr/bin/env python3
"""为三个 Sherpa 3D-Speaker embedding 模型生成静态 INT8 A/B 版本。"""

import argparse
import json
from pathlib import Path

import kaldi_native_fbank as knf
import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import (
    CalibrationDataReader,
    CalibrationMethod,
    QuantFormat,
    QuantType,
    quantize_static,
)
import soundfile as sf


MODEL_NAMES = (
    "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k",
    "3dspeaker_speech_eres2net_large_sv_zh-cn_3dspeaker_16k",
    "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common",
)
DEFAULT_WAVS = (
    "res/models/sensevoice/test_wavs/妲已妈妈.wav",
    "res/models/sensevoice/test_wavs/你好，小爱.wav",
    "res/models/sensevoice/test_wavs/你好啊你好啊你好啊.wav",
    "res/models/sensevoice/zh.wav",
)


def read_features(path: Path, sample_rate: int = 16000) -> np.ndarray:
    """使用与 Sherpa 3D-Speaker 示例相同的 80 维 Kaldi Fbank 前端。"""
    samples, actual_rate = sf.read(path, always_2d=False, dtype="float32")
    if actual_rate != sample_rate:
        raise ValueError(f"{path} 采样率为 {actual_rate}，需要 {sample_rate}")
    if samples.ndim != 1:
        samples = samples[:, 0]

    options = knf.FbankOptions()
    options.frame_opts.dither = 0
    options.frame_opts.samp_freq = sample_rate
    options.frame_opts.snip_edges = True
    options.mel_opts.num_bins = 80
    options.mel_opts.debug_mel = False
    fbank = knf.OnlineFbank(options)
    fbank.accept_waveform(sample_rate, samples)
    fbank.input_finished()
    features = np.stack(
        [fbank.get_frame(index) for index in range(fbank.num_frames_ready)],
        axis=0,
    ).astype(np.float32)
    # 三个模型的 metadata 都声明 global-mean，校准输入也必须走同一归一化。
    return features - features.mean(axis=0, keepdims=True)


class FeatureCalibrationReader(CalibrationDataReader):
    def __init__(self, features: list[np.ndarray], input_name: str):
        self._items = iter(features)
        self._input_name = input_name

    def get_next(self) -> dict[str, np.ndarray] | None:
        try:
            return {self._input_name: next(self._items)[None, :, :]}
        except StopIteration:
            return None


def cosine(left: np.ndarray, right: np.ndarray) -> float:
    denominator = np.linalg.norm(left) * np.linalg.norm(right)
    return float(np.dot(left, right) / denominator) if denominator else 0.0


def quantize_model(source: Path, target: Path, features: list[np.ndarray]) -> dict:
    session_options = ort.SessionOptions()
    session_options.inter_op_num_threads = 1
    session_options.intra_op_num_threads = 1
    source_session = ort.InferenceSession(str(source), sess_options=session_options, providers=["CPUExecutionProvider"])
    input_name = source_session.get_inputs()[0].name
    quantize_static(
        str(source),
        str(target),
        FeatureCalibrationReader(features, input_name),
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QInt8,
        weight_type=QuantType.QInt8,
        per_channel=True,
        calibrate_method=CalibrationMethod.MinMax,
        extra_options={"ActivationSymmetric": True, "WeightSymmetric": True},
    )
    quantized_session = ort.InferenceSession(str(target), sess_options=session_options, providers=["CPUExecutionProvider"])
    results = []
    for feature in features:
        input_value = feature[None, :, :]
        fp32 = source_session.run(None, {input_name: input_value})[0][0]
        int8 = quantized_session.run(None, {input_name: input_value})[0][0]
        results.append(
            {
                "cosine": cosine(fp32, int8),
                "fp32Norm": float(np.linalg.norm(fp32)),
                "int8Norm": float(np.linalg.norm(int8)),
            }
        )
    return {
        "source": str(source),
        "target": str(target),
        "sourceBytes": source.stat().st_size,
        "targetBytes": target.stat().st_size,
        "embeddingDim": int(source_session.get_outputs()[0].shape[-1]),
        "comparisons": results,
    }


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=root, help="AASC 根目录")
    parser.add_argument("--output-dir", type=Path, help="输出目录，默认使用 res/models/voiceprint")
    parser.add_argument("--wav", dest="wavs", action="append", type=Path, help="校准/验证 WAV，可重复指定")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    model_dir = (args.output_dir or root / "res/models/voiceprint").resolve()
    wavs = [
        path if path.is_absolute() else root / path
        for path in [Path(item) for item in (args.wavs or DEFAULT_WAVS)]
    ]
    for path in wavs:
        if not path.is_file():
            raise FileNotFoundError(path)
    features = [read_features(path) for path in wavs]
    reports = []
    for model_name in MODEL_NAMES:
        source = model_dir / f"{model_name}.onnx"
        target = model_dir / f"{model_name}_int8.onnx"
        if not source.is_file():
            raise FileNotFoundError(source)
        reports.append(quantize_model(source, target, features))
    print(json.dumps({"calibrationWavs": [str(path) for path in wavs], "models": reports}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
