# Android 显示端原生声纹识别设计补充

## 外部模型加载

APK 下载的声纹模型保存在应用私有目录，并通过绝对路径传给 sherpa-onnx。`SpeakerEmbeddingExtractor` 和 `OfflineSpeakerDiarization` 构造时必须传入空 `AssetManager`，使 AAR 走文件系统加载分支；非空 `AssetManager` 只适用于 APK assets 中的资源。

## 验证目标

1. 启用服务器声纹配置时，APK 不因外部声纹模型加载失败而退出。
2. 使用已注册声纹和同一个测试 WAV 调用 `/api/asr/recognize`，返回识别文本及匹配的说话人。
3. 多人分段识别后，先按 pyannote 的 speakerIndex 合并相邻原始 PCM 片段，再做声纹匹配和 ASR，避免短分段边界截断文本。

## 验证记录（2026-08-19）

- 声纹模型通过 `AssetManager=null` 从 APK 私有目录加载，APK 保持在线。
- 注册 `3rd/ttslive/models/sensevoice/zh.wav` 为“测试声纹”。
- 使用同一个 WAV 调用 `/api/asr/recognize`，返回文本“开饭时间早上9点至下午5点。”，speaker 为“测试声纹”。
- 将 `zh.wav` 与 `en.wav` 按轮流说话方式串接为 12.744 秒测试音频；声纹门控只返回 zh 内容，en 段被过滤。
- 将两路 WAV 从同一时间点重叠混音为 7.152 秒音频；结果为“未识别到已注册声纹”，zh/en 均未返回，当前链路不会从重叠语音中强行输出误识别文本。
- 修复原始片段合并后：`zh.wav` 返回一段完整文本；串接 `zh.wav + en.wav` 只返回一段 zh 文本“开放时间早上9点至下午5点。”，en 未注册声纹片段被过滤。
