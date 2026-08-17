# 角色：observability

## 职责
- 可观测性：日志大脑（log-brain）、日志缓冲区（log-buffer）、系统监控、server TUI
- 结构化日志、筛选、CPU/内存监控、LLM 诊断上下文

## 负责目录/文件
- src/framework/observability/
- 对应 docs/design/log-brain.md、docs/spec/log-brain.md、docs/spec/log-viewer.md、docs/spec/tui.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
