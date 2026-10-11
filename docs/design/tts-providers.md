# TTS Provider 与播报配置

## 需求与范围

2026-10-11 用户确认继续多 Provider 方案。在现有 system TTS 上增加 qwen-chat、qwen-api、doubao-api。AI 与 Agent 回复按来源聊天模板解析选择；文本媒体与系统播报分别有独立默认配置。群聊没有唯一模板时使用 AI 默认，临时会话使用当前角色模板。只扩展合成入口，保留音频 URL、目标选择、有序队列、回执和聊天打断。

模板可选择“继承系统 AI 默认”，或显式选择 Provider；未填音色时，仅在最终 Provider 与业务默认 Provider 相同时继承业务默认音色，否则使用最终 Provider 自身默认音色。避免跨 Provider 搬运音色 ID。qwen-chat 只允许 AI/Agent 回复，文本媒体、报时、自定义文字和系统提示拒绝使用。

## 配置与接口

业务选择存 `config.tts.aiReplyDefault/textMedia/systemBroadcast`；端点、模型、凭证和默认音色/参数存用户配置 `tts.providers`，模板仅保存 Provider/voice。Provider 默认关闭云端/网页能力，system 沿用旧开关与设备选择。空凭证输入保留旧值，显式清除单独处理。保存失败保持原权威配置。

控制端通过 `setTtsProviderConfig` 提交业务选择和 Provider 参数，服务端规范化并持久化，广播 `ttsProviderConfig` 脱敏权威值；初始化/重连补发当前状态，不新增 HTTP 配置接口。音色目录通过 `getTtsProviderVoices/ttsProviderVoices` 查询，失败不覆盖已选音色；已保存但目录不存在的 ID 保留并标注，最终有效性由合成接口判定。

## 生成

system 保留显示端优先/服务端回退；三个其他 Provider 独立调用自己的端点，失败不切换 system。qwen-api 使用百炼非流式合成及音频 URL 下载；doubao-api 使用 V3 单向 HTTP 流、收集 base64 PCM 并包装 WAV；qwen-chat 使用国内千问官方公开前端签名与 WebSocket 朗读流程。统一完整 WAV 进入既有内存缓存，不写临时音频文件。响应、超时、解码及音频大小有上限；不将凭证、响应原文或签名 URL 放入日志/广播。

国内千问需服务器具备 Puppeteer 可用的 Chrome，临时浏览器仅使用用户明确配置的 Cookie 或登录 ticket，不读取既有浏览器账户。加载官方首页并调用前端 doQwenAuth，获取 qwen_audio_asr 场景签名，发送文本/结束包，完整 PCM 转 WAV。默认模型 QUARK_VOICE、音色 zh_female_quarkF531S0_ptts。签名并发上限2，浏览器必在 finally 关闭；无 Chrome 的 Offline Node 需选择其他 Provider。网页版本变化可能使该适配器失效，需要明确报错后更新契约。

无新增生产依赖。服务端/网页修改只标记 `servicePackage=true`，既有 minApk 状态保留。真实云端鉴权、声音播放、长队列及设备体验需有对应账号现场验收。

system 未保存 Provider 默认时沿用旧 tts.defaultVoice/defaultSpeed；原生显示端使用已加载音色。显示端与 Qwen API 语速采用本地 PCM 重采样，会改变音高；豆包/国内千问使用生成参数。音量在入缓存前调整。Qwen API 单次600字符，沿用业务分句，单句超限明确失败。

## 参考

- [百炼 Qwen TTS API](https://help.aliyun.com/en/model-studio/qwen-tts-api)
- [豆包 V3 单向流式 HTTP](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)
- [国内千问用户指定页面](https://www.qianwen.com/chat/6ca4f1aa0292497095cb46e6ea45e08f)：2026-10-11 核对公开前端 4.9.6 的 doQwenAuth 与 `/api/v3/tts`，未读取私有会话内容。音色克隆的 synthesis_text 只生成采样文本，不能当作音频接口。
