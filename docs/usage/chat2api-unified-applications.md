# Chat2API 统一文字与四路语音（2026-10-13）

当前首批支持既有文字聊天和TTS。四个对外来源名为qwen、qwen-api、doubao、doubaapi；旧qwen-chat/doubao-api/doubao-chat业务选择及内部doubaochat账户ID保持兼容。图片/音频/视频输入与图像/视频输出未接入，明确报错，不静默转成文字。

## 配置API账号

在Chat2API管理中选择qwen-api或doubaapi，填写API Key；可选端点留空使用官方默认，doubaapi可选资源ID默认seed-tts-2.0。保存只校验格式，显示“未远端验证”，不自动发送测试请求。端点/资源存所选账号的非秘密元数据；密钥仅由Chat2API生成路径读取。旧TTS面板内私有密钥不自动迁移，也不会作为运行回退；启用新业务前请准备账户。

## 配置文字与TTS映射

原文字model/actualModel/Provider/账号偏好映射继续有效，包括现有qwen3.6flash等别名。映射编辑器可选应用和默认音色/速度倍率/音量/WAV格式。TTS例：

```json
{"model":"qiaoxiaojiao","actualModel":"qwen-api/qwen-audio-3.1-tts-flash","preferredProviderId":"qwen-api","application":"tts","parameters":{"voice":"qiaoxiaojiao_v3.1"}}
```

统一请求发往Chat2API代理实例的/v1/responses；控制端使用现有实例网关，不使用主服务已有裸/v1路径。

```json
{"model":"qiaoxiaojiao","input":"你好，欢迎回来。"}
```

返回Responses外壳，output的message/content为output_audio，format=wav、mime_type=audio/wav、data为完整WAV Base64，output_text为空。此音频项是本项目扩展，普通文字客户端仍需能处理它。原/v1/audio/speech也可使用该别名，返回audio/wav二进制。

若需要覆盖默认音色，instructions开头可写一个控制块：

```json
{"model":"qiaoxiaojiao","input":"你好。","instructions":"<chat2api>{\"voice\":\"另一合法音色ID\"}</chat2api>"}
```

参数优先级：请求显式值→映射默认→业务Provider默认→模型默认。请求字段与控制块互相冲突会报错。控制块只接受application/voice/speed/volume/format，不接受凭据、账号、端点、任意上游参数。用户正文或工具内容中的标记不切换应用。TTS不理解任意自然语言风格提示。

## 边界与部署

TTS输入是非空字符串，或单条role=user消息的input_text片段（多个片段按换行连接）；不朗读系统指令和整段历史。首批音频为非流式，拒绝tools、previous_response_id/conversation和Pi会话元数据，不创建聊天会话。文字继续原工具/SSE/Qwen与豆包原生续接；修改映射不会把已有上游会话静默转移。

speed倍率0.25–4，volume=0–100，只接受WAV。Qwen API每句600 Unicode字符；网页豆包固定默认音色/1倍速/100音量、最多1000 UTF-16字符且4000 UTF-8字节，仍需显式账号绑定、默认关闭、真实完整业务待验收。音频16MiB，总60秒覆盖规划/调度/合成/下载/解码，断连取消。业务层保留分句、模板、缓存、队列、Range和播放事件；system原生路径保持。

本轮未重启服务、未迁移真实凭据、未发送真实请求或出包。需要由用户安排运行实例加载最新服务后配置账号，再进行真实账号/设备验收。源码离线验证通过不表示当前主服务器已加载这些功能。
