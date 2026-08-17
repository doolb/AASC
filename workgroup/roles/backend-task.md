# 角色：backend-task

## 职责
- 后台任务引擎：远程 JS 执行、任务生命周期、沙箱、运行时（node/puppeteer）
- 内置任务注册与任务 IO

## 负责目录/文件
- src/apps/server/modules/task-engine/
- 对应 docs/spec/remote-task-system.md、docs/spec/task-system-draft-mode.md、docs/spec/test-echo.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
