# 网易云游戏广告时长导航包

目标由 `NeteaseCloudAdTime` 状态控制器执行，节点优先，仅在必要时对当前阶段相关区域进行 OCR。此包描述目标及交接点；通用导航链本身不执行广告闭环。运行方式和限制见子工程使用文档。

```navigation-json
{
  "metadata": { "id": "netease-cloud-ad-time", "name": "网易云游戏广告时长", "version": "2026.11.24" },
  "scenarios": [{ "id": "ad-time", "priority": 50 }],
  "goals": [{ "id": "claim-ad-time", "title": "领取广告时长", "kind": "ui", "delegate": "ui", "scenarioId": "ad-time", "flowId": "ad-time-runtime", "period": "daily" }],
  "states": [
    { "id": "mine", "uis": ["mine"], "topmost": "mine" },
    { "id": "ad", "uis": ["ad"], "topmost": "ad" },
    { "id": "reward", "uis": ["reward"], "topmost": "reward" },
    { "id": "limit", "uis": ["limit"], "topmost": "limit" }
  ],
  "flows": [{ "id": "ad-time-runtime", "scenarioId": "ad-time", "steps": [{ "id": "controller", "kind": "handoff", "action": { "action": "manual", "reason": "netease-ad-time-controller" } }] }]
}
```
