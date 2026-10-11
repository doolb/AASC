# TTS Provider 与播报配置

## 需求与范围

2026-10-11 用户确认继续多 Provider 方案。在现有 system TTS 上增加 qwen-chat、qwen-api、doubao-api。AI 与 Agent 回复按来源聊天模板解析选择；文本媒体与系统播报分别有独立默认配置。群聊没有唯一模板时使用 AI 默认，临时会话使用当前角色模板。只扩展合成入口，保留音频 URL、目标选择、有序队列、回执和聊天打断。

模板可选择“继承系统 AI 默认”，或显式选择 Provider；未填音色时，仅在最终 Provider 与业务默认 Provider 相同时继承业务默认音色，否则使用最终 Provider 自身默认音色。避免跨 Provider 搬运音色 ID。qwen-chat 只允许 AI/Agent 回复，文本媒体、报时、自定义文字和系统提示拒绝使用。

## 配置与接口

业务选择存 `config.tts.aiReplyDefault/textMedia/systemBroadcast`；端点、模型、API凭证和默认音色/参数存用户配置 `tts.providers`；system不保存Provider级enabled/defaultVoice，qwen-chat不保存凭证或账号ID，模板仅保存 Provider/voice。Provider 默认关闭云端/网页能力，system 沿用旧开关与设备选择。空凭证输入保留旧值，显式清除单独处理。保存失败保持原权威配置。

控制端通过 `setTtsProviderConfig` 提交业务选择和 Provider 参数，服务端规范化并持久化，广播 `ttsProviderConfig` 脱敏权威值；初始化/重连补发当前状态，不新增 HTTP 配置接口。音色目录通过 `getTtsProviderVoices/ttsProviderVoices` 查询，失败不覆盖已选音色；已保存但目录不存在的 ID 保留并标注，最终有效性由合成接口判定。

## 生成

system 保留显示端优先/服务端回退；API Provider 调用对应端点，qwen-chat调用Chat2API语音服务，失败不切换 system。qwen-api 使用百炼非流式合成及音频 URL 下载；doubao-api 使用 V3 单向 HTTP 流、收集 base64 PCM 并包装 WAV；qwen-chat 通过Chat2API内部语音服务使用国内千问官方公开前端签名与 WebSocket 朗读流程。统一完整 WAV 进入既有内存缓存，不写临时音频文件。响应、超时、解码及音频大小有上限；不将凭证、响应原文或签名 URL 放入日志/广播。

Chat2API默认国内千问语音适配器需服务器具备 Puppeteer 可用的 Chrome，临时浏览器仅使用Chat2API调度的国内千问账号当前Cookie/ticket，不读取既有浏览器账户。加载官方首页并调用前端 doQwenAuth，获取 qwen_audio_asr 场景签名，发送文本/结束包，完整 PCM 转 WAV。默认模型 QUARK_VOICE、音色 zh_female_quarkF531S0_ptts。签名并发上限2，浏览器必在 finally 关闭；无 Chrome 的 Offline Node 需选择其他 Provider。网页版本变化可能使该适配器失效，需要明确报错后更新契约。

无新增生产依赖。服务端/网页修改只标记 `servicePackage=true`，既有 minApk 状态保留。真实云端鉴权、声音播放、长队列及设备体验需有对应账号现场验收。

system 音色沿用旧 tts.defaultVoice及原生显示端已加载音色；速度未保存Provider默认时沿用旧tts.defaultSpeed。显示端与 Qwen API 语速采用本地 PCM 重采样，会改变音高；豆包/国内千问使用生成参数。音量在入缓存前调整。Qwen API 单次600字符，沿用业务分句，单句超限明确失败。

## 系统原生路径与 Chat2API 统一语音（2026-10-11 已实现）

用户回复“是”确认本轮方案。系统原生移除Provider级enabled、默认音色ID和目录查询；业务及模板最终选择system时新音色ID无效，继续使用tts.device、tts.serverEnabled及既有原生音色配置。旧Provider开关/音色字段规范化时忽略，下次保存移除；旧生成接口显式传入的原生音色名称仍可用。

qwen-chat只调用Chat2API统一内部语音服务，不读账号库、不保存chat2apiAccountId，不再展示账号下拉框、刷新按钮、查询状态或安装Chrome文案。旧TTS账号桥接和候选WebSocket消息已移除。Chat2API内部调度国内qwen账号，复用当前账号/Provider启用状态、限额、健康状态与已保存的round-robin/fill-first/failover策略；凭证每次读取，ticket覆盖同名旧Cookie，不复制到TTS配置。只支持共享账号库，不自动扫描自定义rootDir。

新增Chat2API speech service及默认qwen speech adapter；runtime与聊天共用dataStore/providerRegistry/loadBalancer。代理运行时提供POST /v1/audio/speech，复用既有Bearer鉴权，返回完整audio/wav二进制；TTS内部调用不要求代理HTTP任务持续运行，也不启动第二个代理。输入模型qwen-chat/QUARK_VOICE/MINI_MAX，speed为0.25–4倍，volume为0–100，response_format只支持wav。合成总时限60秒、音频16MiB；无账号、停用、凭证缺失、签名失败和超时返回固定脱敏错误，不切换TTS Provider。

已核验官方SDK依赖DOM、iframe、AWSC指纹及令牌注册。浏览器签名实现归Chat2API语音内部，默认适配器仍需Chrome；迁移不是消除依赖，尚无验证通过的纯Node签名替代。隔离浏览器并发上限2、finally关闭，超时及迟到账号读取不继续签名。真实远端鉴权、音色权限及设备声音保留现场验收。

本机8081旧进程未下发新TTS配置，符合静态网页与旧运行后端不一致；已通过npm run restart:server重启，本机wss初始化确认新版ttsProviderConfig且无上述旧字段。静态页面隐藏标签的display冲突已修复，真实Chromium截图已查看。用户其他实例仍以实际部署版本为准；未构建或发布Offline包，servicePackage保持true。

## 参考

- [百炼 Qwen TTS API](https://help.aliyun.com/en/model-studio/qwen-tts-api)
- [豆包 V3 单向流式 HTTP](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)
- [国内千问用户指定页面](https://www.qianwen.com/chat/6ca4f1aa0292497095cb46e6ea45e08f)：2026-10-11 核对公开前端 4.9.6 的 doQwenAuth 与 `/api/v3/tts`，未读取私有会话内容。音色克隆的 synthesis_text 只生成采样文本，不能当作音频接口。
