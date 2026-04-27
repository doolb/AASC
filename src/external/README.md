# External Layer

外部服务层用于封装外部能力：

- LLM
- TTS
- ASR
- 第三方 API

约束：

- 不直接持有业务流程状态
- 通过统一接口被 App 层调用

当前迁移状态（第二步）：

- `src/external/asr/asr-service.js`：已承接 ASR 实现体
- `src/external/tts/tts-service.js`：已承接 TTS 实现体
- `src/external/llm/llm-service.js`：已承接 LLM 实现体
- `core/asr.js`、`core/tts.js`、`core/chat.js`：保留兼容转发层
