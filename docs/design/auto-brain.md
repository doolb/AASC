# Auto-Brain 架构设计文档

## 概述

Auto-Brain 是独立于 AASC 的智能决策架构。AASC 在该方案中仅作为消息总线与事件分发基础设施，不承载决策分层本体。

## 1. 设计目标

1. 快速链路纯代码可运行，保证低延迟与可预测。
2. 规划链路可接入大语言模型，但不直接控制执行。
3. 策略更新必须可审计、可灰度、可回滚。

## 2. 分层定义（通俗命名）

| 层 | 英文名 | 核心职责 | 运行约束 |
|----|--------|----------|----------|
| 输入层 | Input Layer | 采集与标准化输入，补齐上下文 | 不做业务决策 |
| 快速判断层 | Fast Decision Layer | 纯代码低延迟决策，保证兜底动作 | 不依赖外部模型 |
| 执行层 | Action Layer | 执行动作，处理幂等、重试、超时 | 必须可追踪 |
| 调整层 | Tuning Layer | 基于反馈做短期参数调优 | 不越权修改核心安全规则 |
| 规划层 | Planning Layer | 外接 LLM 产出策略草案 | 仅建议，不直接执行 |
| 把关层 | Guard Layer | 校验、灰度、回滚、审计 | 策略发布唯一入口 |
| 监控层 | Monitor Layer | 指标、日志、链路追踪、告警 | 独立于业务流程 |

## 3. 总体结构

```text
SignalEvent
  -> Input Layer
  -> Fast Decision Layer
  -> Action Layer
  -> OutcomeFeedback
  -> Tuning Layer
  -> Planning Layer (LLM)
  -> Guard Layer
  -> StrategyProfile
```

## 4. AASC 接入边界

1. AASC 负责消息收发、订阅分发、节点通信。
2. Auto-Brain 负责分层决策与策略管理。
3. Auto-Brain 通过 AASC 主题订阅输入事件，通过 AASC 发布执行动作和策略变更事件。

## 4.1 多运行时模式

1. 每个 Auto-Brain 实例必须配置唯一 `runtimeId`。
2. 每个 Auto-Brain 实例可配置 `runtimeMetadata.deviceId` 标识所属设备。
3. 运行时消息使用 `autobrain.{runtimeId}.{channel}` 主题隔离。
4. 一个 AASC 实例可同时承载多个 Auto-Brain 运行时。

## 4.2 跨设备消息

1. Auto-Brain 通过 AASC `publishRuntime` 的 `targetDeviceId` 或 `targetRuntimeId` 实现跨设备消息路由。
2. Auto-Brain 不直接处理网络连接，跨设备传输由 AASC 的 device transport 管理。

## 5. 核心边界规则

1. 规划层输出必须经过把关层校验后才能发布。
2. 高风险动作仅允许快速判断层白名单动作直接执行。
3. 规划层不可绕过执行层直接触发外部动作。
4. 策略发布必须版本化，保留上一稳定版本。

## 6. 建议目录

```text
auto-brain/
  src/
    input/
    fast-decision/
    action/
    tuning/
    planning/
    guard/
    monitor/
    orchestration/
    contracts/
    core/
```
