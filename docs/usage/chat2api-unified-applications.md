# Chat2API 统一文字与四路语音（2026-10-13）

当前首批支持既有文字聊天和TTS。四个对外来源名为qwen、qwen-api、doubao、doubaapi；旧qwen-chat/doubao-api/doubao-chat业务选择及内部doubaochat账户ID保持兼容。图片/音频/视频输入与图像/视频输出未接入，明确报错，不静默转成文字。

## 未配置映射或账号选择

设置页显示内置默认映射：DeepSeek六条模式别名、历史Qwen3.6-Flash→Qwen3.7、豆包doubao/doubao-think/doubao-expert。自定义精确/通配规则优先；可编辑默认行保存覆盖，删除自定义覆盖会恢复默认。无需先手动添加映射才能调用这些名字；Qwen历史别名仅沿用本项目设置，不代表上游模型发布承诺。

没有指定账号时使用当前启用、有凭据的已保存账号，默认私人目录可一次性复用原~/.chat2api/data.json中的缺失Provider资料；不覆盖已有账号或复活已删除账号。登录资料缺失或失效时仍需要登录，release和数据修复包不包含账号凭据。现有导入账号流程继续支持手动预览与确认。

Chat2API映射里的音色/语速等是调用该模型的默认参数；声纹里的“语音服务和音色”决定AI回复、文本阅读、系统播报分别使用的服务。显式业务/模板音色优先于映射默认，再使用服务默认；不是按声纹识别出的说话人自动选择音色。

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

speed倍率0.25–4，volume=0–100，只接受WAV。Qwen API每句600 Unicode字符；网页豆包固定默认音色/1倍速/100音量、最多1000 UTF-16字符且4000 UTF-8字节，自动识别doubaochat并选择已登录可用账号，无需手动映射；显式指定仍优先且不可退选。音频16MiB，总60秒覆盖规划/调度/合成/下载/解码，断连取消。业务层保留分句、模板、缓存、队列、Range和播放事件；system原生路径保持。

本轮未重启服务、未迁移真实凭据、未发送真实请求或出包。需要由用户安排运行实例加载最新服务后配置账号，再进行真实账号/设备验收。源码离线验证通过不表示当前主服务器已加载这些功能。

## Android外部登录与未验证账号（2026-10-14）

在Android控制端账号添加表单选择网页Provider，点击“打开Android登录页”。所有10个内置网页Provider使用隔离网页，顶部显示“完成”“取消”；登录凭据齐全后会自动返回并保存，也可点击完成立即捕获。缺少字段时完成会提示并保留网页；取消返回控制端且不保存。账号列表的“打开外部网页”同样提供完成/取消，完成只结束浏览，不更新账号。

豆包从官方网页捕获所需登录/CSRF Cookie后保存；手动填写合法Cookie也可添加。两种添加方式在格式校验后尝试一次只读会话列表请求，最多15秒，不翻页、不取消息、不重试。通过已知响应结构时显示“会话列表已验证”；403、登录失效、超时或未知结构仍保存账号并显示未验证及固定原因。这个状态仅表示列表访问，不证明聊天或TTS可用。导入/换凭据重置为未验证，导入不发请求；已有账号点击“验证登录”可按当前凭据复验，失败撤销旧成功状态。其他Provider沿用既有校验；API Key类继续只检查格式。

登录配套已发布min41/code76到内外网；Note8已更新并核对按钮和取消返回。实际登录完成后请核对账号是否入库及验证状态，所有Provider真实登录尚未逐一验收。本次修复网页原生回调变量遮蔽，接入列表验证和复验；需要运行实例加载最新服务/网页代码。本次未改原生APK、未出包、未重启主服务器；Android真机保存及官网响应契约仍需验收。
