# 第三方组件说明

本目录只保留网页推理所需的固定 WASM 运行资产，不安装或引入新的生产 npm 依赖。

## @siteed/sherpa-onnx.rn 1.3.1

- 来源：<https://github.com/deeeed/audiolab>
- npm 包：<https://www.npmjs.com/package/@siteed/sherpa-onnx.rn>
- 用途：Sherpa-ONNX Core、SenseVoice Offline ASR、Pyannote diarization、Speaker ID JavaScript 包装及组合 WASM runtime。
- 包许可证：MIT，见 `licenses/MIT.txt`。
- 本项目只复制 `wasm/` 下运行时必需的组合构建与功能包装；`sherpa-onnx-core.js` 仅移除上游文件中的行尾空格，逻辑未修改；其余 JS 与 WASM 保持原样。

## sherpa-onnx

- 上游：<https://github.com/k2-fsa/sherpa-onnx>
- 用途：组合 WASM 中的 ASR、声纹 embedding、speaker manager 与多人分段能力。
- 许可证：Apache License 2.0，见 `licenses/Apache-2.0.txt`。

本页只使用自托管静态 JS/WASM 文件。模型文件从 Apache `/mnt/aimodel/` 单独读取，不包含在该目录或网页构建产物内。
