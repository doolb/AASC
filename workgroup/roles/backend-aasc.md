# 角色：backend-aasc

## 职责
- AASC 消息系统：消息总线、执行者模型、能力继承、路由、中间件、代理
- 客户端/服务端信道与 WebSocket 系统级集成

## 负责目录/文件
- src/framework/aasc/
- 对应 docs/design/aasc.md、docs/spec/aasc.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
