# Android ASR 测试网页实现文档（伪代码）

## 模型和 Worker 生命周期

```text
MODEL_ROOT := 页面配置，默认 location.origin + "/mnt/aimodel/"
ASR_FILES := [sensevoice/model.int8.onnx, sensevoice/tokens.txt]
VOICE_FILES := [voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx]
DIARIZATION_FILES := [voiceprint/pyannote_segmentation_3_0_int8.onnx]
VOICEPRINT_THRESHOLD := 0.5

页面启动:
  创建专用 Worker
  Worker 按顺序导入固定 Sherpa WASM loader、Core、Offline ASR、Diarization、Speaker ID 包装
  Worker 完成 WASM 初始化 -> 回传 runtime-ready
  页面并行 HEAD 检查基础模型 URL，渲染可访问状态；不触发大模型下载

加载模型(kind):
  如果 kind 模型已就绪 -> 返回
  如果 kind 正在加载 -> 复用同一 Promise
  按 ASR -> voiceprint -> diarization 依赖顺序加载 URL
  检查 HTTP 状态，写入 Emscripten FS 对应目录
  加载成功 -> 保存引擎句柄并报告 ready
  加载失败 -> 报告具体文件/HTTP错误；允许再次重试
```

## 音频输入和识别

```text
AudioBuffer -> 每通道等权下混单声道
sourceRate != 16000 -> 线性重采样为 16000 Hz
拒绝空音频、非有限样本或短于推理下限的输入
文件输入限定为可解码音频；麦克风通过 getUserMedia + AudioContext 采集
录音时收集 Float32 PCM；停止时生成本地 WAV Blob 和 object URL
切换输入/停止录音/页面关闭 -> 停止 MediaStream、关闭 AudioContext、撤销旧 URL

recognize(samples, languageMode):
  加载 ASR 模型
  OfflineRecognizer(modelConfig.senseVoice.model, tokens, languageMode, CPU, 1 thread)
  复用对应语言的 recognizer；若语言改变则释放旧 recognizer 并创建新实例
  从创建 stream 开始计时 -> acceptWaveform(16000, samples) -> decode -> read text/result
  返回解码阶段 ASR 耗时；模型下载/首次初始化由模型进度单独显示，不纳入该耗时
  释放一次性 stream
  中英过滤模式仅过滤模型返回文字，不改变声纹输入
```

## 临时声纹注册和单段测试

```text
SpeakerDatabase := Worker 生命周期内的 Map<name, Float32Array>
注册(name, samples):
  校验 trim 后名称非空、音频有效
  加载 base ERes2Net 模型并创建 embedding extractor
  输入 16 kHz PCM -> 完成 stream -> 提取 512 维 embedding
  Worker 内 manager.add(name, embedding)；同名时先删除旧条目
  回传内存注册列表；禁止写 localStorage、IndexedDB、服务器或正式声纹库

SHERPA_SINGLE(samples):
  embedding := extract(samples)
  (speaker, score) := manager.search(embedding, threshold=0.5)
  text := recognize(samples)
  返回 speaker/score/threshold/text 与 embeddingMs/asrMs/elapsedMs
```

## 多段声纹测试

```text
diarize(samples, speakerCount):
  speakerCount 为 AUTO 时传 -1；否则传 1..5
  使用 Pyannote INT8 分段 + base ERes2Net embedding + Sherpa clustering
  结果按 start 排序；相邻同 cluster 且无间隔片段合并

SHERPA_MULTI(samples):
  diarized := diarize(samples, speakerCount)
  对每个合并片段：截取 PCM -> 提取 embedding -> manager.search(0.5)
  依次尝试合并 <=0.8秒的未知片段和相邻注册说话人片段
  每次候选合并都重新提取 embedding；只有匹配回同一目标 speaker 才接受
  每个最终片段独立执行 ASR，保留重叠时间段和错误状态
  返回分段、说话人、相似度、文字和分阶段耗时

SHERPA_MULTI_FAST(samples):
  对 diarization 的每个 cluster 选最长片段作为代表，只提取/匹配一次
  将该 cluster 匹配结果赋给该 cluster 其它片段
  仍按合并后分段逐段执行 ASR

运行请求串行:
  任一页面推理开始 -> 禁用其他模型推理/注册按钮
  结束或失败 -> 清理临时 stream，恢复按钮和 Worker 忙闲状态
```

## 静态构建和验证

```text
npm run build:web:android-asr:
  清理仅限目标 web-dist
  复制网页源码与固定 vendor JS/WASM、许可文件
  校验必需文件存在/大小非零，并输出独立 Apache 可部署目录

npm run test:android-asr-web:
  检查默认模型根、四个模型相对路径与禁止访问业务上传 API
  检查临时 Map 不写持久存储、页面不包含流式 ASR UI/路由
  检查 WAV/PCM 重采样与多人同 cluster 合并、快速模式代表片段规则
  检查 vendor JS/WASM 和 license 进入构建输出
```
