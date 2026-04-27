# Auto-Brain 实现文档（伪代码）

## 1. 模块职责

```text
Input Layer:
    接收原始输入
    标准化为 SignalEvent
    补齐 traceId 和 timestamp

Fast Decision Layer:
    使用规则表匹配 SignalEvent
    输出 ExecutionAction
    若命中高风险场景, 仅允许白名单动作

Action Layer:
    对 ExecutionAction 做幂等检查
    执行动作
    记录执行结果和耗时

Tuning Layer:
    读取 OutcomeFeedback
    更新短期参数(threshold/cooldown/weight)
    输出 TuningSnapshot

Planning Layer:
    聚合近期反馈摘要
    调用外部大语言模型
    输出 StrategyDraft

Guard Layer:
    校验 StrategyDraft 结构和约束
    生成 StrategyProfile 新版本
    支持灰度发布和回滚

Monitor Layer:
    写入日志、指标、链路追踪
    触发告警条件判断
```

## 1.1 文件映射

```text
auto-brain/src/index.js
auto-brain/src/orchestration/behavior-orchestrator.js
auto-brain/src/adapters/aasc-bus-adapter.js
auto-brain/src/core/prototype-registry.js
auto-brain/src/contracts/signal-event.js
auto-brain/src/contracts/execution-action.js
auto-brain/src/contracts/outcome-feedback.js
auto-brain/src/contracts/strategy-draft.js
auto-brain/src/contracts/strategy-profile.js
auto-brain/src/input/input-normalizer.js
auto-brain/src/fast-decision/rule-table.js
auto-brain/src/fast-decision/fast-decision-engine.js
auto-brain/src/action/action-dispatcher.js
auto-brain/src/tuning/tuning-engine.js
auto-brain/src/planning/planning-adapter.js
auto-brain/src/guard/policy-validator.js
auto-brain/src/guard/policy-gate.js
auto-brain/src/monitor/metrics-recorder.js
```

## 2. 主流程伪代码

```text
过程 AutoBrainPipeline(input):
    signalEvent = InputLayer.normalize(input)

    fastAction = FastDecisionLayer.evaluate(signalEvent, activeStrategyProfile)
    executionResult = ActionLayer.commit(fastAction)

    feedback = OutcomeFeedback.from(executionResult)
    tuningSnapshot = TuningLayer.adjust(feedback)

    summary = PlanningLayer.buildSummary(tuningSnapshot, monitorMetrics)
    strategyDraft = PlanningLayer.propose(summary)

    gateResult = GuardLayer.review(strategyDraft)
    若 gateResult.passed:
        activeStrategyProfile = GuardLayer.publish(gateResult.profile)

    MonitorLayer.record(signalEvent, fastAction, executionResult, gateResult)
    返回 executionResult
```

## 3. 原型注册扩展点

```text
PrototypeRegistry.register('fast.rule.overheat', handler)
PrototypeRegistry.register('tuning.adjust.cooldown', handler)
PrototypeRegistry.register('planning.prompt.default', handler)
PrototypeRegistry.register('guard.validator.strategy', handler)

Orchestrator:
    按 key 读取 handler
    执行统一签名 handler(context)
    通过优先级链选择结果
```

## 4. 数据契约

```text
SignalEvent { id, source, signalType, payload, riskLevel, timestamp, traceId }
ExecutionAction { actionId, actionType, target, params, timeoutMs, idempotencyKey }
OutcomeFeedback { actionId, success, latencyMs, reward, reason, timestamp }
StrategyDraft { draftId, goal, constraints, ruleChanges, confidence, createdAt }
StrategyProfile { profileId, version, rules, limits, publishedAt, rollbackFrom }
```

## 5. 异常与回滚

```text
当 PlanningLayer 超时或失败:
    不影响 Fast Decision Layer 和 Action Layer
    记录 planning_degraded 指标

当 GuardLayer 校验失败:
    丢弃 StrategyDraft
    保持当前 activeStrategyProfile

当新版本 StrategyProfile 上线后收益下降超过阈值:
    GuardLayer.rollback(previousVersion)
    记录 rollback_event
```

## 6. 与 AASC 协作伪代码

```text
AASC 订阅主题 'autobrain.signal':
    调用 AutoBrainPipeline(payload)

Action Layer 执行后:
    通过 AASC 发布 'autobrain.action.result'

Guard Layer 发布新策略后:
    通过 AASC 发布 'autobrain.strategy.updated'
```

## 7. 多运行时伪代码

```text
启动 AutoBrain(runtimeId):
    调用 AASC.registerRuntime(runtimeId, { deviceId, metadata })
    订阅 autobrain.{runtimeId}.signal

收到 signal:
    执行 AutoBrainPipeline(payload)
    发布 autobrain.{runtimeId}.action.result

策略更新:
    发布 autobrain.{runtimeId}.strategy.updated

停止 AutoBrain(runtimeId):
    调用 AASC.unregisterRuntime(runtimeId)
```

## 8. 跨设备消息伪代码

```text
发送到目标运行时:
    AASC.publishRuntime(currentRuntimeId, 'signal', payload, {
        targetRuntimeId: targetRuntimeId
    })

发送到目标设备:
    AASC.publishRuntime(currentRuntimeId, 'signal', payload, {
        targetDeviceId: targetDeviceId
    })

广播到多个设备:
    AASC.publishRuntime(currentRuntimeId, 'health', payload, {
        broadcastDevices: ['device-a', 'device-b']
    })
```
