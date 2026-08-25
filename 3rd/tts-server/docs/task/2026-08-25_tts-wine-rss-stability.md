# 任务：调查 100 字长稳压测中的 Wine/Embedded Speech SDK RSS 增长

## 任务描述

处理 `3rd/tts-server/docs/todo.md` 中的 RSS 任务，确认增长来源并降低常驻 worker 的 native 句柄 churn。

## Design 需求

见 `docs/design/tts-wine-rss-stability.md`：复现 worker/HTTP 两条链路，比较 synthesizer 复用与进程回收，最终采用请求数上限回收。

## Spec 设计

见 `docs/spec/tts-wine-rss-stability.md`，包含句柄缓存和 RSS 回归测试伪代码。

## 受影响功能与代码

- `tts-wine.js`：worker 请求数上限、runActive 回收边界和状态字段。
- `wine/worker-memory.test.js`：固定 100 字 worker RSS 回归测试。
- `tts-wine-benchmark.js`、`tts-wine.test.js`：HTTP 性能和功能验证。

## 自测用例

1. worker READY 后连续处理 30 次固定 100 字请求，按 10 次回收，全部返回音频且 RSS 增量低于阈值。
2. `/api/voices`、单次 100 字 `/api/tts`、并发队列和断连恢复测试全部通过。
3. 100 次 HTTP 请求记录 TPS、延迟分位数和进程树 RSS。

## 兼容性测试

- Node.js + Wine + 已提交的 Embedded Speech SDK 模型与 worker binary。
- 保持原有 HTTP 路径、请求字段、FIFO 行为和 WAV 格式。

## 实际结果

- 修复前 30 次单 worker HTTP：RSS 增长 58164KB；常驻 synthesizer 实验增长 78640KB，确认句柄复用不适合该 SDK。
- 100 次 HTTP、3 worker/并发 3、`TTS_WINE_MAX_REQUESTS=10`：100/100 成功，TPS 0.541，平均 5510ms，P95 7201ms；ready 269752KB、peak 504620KB、final 418040KB、delta 148288KB。
- 严格每请求回收的 30 次诊断：30/30 成功，TPS 0.415，final RSS 比 ready 低 97376KB；说明进程边界可释放 native footprint，但频繁重启会增加延迟。
- 集成测试 3/3 通过；worker RSS 回归测试 1/1 通过。

## 性能测试

- worker 串行 30 次用于快速回归；HTTP 并发 3、100 次用于长稳对比。
- 记录 ready、peak、final RSS 以及 final-ready 增量。

## 风险评估

- SDK 首次合成后的 native footprint 仍会在当前 worker 中保留；默认每 10 次回收用于限制长期累积，若需要严格 RSS 上限可设置 `TTS_WINE_MAX_REQUESTS=1`，代价是重启延迟。
- 不同 voice 切换会触发句柄重建，不能假设跨 voice 共享 native 状态安全。

## 预计工时

约 1.5 小时，含实现、重建、压测和文档同步。
