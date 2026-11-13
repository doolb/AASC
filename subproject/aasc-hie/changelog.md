# 变更日志

### 关卡任务与子工程

- ✅ [2026-11-13] 迁移 HIE、retop 与 remote-gamepad 至 AASC 子工程目录，保留 HIE 与 retop 仓库和修改，HIE 历史保留 remote-gamepad 原提交；旧 HIE 与 retop 路径提供兼容入口。
- ✅ [2026-11-13] 增加 game-task-bridge.js：读取猪关卡识别、计划和结果，向 NavigationGapQueue 上报卡关，显式启用后以固定脚本和参数数组运行；默认禁用实际执行。
  - 验证：`npm run build` 通过；桥接与原三层自主行为测试 7 项通过。

- ✅ [2026-11-13] 统一子工程 Git 根目录为 AASC；旧历史不要求纳入主仓库，现有文件及未提交内容保留。
