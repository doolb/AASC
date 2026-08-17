# 角色：server-app

## 职责
- 服务端骨架装配：server-app.js 启动装配、API 层
- 服务端入口、模块挂载、API 路由集成

## 负责目录/文件
- src/apps/server/boot/server-app.js
- src/apps/server/api/
- 对应 docs/spec/api.md、docs/spec/sub-server.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
