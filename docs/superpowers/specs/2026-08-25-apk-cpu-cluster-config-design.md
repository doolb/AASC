# APK ASR/TTS 大小核混合配置设计

## 范围与目标

为 Android 显示端的原生 ASR/TTS 增加大小核混合配置和按核心总数的并发能力。服务器保存配置，控制端可分别设置 ASR 和 TTS 使用的大核数量、小核数量；APK 收到配置后自动识别设备 CPU 集群，建立对应数量的并发工作槽并绑定推理线程。

默认配置：

```json
{
  "asr": { "bigCoreCount": 1, "littleCoreCount": 1 },
  "tts": { "bigCoreCount": 1, "littleCoreCount": 1 }
}
```

本次不允许控制端填写具体 CPU 编号。APK 按 CPU 最大频率将在线 CPU 分为大核和小核，数量不足时按实际数量裁剪；总数量为 0 或配置非法时回退自动调度并发 1。

## 现状约束

- `NativeBridge` 当前分别使用 `asrExecutor`、`ttsExecutor` 两个单线程执行器，同类请求会排队。
- ASR sherpa-onnx 当前 `numThreads=1`，TTS Embedded Speech SDK 当前由单个生成任务驱动。
- 当前 display2 实测 CPU 0--3 为小核、CPU 4--7 为大核，但其他设备不能依赖固定编号。
- TTS 的大小核配置表达为“生成线程允许使用的 CPU 集合”；单个 TTS 生成任务不承诺同时占用所有允许核心。

## 配置契约

服务器新增 `cpuAffinity` 配置并持久化到 `config/config.json`：

```json
{
  "cpuAffinity": {
    "asr": { "bigCoreCount": 1, "littleCoreCount": 1 },
    "tts": { "bigCoreCount": 1, "littleCoreCount": 1 }
  }
}
```

新增接口：

- `GET /api/config/cpuAffinity`：返回规范化配置。
- `POST /api/config/cpuAffinity`：校验非负整数并保存；至少一个引擎配置总数大于 0 时接受；广播 `cpuAffinityChanged` 给控制端，并向显示端广播 `cpuConfig`。

显示端连接初始化时同时收到 `cpuConfig`，配置变更时再次收到。APK 桥新增：

```text
cpuConfigure({
  asr: { bigCoreCount, littleCoreCount },
  tts: { bigCoreCount, littleCoreCount }
}) -> { ok, asr, tts, topology } | { error }
```

## CPU 集群识别、绑定与并发槽

1. 读取 `/sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq` 和在线 CPU 列表。
2. 按最大频率分为低频集群（little）和高频集群（big）；只有一个频率层级时全部视为 little，并保留自动调度回退。
3. big 选择频率最高的前 `bigCoreCount` 个 CPU，little 选择频率最低的前 `littleCoreCount` 个 CPU。
4. 为每个引擎创建 `bigCoreCount + littleCoreCount` 个工作槽，每个槽绑定一个选中的 CPU；绑定失败只记录日志，不让语音功能失败。
5. 配置变更后，停止接收旧池新任务，等待旧任务结束，再创建新池；重建失败保留旧池并上报错误。
6. 每个并发槽内的单个 ASR/TTS 引擎使用一个推理线程，避免“并发请求数 × 每请求线程数”造成过量占核。

## 引擎行为

- ASR：并发槽数量为大核数+小核数，至少为 1；每个 `OfflineRecognizerConfig.modelConfig.numThreads=1`；每个识别槽拥有独立 recognizer/stream，识别工作线程和引擎加载线程应用 ASR affinity。
- TTS：并发槽数量为大核数+小核数，至少为 1；每个槽拥有独立 `SpeechSynthesizer`，避免当前单例锁把请求重新串行化；仍只生成 WAV，不在生成阶段播放。
- ASR/TTS 仍使用各自的 60 秒超时和独立执行器，配置功能不能改变已有异步协议。
- 同一引擎的并发上限等于该引擎配置的核心总数；超过上限的请求进入队列，不创建额外线程。

## 控制端交互

在现有 ASR/TTS 设备设置区域增加大小核数量控件：

- ASR：大核数量、小核数量。
- TTS：大核数量、小核数量。
- 默认均显示 1；保存后显示当前服务器配置和“等待显示端应用”状态。
- 控件最大值取服务器返回的已知拓扑；APK 上报实际拓扑后，控制端刷新可选上限。

## 异常与兼容

- 旧 APK 不认识 `cpuConfig` 时忽略该消息，ASR/TTS 保持原有调度。
- 非 Android 显示端只接收服务器配置，不执行 affinity。
- 服务器配置缺失时使用默认 `1+1`；旧配置迁移时不覆盖已有 `asr`、`tts` 字段。
- CPU 文件不可读、无 cpufreq 或 affinity 系统调用失败时使用 Android 默认调度，并上报诊断字段。

## 验收标准

- 默认配置可在服务器重启后保持为 ASR/TTS 各 `1 大核 + 1 小核`。
- 控制端修改任一引擎的大小核数量后，APK 收到配置且不需要重装 APK。
- ASR/TTS 生成和识别仍能成功，旧 APK/浏览器流程不受影响。
- display2 日志能够显示识别出的大小核列表、最终 affinity mask、配置来源和失败回退原因。
- Android unit tests、Node 配置协议测试、APK 构建和 display2 真机回归全部通过。
