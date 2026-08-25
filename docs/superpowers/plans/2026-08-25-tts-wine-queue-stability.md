# TTS Wine Queue Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Wine TTS 调度错误，并用固定 100 字文本验证请求、FIFO 队列、断连恢复、速度和 RSS 稳定性。

**Architecture:** Node 服务维护 FIFO 请求队列，`drain()` 为每项任务预留一个 ready/idle WineWorker，并把该实例显式传给处理函数。每个 WineWorker 只允许一个 SDK 请求在途；队列任务在出队前检查客户端状态，处理阶段使用 worker 请求超时和响应断连清理。

**Tech Stack:** Node.js、Express、Node `node:test`、Wine、Windows Embedded Speech worker。

**Spec:** `3rd/tts-server/docs/spec/tts-wine-queue-stability.md`

## Global Constraints

- 测试文本必须为 100 个 Unicode 字符。
- 服务端使用 `const/let`、async/await 和 try-catch，注释使用中文。
- 不改变 Wine worker 的协议格式和音频输出格式。
- 不在本次变更中改动 C++ SDK 句柄生命周期，先用长稳数据决定是否需要后续专项重构。

---

### Task 1: Add failing integration tests

**Files:**
- Create: `3rd/tts-server/tts-wine.test.js`

- [ ] 启动单 worker 测试服务并等待 `/api/tts/status` ready。
- [ ] 使用 100 字文本验证 `/api/voices` 和 `/api/tts` 成功返回。
- [ ] 使用两个 worker 并发提交 6 个 100 字请求，验证 FIFO 队列最终全部成功。
- [ ] 提交断连请求后验证后续正常请求成功，证明队列可恢复。
- [ ] 在当前实现上运行测试，确认因“没有可用的 Wine worker”失败。

### Task 2: Fix worker dispatch and queue lifecycle

**Files:**
- Modify: `3rd/tts-server/tts-wine.js`

- [ ] 将 `WineWorker.run(task)` 改为把当前 worker 传入 `handleTts/handleVoices`。
- [ ] 出队时清理排队计时器，任务进入处理阶段后只使用已预留 worker。
- [ ] 出队前跳过已断连响应，并在排队期间断连时移除任务。
- [ ] 增加队列长度上限和排队超时，返回结构化 503 错误。
- [ ] 保持 worker 单飞、请求超时重启和 `tts.js` 的 FIFO/固定并发语义。

### Task 3: Run performance and stability verification

**Files:**
- Modify: `3rd/tts-server/stress-test.js`
- Create: `3rd/tts-server/tts-wine-benchmark.js`

- [ ] 将压测文本模式增加固定 100 字文本，输出吞吐、P50/P95/P99。
- [ ] 运行并发 1、2、3 的速度测试及断连恢复测试。
- [ ] 运行至少 100 次 HTTP 常驻循环，采集 ready/final/peak RSS 和延迟；此前 100 次直接 worker 循环作为 SDK 基线。
- [ ] 记录 3 worker 空闲 RSS，避免把服务层基线与 SDK 句柄增长混在一起。

### Task 4: Synchronize project documents

**Files:**
- Modify: `3rd/tts-server/docs/design.md`
- Modify: `3rd/tts-server/docs/spec.md`
- Create: `3rd/tts-server/docs/design/tts-wine-queue-stability.md`
- Create: `3rd/tts-server/docs/spec/tts-wine-queue-stability.md`
- Create: `3rd/tts-server/docs/task/2026-08-25_tts-wine-队列与100字稳定性.md`
- Modify: `3rd/tts-server/docs/todo.md`
- Modify: `3rd/tts-server/changelog.md`

- [ ] 记录需求、伪代码、测试口径、结果和风险。
- [ ] 完成后从 todo 移除任务，并在 changelog 记录修复与测试数据。
