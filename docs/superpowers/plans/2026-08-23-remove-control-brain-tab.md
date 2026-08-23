# 移除控制端大脑页签实施计划

## 目标

移除控制端“日志大脑”页签及其专用前端资源。保留服务器端 `LogBrain`、日志诊断 API 和既有测试，避免影响后台日志采集与其他调用方。

## 实施范围

1. 从 `upload.html` 删除“大脑”导航入口、`panel-brain` 页面和 `log-brain-viewer.js` 脚本引用。
2. 从 `main.js` 删除日志大脑初始化、面板激活和摘要刷新钩子。
3. 从 `upload.css` 删除只服务于日志大脑页面的样式。
4. 删除不再被控制端加载的 `log-brain-viewer.js`。
5. 保留 `src/framework/observability/log-brain.js`、`src/apps/server/api/log-brain-api.js`、服务端装配和测试。
6. 同步设计、spec、任务、todo 和 changelog 文档。

## 验证

- 静态检查控制端不再引用 `brain` 页签、`LogBrainViewer` 或 `log-brain-viewer.js`。
- 检查服务端 `LogBrain` 和 API 引用仍然存在。
- 运行相关日志大脑测试与前端资源引用测试。
