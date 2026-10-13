# Android ASR 测试 APK 网页版

## 需求

将 `3rd/tts-server/android-asr` 测试 APK 的基础离线 ASR 与 Sherpa 声纹测试流程移到可由 Apache 静态托管的网页，便于浏览器直接使用同步到 Apache 的 `/mnt/aimodel/` 模型。页面独立于正式语音业务，不读写正式声纹库，也不把音频上传到 AASC 服务器。

网页支持 WAV 文件选择、浏览器麦克风录音、音频回放、SenseVoice 离线识别、临时声纹注册和 APK 已有的 Sherpa 单段/多段/快速多段测试，并显示识别/分段/embedding/总耗时。测试结果仅在当前 Worker 内存中存放；刷新页面即清空。

## 模型与运行边界

- 默认模型根目录为同源 Apache 路径 `/mnt/aimodel/`，用户可在页面更换根目录。跨源地址需要 Apache 允许 CORS。
- ASR 仅加载 `sensevoice/model.int8.onnx` 与 `sensevoice/tokens.txt`。
- 声纹单段仅加载 `voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`；多人模式再加载 `voiceprint/pyannote_segmentation_3_0_int8.onnx`。
- 复用 Sherpa Offline SenseVoice、ERes2Net embedding、SpeakerEmbeddingManager、Pyannote diarization 推理；音频在网页 Worker 中处理。
- 本期不接流式 ASR、不加载 GTCRN 降噪模型、不启用大型/INT8 声纹变体、不调用 `/api/asr/recognize` 或 `/api/voiceprint/register` 等业务接口。
- WASM 静态运行时固定使用经过验证的 `@siteed/sherpa-onnx.rn` 1.3.1 组合构建资产，仅分发运行所需的 JS/WASM 文件，并保留 Sherpa 与包的许可证及来源说明；不新增生产 npm 依赖。

## 交互流程

1. 页面初始化后，Worker/WASM 就绪时自动 HEAD 检查四个基础模型资源能否通过 Apache 访问；不下载模型。用户也可手动重查或修改模型根路径。
2. 选择 WAV 或允许麦克风权限后录音；将输入解码成 16 kHz 单声道 Float32 PCM，并保留 WAV 回放。
3. 按用户操作懒加载 ASR、声纹或多人分段所需模型，逐个请求，显示下载/初始化阶段与失败原因。
4. 注册时检查名称和音频有效性，提取 embedding 并存入 Worker 内的临时 manager；同名覆盖。不得写浏览器持久存储或正式服务端。
5. 单段测试对整段音频提取/匹配一次并执行 ASR；多人模式先聚类分段，再逐段提取声纹、匹配和识别；快速多人模式每个聚类只对最长片段匹配一次。
6. 显示模型状态、注册人名、相似度/阈值、说话人分段及各阶段耗时。停止录音、切换/删除测试音频和关闭页面时释放麦克风、音频对象 URL 与 Worker 资源。
7. ASR 显示的识别耗时只计算模型已就绪后的音频处理与解码；模型下载和首次初始化通过模型进度单独显示，不计入识别耗时。

## 兼容与限制

浏览器须支持 WebAssembly、Web Worker、AudioContext 和同源模型访问；麦克风需要 HTTPS 或 localhost。首次模型载入会下载约 270 MB 的基础 ONNX 文件并占用较多内存，页面应显示模型分项状态，不应并行下载/初始化全部模型。Apache 静态页与 `/mnt/aimodel/` 同源部署时无需新增后端 API；跨源部署由站点 CORS 策略决定。

页面生成到 `3rd/tts-server/android-asr/web-dist/`，由根目录 `npm run build:web:android-asr` 构建；`npm run test:android-asr-web` 运行页面契约、音频/分段算法和 WASM 资产检查。此功能只生成本地静态部署目录，本次不修改 Apache 站点、不上传网页、不构建或发布 APK。
