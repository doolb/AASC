# auto-brain

Auto-Brain 是独立决策架构，AASC 只作为消息总线使用。

支持在同一个 AASC 实例中并行运行多个 Auto-Brain 运行时，运行时通过 `runtimeId` 做主题隔离。

## 最小接入示例

```javascript
const { createAutoBrain } = require('./src');

const autoBrain = createAutoBrain({
  runtimeId: 'runtime-alpha',
  runtimeMetadata: { deviceId: 'device-alpha' },
  bus: aascBus,
  llmClient: {
    async proposeStrategy(summary) {
      return {
        goal: 'stability',
        constraints: { budget: 'safe' },
        ruleChanges: [],
        confidence: 0.8
      };
    }
  }
});

autoBrain.ruleTable.addRule({
  priority: 10,
  match: (signalEvent) => signalEvent.signalType === 'temperature',
  buildAction: () => ({
    actionType: 'cooldown',
    target: 'local',
    params: { level: 1 },
    timeoutMs: 500,
    idempotencyKey: `cooldown_${Date.now()}`
  })
});

autoBrain.actionDispatcher.registerHandler('cooldown', async () => ({ ok: true }));
autoBrain.orchestrator.bindSignalTopic('signal');

aascBus.publishRuntime('runtime-alpha', 'signal', { temp: 85 }, {
  targetDeviceId: 'device-beta'
});
```
