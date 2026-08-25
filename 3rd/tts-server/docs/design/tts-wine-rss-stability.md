# Wine TTS SDK RSS 稳定性设计

## 背景

100 字固定文本的 100 次 HTTP 长稳压测中，Wine TTS 进程树 RSS 从约 270MB 增至约 430MB。队列已归零且请求全部成功，因此需要区分 Node 队列保留、Wine worker 句柄生命周期和 Embedded Speech SDK 原生分配器缓存。

## 目标

- 复现并量化 worker 直接请求和 HTTP 请求两条链路的 RSS 增长。
- 验证同一 voice 的 synthesizer 句柄复用是否降低增长；如果 SDK 在常驻句柄上继续累积，则不采用该方案。
- 对每请求创建/释放句柄的 worker 增加请求数上限，达到上限后在当前 HTTP 任务完成后重启进程，硬隔离 SDK native allocator。
- 保持 `/api/tts`、WAV 输出和现有 FIFO 调度协议不变。

## 方案

1. 增加固定 100 Unicode 字符的 worker RSS 回归测试，串行发送合成请求并采集 worker 进程树 RSS。
2. 保持 C++ worker 每请求释放 `SPXRESULTHANDLE` 与 `SPXSYNTHHANDLE`；实测常驻 synthesizer 会使 30 次 RSS 增长约 78MB，故不复用。
3. Node worker 达到 `TTS_WINE_MAX_REQUESTS` 后停止接收新任务，等待当前 HTTP 任务完成，再重启 Wine 子进程；`runActive` 防止旧任务提前触发回收。
4. 重新执行 worker 内存回归、Node 集成测试和 100 次 HTTP 长稳压测，对比 ready/final/peak RSS，并保留 SDK 首次合成常驻内存作为残余风险。

## 验收标准

- 固定 100 字请求全部成功，队列和 busy worker 最终归零。
- worker 回归测试能够稳定发现修复前的增长，并在请求上限回收策略下通过。
- 报告前后 RSS、TPS、延迟分位数；若 SDK 首次合成后的常驻 footprint 仍存在，明确记录为 SDK/Wine allocator 风险，不宣称彻底消除泄漏。
