#skill: ai-code-translation

## framework/qwen-chat emoji筛选与跳过契约

### 已有声明
- createQwenChatProvider.generate、createTtsProviderService.generate // 只在qwen-chat去除不能朗读的表情
- server-app手动与普通AI回调、playAgentTts // 生成和播放之间传递跳过结果

### 新增定义
- QwenChatSpeechText { originalText, filteredText, skipAudio } // 原文用于聊天，筛选结果仅用于合成
- QwenChatSkippedAudio = null // 无朗读内容时不制造空音频

### 操作流程
- originalText = qwen-chat请求文本；graphemes = 按Unicode字素簇拆分originalText // 家庭、肤色、国旗和键帽按整体移除
- filteredText = 保留不含emoji的字素簇，再去首尾空白 // 普通数字、正文标点与内部空格保留
- 如果Provider未启用，维持原启用错误 // 筛选不能掩盖配置问题
- 如果filteredText没有文字或数字，输出null并停止合成 // 不查询账号或消费一次性令牌
- 如果filteredText有正文，将其和原请求语音参数转交Chat2API // 不改变其他Provider
- 如果qwen-chat输出null，Provider服务输出null且不缓存 // 保留有效WAV的完整性校验
- 如果手动或自动AI/Agent生成结果为null，跳过播放并继续有序队列 // 不把路径空值送入basename，不记失败

### 测试文件映射与自测流程
- tests/tts-provider-qwen-chat.test.js -> 验证复杂emoji、纯emoji跳过、非emoji数字符号保留、无账号调用与无缓存、正文真实失败仍拒绝 // 对照事故边界
- tests/chat-manual-tts.test.js -> 使用真实qwen-chat薄适配器验证手动目标和8段正文输出 // 不能只用模拟路径掩盖播放空路径
- tests/agent-chat-tts.test.js -> 验证跳过结果后正常句播放且无错误 // 覆盖Agent有序队列
- tests/server-tts-concurrency-integration.test.js -> 执行两条真实自动AI回调的跳过、后续播放及正文失败报告 // 覆盖普通自动聊天
- 手动浏览器回归使用独立临时目录并清理 // 避免本机临时目录配额使页面回归超时
- tests/tts-provider-ui-browser.test.js -> 配置页面只读自测说明与独立临时浏览器目录 // 避免同一配额问题影响配置兼容检查

## framework/国内千问Node语音鉴权（2026-10-11 确认实施）

### 已有声明
- Chat2API账号调度、getQwenCredential、collectQwenAudio、validateWav // 继续使用既有账号与播放职责
- 官方校时/register/refresh与HMAC-SHA256契约 // 对照公开SDK验证接口，不把聊天接口当朗读接口

### 新增定义
- QwenSpeechAuthSession { credentialHash, cookieJar, fingerprint, clockOffset, deviceId, sceneToken, signingTokens, expiresAt } // 仅内存隔离各账号
- QwenSpeechAuthError { stageCode, safeMessage } // 保留失败阶段但不暴露令牌和签名URL

### 操作流程
- authEvidence = 对照官方SDK实际注册输入和校时Cookie // 找出Node注册D1001原因
- nodeSession = 用当前账号凭证校时并注册有效令牌 // 先真实验证，再替换生产入口
- baseScene = qwen_web；relatedScenes = qwen_audio_asr和voice_command；timezoneOffset = 时区字符串 // 直接音频基础场景无UMID注册失败，通用场景关联已真实通过
- authKey = 子场景一次性令牌加校时毫秒；signText = 基础设备标识加版本加账号hashCookie加固定顺序参数值 // 与公开SDKHMAC-SHA256/base64数据流一致
- 会话上限16且闲置30分钟清理，活跃会话不驱逐；同账号串行校时/注册/刷新/分配 // 防止无限缓存及并发重复令牌
- signedRequest = 串联chid、nonce、timestamp并按官方顺序计算HMAC // 签名由Chat2API内部提供
- nodeAudio = 直接连接官方WSS并收集完整WAV // 无Chrome生成成功才确认可用
- 如果nodeAudio验证通过，接入Node签名并移除语音浏览器路径 // 防止未经验证的替换导致功能损坏
- 如果令牌不足或临近过期，刷新nodeSession并串行分配令牌 // 避免并发重用一次性令牌
- 如果凭证更新，使用新会话且旧会话按闲置/容量驱逐；如果鉴权失败，返回固定阶段错误 // 不复用旧令牌，不误报账号过期，不切换Provider

### 自测流程
- signatureVector = 验证参数顺序与HMAC固定向量 // 验证算法而非镜像实现
- authFixture = 模拟校时Cookie、注册/刷新和超时/非法响应 // 覆盖上游边界
- sessionFixture = 验证账号隔离、凭证更新及并发令牌消费 // 防止跨账号泄漏
- liveWave = 验证真实账号WAV与无Chrome运行 // 与模拟测试结果分别记录

# framework/tts-provider-configuration

## 目标文件清单

- `src/apps/server/modules/tts/tts-provider-policy.js` // 统一业务类型、Provider 限制和配置优先级
- `src/apps/server/modules/config/config-app-service.js` // 保存系统级 AI 默认、文本媒体、系统播报和 Provider 用户配置
- `src/apps/server/modules/chat/pi-runtime-policy.js` // 规范化聊天模板中的 AI 回复 TTS 字段
- `src/external/llm/llm-service.js` // 持久化聊天模板 TTS 配置并向聊天运行时传递模板上下文
- `src/apps/server/modules/chat/agent-chat-tts.js` // Agent 回复复用所属聊天模板的 AI 回复 TTS 选择
- `src/apps/server/modules/media/text-media-tts-service.js` // 文本媒体使用独立 textMedia 配置
- `src/apps/server/boot/server-app.js` // 接入 AI 回复、系统播报、文本媒体和现有 tts.device 兼容路由
- `src/apps/server/modules/tts/tts-provider-registry.js` // 注册 system、qwen-chat、qwen-api、doubao-api 适配器
- `src/apps/server/modules/tts/tts-provider-service.js` // 按业务类型解析选择并统一生成音频引用
- `src/apps/server/modules/tts/tts-provider-settings.js` // 规范化配置及凭证脱敏
- `src/apps/server/modules/tts/tts-provider-ws.js` // 权威配置与音色消息
- `src/apps/server/modules/tts/qwen-chat-tts.js` // 仅转交Chat2API统一语音请求
- `src/apps/server/modules/tts/qwen-chat-text-filter.js` // 按字素簇移除emoji，纯装饰片段输出无正文结果
- `src/apps/server/modules/chat2api/chat2api-speech-service.js` // Chat2API调度、凭证及语音服务
- `src/apps/server/modules/chat2api/chat2api-qwen-speech-adapter.js` // 隔离浏览器签名及WebSocket完整音频
- `src/apps/server/modules/chat2api/chat2api-runtime.js` // 与聊天共享账号及调度层
- `src/apps/server/modules/chat2api/chat2api-proxy-service.js` // 鉴权业务接口audio/speech
- `src/external/tts/tts-wav.js` // PCM包装、WAV完整性和音量/速度变换
- `src/apps/web-mediacenter/ui/public/js/tts-provider-settings.js` // 控制端配置保存和目录查询
- `src/apps/web-mediacenter/modules/time/time-announce-app-service.js` // 报时标记为 systemBroadcast 业务
- `src/apps/server/modules/task-engine/builtin-tasks/time-announce.js` // 任务报时使用 systemBroadcast 业务
- `src/apps/web-mediacenter/ui/public/js/tts.js` // 控制端自定义文字播报保持 systemBroadcast 业务语义

## 范围约束

- 目标语言按当前真实项目使用 Node.js/CommonJS，不创建 Unity、dotnet、golang 或 nodejs 平台镜像目录
- 保留 `tts.device`、`tts.serverEnabled`、`sendTtsGenerateToDisplay` 和 `/uploads/tts` 音频引用协议 // 新 Provider 只扩展 Provider 选择，不替换现有设备路由
- API Provider 凭证只保存在用户配置；qwen-chat不保存凭证或账号引用，模板只保存 `provider` 和 `voice`
- Agent 回复属于触发来源聊天模板的 AI 回复
- 文本媒体阅读使用独立 `tts.textMedia`，不读取聊天模板 TTS
- 系统播报和报时使用 `tts.systemBroadcast`
- `qwen-chat` 只允许 AI 回复，凭证失效只报告错误，不自动回退

## 已有声明

- `normalizeChatTemplate`
- `config.getTtsProviderConfig`
- `config.setTtsProviderConfig`
- `resolvePermissionPolicy`
- `generateTtsWithFallback`
- `createAgentTtsStream`
- `textMediaTtsService.handleSentenceRequest`
- `timeAnnounceAppService.announceTime`
- `taskManager.setGenerateTts`
- `ws`、Node crypto/fetch、国内千问官方校时/register/refresh与HMAC契约

## 新增定义

- `TtsBusinessType { aiReply, agentReply, textMedia, systemBroadcast }`
- `TtsSelection { provider, voice }`
- `TtsProviderConfig { enabled, endpoint, model, credential, defaultVoice, defaultSpeed, defaultVolume }`
- `TtsUserConfig { aiReplyDefault, textMedia, systemBroadcast, providers }`
- `TtsProviderError { provider, code, message }`

## 2026-10-11 已确认实施与自测映射

- 用户确认按现有Node.js/CommonJS目录实施，不创建平台镜像
- 模板省略Provider保留继承含义；显式system保留覆盖 // 防止编辑改变原有默认
- 先确定Provider -> 相同Provider业务默认音色 -> Provider默认音色 // 禁止跨服务串用音色
- 候选配置 -> 用户Provider凭证 -> config业务选择 -> 脱敏权威广播 // 保存失败恢复旧值
- qwen-api完整音频与doubao-api完成事件PCM -> 限长响应 -> 原内存缓存 // 不缓存半成品
- qwen-chat使用用户指定国内千问站；先核实朗读契约，克隆采样文字接口不用于音频合成
- TTS转交Chat2API speech -> 国内账号调度 -> 当前Cookie或ticket -> Node校时/注册/刷新/HMAC签名 -> WebSocket文本/结束包 -> 去重PCM -> 完成后WAV
- 所有阶段共享超时；同账号串行分配；16个闲置30分钟会话；不使用浏览器或临时目录
- 自测映射 `src/apps/server/modules/tts/tts-provider-policy.test.js` 与 `tests/tts-provider-settings/integration/qwen-chat/ws/system-route/ui-browser.test.js`
- 自测templateTts/businessConfig/providers -> 比对继承、非法输入和业务隔离
- 自测fakeHttp/fakeWav/fakePcm -> 比对成功引用、完成事件、超时/超限/错误无缓存
- 自测controlSocket/failedSave/credential -> 比对脱敏、广播、重连与保存失败旧值
- 自测serverSource/browserSource -> 比对AI/Agent/textMedia入口与模板继承接线

## 操作流程

### 系统原生路径与 Chat2API 统一语音（2026-10-11 已实现）

#### 已有声明

- tts.device、tts.serverEnabled、tts.defaultVoice、generateTtsWithFallback // 复用既有原生生成及音色路径
- Chat2API.runtime/loadBalancer/dataStore/providerRegistry/proxy // 账号与鉴权由Chat2API管理

#### 新增定义

- Chat2ApiSpeechRequest { input, voice, model, speed, volume, timeoutMs } // TTS只传合成参数
- Chat2ApiSpeechResult { audio, contentType } // 返回完整音频，继续使用原缓存与播放
- POST /v1/audio/speech，model=qwen-chat/QUARK_VOICE/MINI_MAX、input、voice、speed、volume、response_format=wav // 复用Chat2API业务鉴权

#### 操作流程

- 移除 system Provider 启用与音色ID配置，忽略旧字段 // 避免重复开关和无效ID覆盖既有原生路径
- 解析 finalProvider = system 后使用既有生成端与原音色 // 服务端回退仍由tts.serverEnabled控制
- 移除 qwen-chat 账号查询/选择及配置ID // 用户要求由Chat2API直接提供
- 传入 speechRequest 至 Chat2API语音服务 // TTS不读取登录凭证或自行调度账号
- 选择 account = Chat2API国内qwen可用账号调度结果 // 沿用既有启用/状态规则
- 在 Chat2API 内部使用当前凭证完成语音请求 // 凭证不进入TTS配置或控制端
- 使用qwen_web基础场景注册qwen_audio_asr关联令牌，再用Node HMAC签名 // 真实连续生成与刷新已通过，移除Chrome路径
- 返回 speechResult.audio 至原WAV缓存 // 保留业务分句、播放与取消协议
- 部署目标实例后验证WebSocket初始化与实际语音调用 // 避免新静态页面配旧运行后端

### 保存用户级 Provider 配置

- 读取用户提交的 Provider 配置
- 保留 Qwen API 和 Doubao API 的 endpoint、model、凭证和默认播报参数在用户配置中 // 凭证不进入聊天模板，避免助手配置携带服务端敏感信息
- 保存系统级 AI 回复默认配置
- 保存系统级文本媒体阅读配置
- 保存系统级系统播报配置
- 保存 Provider 默认音色和音频参数
- 向前端返回脱敏后的 Provider 状态与音色目录 // 防止 API Key、Access Token 等凭证泄露

### 解析 AI 回复 Provider

- 读取当前 AI 回复所属聊天模板
- 读取聊天模板的 `tts` 字段
- 读取用户配置中的 `aiReplyDefault`
- 先确定 Provider：使用模板 Provider，模板未配置时使用系统 AI 默认 Provider，仍未配置时使用 `system` // Provider 先确定，才能选择正确的默认音色
- 原生system音色 = null，保留旧原生接口的名称配置 // 新Provider ID无效
- 其他Provider再确定音色：模板显式音色 -> 同一Provider的业务默认音色 -> 最终Provider自身默认音色
- 校验最终 Provider 是否允许用于 AI 回复
- 返回 AI 回复的 `TtsSelection`

### 解析 Agent 回复 Provider

- 读取 Agent 触发来源的聊天模板
- 复用 AI 回复 Provider 解析流程
- 将解析结果传入 Agent TTS 播放流程 // Agent 回复与对应助手保持一致的声音身份

### 解析文本媒体阅读 Provider

- 读取用户配置中的 `textMedia`
- 使用文本媒体配置中的 Provider
- 文本媒体未配置 Provider 时使用 `system`
- 使用文本媒体配置音色
- 音色未配置时使用最终 Provider 的默认音色
- 校验文本媒体允许的 Provider 范围
- 将解析结果传入文本媒体逐句 TTS 流程

### 解析系统播报 Provider

- 读取用户配置中的 `systemBroadcast`
- 使用系统播报配置中的 Provider
- 系统播报未配置 Provider 时使用 `system`
- 使用系统播报配置音色
- 音色未配置时使用最终 Provider 的默认音色
- 校验最终 Provider 不得为 `qwen-chat` // Qwen Chat 网页朗读暂时只开放给 AI 回复
- 将解析结果传入报时、状态、任务结果、错误提示和控制反馈播报流程

### 生成 AI 回复音频

- 接收 AI 回复文本、聊天模板和显示目标
- 解析 AI 回复或 Agent 回复的 `TtsSelection`
- 调用对应 Provider 生成音频
- 将音频统一保存为现有音频引用
- 继续通过 `playAudio` 或 `playOnControl` 下发音频 // 保持现有显示端和控制端播放协议

### 生成文本媒体和系统播报音频

- 接收文本媒体或系统播报文本
- 按业务类型解析独立的 `TtsSelection`
- 调用对应 Provider 生成音频
- 将音频统一保存为现有音频引用
- 继续通过现有文本媒体、报时和系统播报通道下发音频

### 处理 Provider 错误

- 识别 Provider 鉴权失败、音色失效、超时、空音频和连接中断
- 对 Qwen Chat 凭证失效返回明确错误 // 不自动切换到系统 TTS 或其他 API Provider
- 对其他 Provider 按既有错误语义报告失败
- 保留敏感凭证脱敏后的错误日志
- 不因音色目录刷新失败覆盖已保存的音色
- 对已失效音色保留配置并在播放时报告 Provider 错误

### 查询音色目录

- 原生system直接返回空目录，不发送查询 // 既有原生音色保持旧设置职责
- 其他Provider读取可用音色目录
- 返回音色 ID、名称和可用状态
- 将当前已保存但目录中不存在的音色标记为失效
- 音色目录查询失败时保留当前已保存音色
- 仅向前端返回非敏感配置和音色信息

### 聊天手动播放使用所属AI语音（2026-10-11 已确认）

#### 已有声明

- Chat.playMessage/playText、消息role/mode/templateId/target、roleHistories、临时历史组roleName // 来源沿用现有历史，不增加配置查询
- chat.getTemplateByName、generateTtsWithFallback、BUSINESS_TYPES、控制端tts/play // 复用权威模板及旧缓存播放

#### 新增定义

- ChatReplyTtsContext { businessType, templateName } // 控制端仅发来源，不发凭证或服务地址
- currentReplyTtsContext // 流式回复开始时捕获，完成按钮不套用新会话
- chat-reply-tts-context.resolveChatReplyTtsOptions // 服务端校验来源并读取当前模板
- tests/chat-manual-tts.test.js // 正式Chat模块及服务端手动入口执行测试

#### 操作流程

- 从已显示历史数组读取 message 与所属 roleName // 保持筛选索引、临时历史组和角色隔离
- 判断 assistant = message.role或旧assistant字段 // 用户消息保留原系统播报
- 解析 replyContext = AI或Agent业务与消息templateId/target、所属临时组roleName // 缺来源采用AI默认，不猜显示名
- 在发起流式请求时保存 currentReplyTtsContext // 会话切换不改变回复归属
- 对象播放使用已捕获replyContext或其消息来源 // 新消息与历史按钮复用同一解析规则
- 将 speech优先文本、replyContext与原显示目标发到tts/play // 文字/分句及播放协议保持
- 校验 replyContext业务仅ai_reply/agent_reply、模板名限长无控制字符 // 普通自定义播报不带上下文
- 读取 templateTts = 服务端当前对应模板配置快照 // 客户端附带Provider/密钥字段不参与生成
- 允许手动tts/play独立控制端或多端目标，无须单一主显示端 // 原无显示端提前返回会丢弃合法播放
- 将生成 options = businessType/templateTts传入每句旧generateTtsWithFallback // 整次播放配置一致
- 模板不存在使用AI默认，显式system沿用原生、qwen-chat交给Chat2API // 与自动回复相同选择规则

#### 自测流程

- 正式Chat输入私聊/角色/临时旧组/群聊/旧记录 -> 断言来源消息、speech与原播放目标 // 覆盖会话切换不串音色
- 流式完成按钮捕获来源 -> 切换角色再点击 -> 原角色上下文 // 覆盖独立对象入口
- 执行真实服务端tts/play分支 -> 真实Provider解析及有序调度 -> 捕获AI/Agent音色和旧自定义播报 // 不只检查源码字面量
- 覆盖当前模板更新、模板删除、继承/原生、qwen-chat、伪造密钥、非法业务/模板名 // 不依赖真实账号
- 浏览器点击播放按钮与只读SelfTest -> 检查消息而不发送测试音频 // 自测不打断用户播放
