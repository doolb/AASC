# 角色：chat

## 职责
- 聊天系统：群聊/私聊、AI 助手、系统指令、语音播报
- 聊天会话数据、LLM 聊天任务、聊天前端与后端逻辑

## 负责目录/文件
- src/apps/web-mediacenter/ui/public/js/chat.js、css/chat.css
- src/core/data-snapshot/ChatSessionData.js、ChatCommandsData.js
- src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js
- res/tasks/llm.chat/
- 对应 docs/spec/chat-system.md、docs/spec/private-chat-sessions.md、docs/spec/websocket.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
