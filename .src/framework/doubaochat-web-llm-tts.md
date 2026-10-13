#skill: ai-code-translation

# framework/doubaochat-web-llm-tts

## 已有声明

- Chat2API Provider 注册表、账号库、负载均衡、模型映射、文字聊天入口 // 沿用现有账号权限与 OpenAI 兼容响应
- Chat2API 语音服务、Qwen 网页语音适配器、WAV 校验、业务 TTS 注册表 // 保持已有千问和豆包 API 功能不变
- TTS 业务策略、AASC/WebSocket 权威配置、控制端语音设置与模板音色 // 新来源不新增独立 HTTP 配置接口
- 豆包参考项目网页聊天请求体、文字 SSE 解析、浏览器内请求选项 // 只借鉴已核对的文字协议，不把音乐生成当朗读

## 新增定义

- DoubaoWebChatProvider { providerId, chatModels, credentialCookie, allowedOrigin } // 与豆包开放 API 账号和资源标识隔离
- DoubaoWebConversation { conversationId, sectionId, lastMessageIndex } // 仅保存经过实际验证的网页续聊字段
- DoubaoWebSpeechProvider { ttsProviderId, speechModel, voice, format } // 独立于现有豆包 API 语音服务
- DoubaoWebSpeechEvidence { endpoint, requestShape, outputFormat, voiceRule, authRule } // 未验证前不把网页朗读宣称为可用
- DoubaoSafeError { code, fixedMessage, retryable } // 不传播 Cookie、签名、上游原文或完整请求地址

## 操作流程：确认网页协议

- browserTab = 只匹配本机调试端口中用户已打开的豆包官方聊天页 // 不接管用户的其他标签或服务器进程
- chatEvidence = 对照参考项目与当前网页资源核对文字模型、请求体、登录字段和流事件 // 参考项目协议可能与当前网页版本不同
- speechEvidence = 在用户确认允许现场验证后观察一次网页朗读 // 参考项目没有网页 TTS，静态组件名不能证明可用接口
- 如果网页朗读不能将任意输入文本合成有限长度音频，明确记录不支持 // 不用豆包开放 API 偷换网页 TTS
- 如果真人验证需要发消息或消耗账号额度，先使用用户确认的短测试文本 // 不访问、输出或持久化现有私人对话内容

## 操作流程：网页文字聊天

- account = 从 Chat2API 账号库选择启用且有效的豆包网页账号 // 凭证只保存于账号库，不放进 TTS 配置
- credential = 校验并解析已知 Cookie 字段，限定官方来源 // 拒绝换行注入、失效登录和任意地址
- chatRequest = 根据明确模型别名组装文本消息、思考模式和受限会话状态 // 不假定豆包网页支持工具调用或多模态输入
- upstream = 按已验证协议发送请求并限定时长、重定向、流容量和断线取消 // 防止风控响应及无限流耗尽资源
- chatChunks = 逐事件提取正文和可验证的会话标识 // UTF-8 分片、思考事件及错误事件分开处理
- output = 转换为 Chat2API 原流式或非流式文本响应 // 保持既有接口与其他 Provider 语义
- 如果续聊使用原生 conversationId，同步 Responses 新增消息判定 // 防止同一段历史在网页端重复发送
- 如果上游返回验证码、风控、凭证过期或非预期结构，输出固定错误 // 不自动绕过验证码或回显敏感上游响应

## 操作流程：豆包网页朗读

- speechRequest = 校验有限文本、明确的豆包网页模型和音色 // 不混用千问音色或现有豆包 API 的资源 ID
- speechAccount = 从同一个豆包网页账号池按已保存策略选取 // TTS 业务配置不复制 Cookie 或账号 ID
- speechAudio = 仅按已实测网页朗读协议生成并收集完整音频 // 未实测之前不创建假可用语音模型
- 如果上游返回可验证的 PCM，按实际采样参数包装 WAV；如果返回其他编码，先核对现有解码能力，否则明确不可用 // 不把压缩音频伪装为有效 WAV
- 如果空音频、截断、超限、超时或账号断线，返回固定脱敏错误 // 不静默切换原生或豆包开放 API
- businessSelection = 仅在 AI 与 Agent 回复及模板中增加豆包网页来源 // 文本阅读与系统播报不意外开放
- configSnapshot = 通过现有 AASC/WebSocket 保存并向控制端广播规范化结果 // 保留断线本地默认与重连补发

## 自测与兼容

- Chat2API 测试 = 文字流分片、非流式、模型别名、会话续接、鉴权失败、风控及脱敏 // 防止仅注册 Provider 却走通用请求体
- 语音测试 = 模型与账号隔离、登录失效、短音频、完整 WAV、容量、超时及取消 // 保留千问现有成功路径
- TTS 业务测试 = AI 与 Agent 模板、非法业务、原有豆包 API、配置权威、旧配置保留及失败不回退 // 不破坏现有播报链路
- 控制端测试 = Provider 选项、无凭证输入、音色目录、保存回传及只读自测 // 避免 Cookie 进入网页配置状态
- 优先执行 package.json 已有的 Chat2API 检查脚本，再补定向 TTS 测试 // 不擅自启动或重启用户服务器
- 发布状态 = 仅把实际服务端或网页热更新代码改动标记为需要服务代码包 // 不将待打包等同于已构建或发布
