# 任务系统草稿模式实现

## 任务描述
重构任务系统，所有实例从 `draft` 状态开始，消除 `autoRun` 概念，增加 `task:rerun` 支持已完成实例重置为草稿。

## Design 需求
详见 `docs/design/task-system-draft-mode.md`

## Spec 设计
### 后端变更
1. `task-manager.js` — submit() 始终返回 draft，新增 rerunInstance()，改造 runInstance() 直接执行
2. `web-socket-handler.js` — 新增 task:rerun 消息处理，移除 autoRun 相关逻辑

### 前端变更
1. `task-panel.js` — 状态图标增加 draft，提交按钮改为"保存草稿"，结果详情增加 rerun 按钮
2. 移除 autoRun 相关代码

## 受影响功能模块
- TaskManager 生命周期管理
- WebSocket 消息协议
- 前端任务面板 UI

## 自测用例
1. 提交任务 → 确认 status=draft，不执行
2. draft 状态下修改参数 → 确认保存
3. 运行 draft → 确认执行完成 → status=completed
4. rerun 已完成实例 → 确认回到 draft，参数保留
5. 服务类任务重启后自动恢复
6. 旧 created 数据兼容

## 兼容性测试
- 旧 index.json 中 status='created' 的数据 → `task:run` 仍可接受

## 风险评估
- 低风险：核心改动在后端状态机，前端适配主要在 UI 层面
- 注意：`task:submit` 返回值改变，前端所有 submit 调用需要确认不依赖旧行为

## 预计工时
- 后端代码：2h
- 前端适配：1h
- 测试验证：1h
