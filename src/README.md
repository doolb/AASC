# Source Layout

本目录用于承载新的分层结构，按 Core / Framework / External / App 组织。

- `core/`：通用模型、契约、工具，不包含具体业务流程
- `framework/`：基础设施能力（消息总线、传输、存储、观测）
- `external/`：外部能力封装（LLM、TTS、ASR、媒体提供者）
- `apps/`：具体应用程序（业务规则、页面、编排）
  - `web-mediacenter/`
  - `server/`

当前项目采用渐进式迁移，旧目录暂时保留，避免一次性重构风险。
