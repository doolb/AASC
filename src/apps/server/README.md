# Server App Layer

本目录用于承载“服务端”类型应用。

定位：

- 对外提供统一服务接口（可通过 HTTP / WebSocket / AASC 主题暴露能力）
- 聚合 External 层能力（LLM/TTS/ASR 等）并做应用级编排
- 不承载通用基础设施实现（基础设施应在 Framework 层）

建议子目录：

- `boot/`：应用启动装配
- `modules/`：业务模块
- `api/`：对外接口定义与处理
