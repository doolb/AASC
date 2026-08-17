# 角色：android

## 职责
- Kotlin APK 工程：Android 显示端、资源监控、GPU Compute 桥、原生语音识别
- APK 自身资源监控、离屏 EGL compute、sherpa-onnx 原生加载

## 负责目录/文件
- src/apps/android-display/
- 对应 docs/spec/android-display.md、docs/spec/android-display-stats.md、docs/spec/android-compute-bridge.md、docs/spec/android-native-asr.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
