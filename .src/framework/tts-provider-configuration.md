#skill: ai-code-translation

## framework/qwen-chat开放非AI业务（2026-10-13，已实现）

已有声明
- validateBusinessProvider、normalizeSettings、resolveProviderConfig // 保存和执行复用业务校验
- selectProvider、tts_provider_config SelfTest // 页面选项和只读校验
- qwen-chat过滤后null；textMediaTtsService与系统/命令音频消费 // 空结果必须先识别

新增定义
- NonAiProviders = 原非AI来源 + qwen-chat // 不改默认Provider；豆包网页原策略

操作流程
- text_media/system_broadcast保存或执行qwen-chat -> 业务白名单接受 // 包含阅读、报时、提醒和自定义
- 三类配置控件提供qwen-chat -> 原AASC保存、规范化权威回填和重连 // 不新增配置HTTP接口
- 正文 -> 原Chat2API账号和映射 -> WAV缓存/播放 // 不复制凭据
- 过滤无正文 -> null -> 消费端跳过，不构造basename/URL // 不制造空WAV
- 文本当前句/预取null -> 原定位跳过通知并清理状态 -> 下一句 // 取消后的回包失效
- 系统/命令null -> 原批次/响应收尾，停止后状态正常 // 不记合成失败
- qwen系统语音批次按可朗读句子编号和标记最后一句 // 保留原显示文字，避免末尾emoji丢失结束标记
- 过滤与生成共用开始时的语音配置快照，下一批读新值 // 内部第二参数，不接受公共请求传配置
- 自定义生成无正文status=skipped，旧显示端释放当前项与队列 // 不返回success加空URL
- 用户已确认并完成目标代码和离线验证 // 历史规则按当前业务范围同步

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
- `qwen-chat` 允许全部既有播报业务，凭证失效只报告错误，不自动回退

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
- 校验最终Provider在非AI白名单（含qwen-chat） // 原业务选择与同来源音色继承
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


## framework/显示与控制端共享音色快选（2026-10-15，用户已确认实施）

### 目标文件清单

- src/apps/server/boot/server-app.js // 转交显示端快选前隔离权威传输字段
- src/apps/web-mediacenter/ui/public/js/tts-voice-picker.js // 提取现有选择、目录、筛选与请求状态
- src/apps/web-mediacenter/ui/public/js/display-tts-voices.js // 保留显示端旧入口和舞台总线适配
- src/apps/web-mediacenter/ui/public/js/control-tts-voices.js // 接入控制端WebSocket和浮钮
- src/apps/web-mediacenter/ui/public/css/tts-voice-picker.css // 共享面板内容样式，保留两端宿主定位
- src/apps/web-mediacenter/ui/public/upload.html及display.html、display-mmd.css、websocket.js // 挂载共享资源并分发权威消息

### 已有声明

- handleDisplayMessageFallback、ttsProviderWs.handle、displayClients、data.displayId // 连接入口已覆盖权威身份
- DisplayTtsVoices的refs/config/pending/catalogs/filters、DisplayStage.getBus // 复用真实状态，避免复制协议
- WebSocketManager.ws/handleMessage、TtsProviderSettings、FloatingControl.isOpen/toggle // 共用原控制连接与工具入口

### 新增定义

- TtsVoicePicker.create { init } // 每宿主独立实例，共享原选择规则
- ControlTtsVoices { init, handleMessage, handleConnected, handleDisconnected } // 转为共享组件总线，不新建连接

### 操作流程

- 接收显示连接消息并补入登记displayId → 转交快选时仅移除displayId → 原白名单校验 // 其它未知业务字段仍拒绝
- 使用TtsVoicePicker.create建立宿主独立配置/请求ID/目录/筛选状态 // 前缀区分控制和显示回执
- 显示适配器传入display前缀和原舞台总线，打开时收起灯光 // 保持旧DOM标识和安全区
- 控制入口挂在floatingControl工具组，按钮在现有录音暂停上方、面板在工具组左侧 // 避让原齿轮/自测/录音按钮
- 控制适配器通过WebSocketManager现有连接收发，断线失败返回false // 不新增HTTP配置接口或第二连接
- 控制WS收到权威配置或目录 → 原声纹设置页与快选组件同时处理 // 一个回显不吞掉另一个入口
- 两端改选 → setChatTtsSelection → 服务端持久化并广播 → 仅权威回显改变当前项 // 失败保留服务器原选择
- 控制断线及重连转为transport.changed，失效配置/目录在重连时补发 // 不把旧本地值写回服务端
- 面板保留全局AI/Agent范围说明及模板原优先级 // 已开始批次继续使用原快照
- 新增真实入口带displayId、未知字段拒绝、多端回显/筛选/布局/生命周期回归，再用ADB验证 // 先覆盖本次夹具遗漏


## 共享面板语速滑条（2026-10-15，用户已确认）

已有声明
- providers.defaultSpeed、supportsNativeSpeed、normalizeNumber、setChatTtsSelection // 复用既有每方式偏好与权威保存

新增定义
- setChatTtsSelection.speed // 可选数值，范围-10到10；仅更新当前Provider语速，不重选AI默认或音色
- TtsSpeedControl { wrapper, slider, output } // 两端共享，input本地预览、change松手提交

操作流程
- 根据权威Provider.defaultSpeed是否为有限数值显示滑条，否则隐藏 // 规范化输出只给原生支持调速的方式该字段
- 接收speed消息并校验有限数值、方式/模型原生能力、不得同时带voice // 保持窄权限，防止无效调速被假报成功
- 规范化speed到-10到10并仅构造providers目标项defaultSpeed补丁 // 不覆盖其它方式、业务选择或凭据
- 经setTtsProviderSettings持久化并广播ttsProviderConfig // 保持声纹页及两端面板一致
- 拖动显示数值，松手提交；pending期间禁止重复提交；失败/超时/断线恢复权威值 // 不在每个input事件刷远端配置
- 下一次语音批次读取新偏好，已播放批次保持快照；豆包网页/Qwen3不支持原生语速时隐藏 // 不新增本地音频变速

## framework/音色列表按钮状态（2026-10-15，用户已确认）

### 已有声明

- currentVoice、voice.id、aria-selected、renderVoices // 复用服务器权威选择，不维护第二份active状态
- theme.css的普通/激活按钮颜色、tts-voice-picker.css // 控制端与显示端共用皮肤

### 新增定义

- VoiceButtonState { selected, normal, hover, focus, disabled } // 仅描述视觉状态，不增加配置或运行状态

### 操作流程

- 将aria-selected为真映射到强调渐变、白字、强调边框和勾选 // 与已有激活按钮语义一致
- 将aria-selected为假映射到中性背景、普通文字和边框，隐藏勾选 // 避免普通项看似已选
- 提高组件局部背景、文字、边框规则优先级并明确important // 浅色主题通用button规则原本覆盖选中差异
- 让副标题继承按钮文字并保持可读透明度 // 避免白字按钮上仍显示低对比深色标签
- 仅可用普通项悬停时轻微强调，键盘焦点保持可见，禁用时保留原选中皮肤 // 等待中不提前显示目标项已选
- 保持保存失败不改权威状态，成功广播才重绘选中项 // 纯CSS调整不改变现有配置协议

### 自测映射与流程

- tests/display-tts-voice-filters-browser.test.js // 保留三下拉、定位、保存等待/失败/成功的权威选中断言
- tests/control-tts-voices-browser.test.js // 在真实双端WS夹具中验证共享按钮皮肤及只读自测
- 为双端设置深色、light、mint主题 → 读取选中与普通项计算样式 → 比对渐变、文字、边框、副标题与勾选 // 使用真实主题重要规则复现覆盖
- 普通项悬停、键盘聚焦及两项禁用 → 确认权威属性与视觉差异保持 → 恢复临时测试属性 // 不提交额外配置
- 在SelfTest现有控制端音色检查内只读扫描已渲染音色项 → 验证按钮状态差异及副标题颜色 // 空列表只检查结构，不为自测打开面板或修改音色
- 执行npm run test:tts-voice-picker → 记录结果 // 用户已确认补充定向验证

## framework/豆包Chat纯表情分句中断修复（2026-10-15，用户已确认）

### 已有声明

- filterQwenChatSpeechText、Intl.Segmenter、emojiPattern、readablePattern // 千问已按完整字素过滤emoji并判定可朗读正文
- createDoubaoChatProvider.generate、createTtsProviderService.generate // 豆包当前直接传request.text，公共服务只允许千问返回null
- createManualChatTtsService.play、splitIntoSentences、generateChatTtsActions // 手动与自动路径不同，Provider是共同边界

### 新增定义

- filterSpeechText // 从现有千问模块抽出公共实现，旧导出保留兼容
- DoubaoSpeechSkip { filteredText, hasReadableText } // 仅描述过滤结果，不新增配置

### 操作流程

- 在公共过滤实现中按字素簇移除整组emoji，保留原有文字、数字和标点 // 不切碎ZWJ、肤色、国旗、键帽
- 千问旧模块转发公共实现并保留旧导出，豆包Provider复用同一过滤 // 不修改原聊天文本或MMD动作来源
- 过滤后无文字或数字则返回null，不请求上游 // 纯表情分句不应被当作合成故障
- 公共Provider服务允许豆包和千问的null结果继续作为跳过信号，不做WAV校验或缓存 // 手动调度继续后续句子
- 保持真实上游失败、超时、取消的错误语义，不把合成失败假报为已跳过 // 故障需继续可见
- 先用用户原文验证文字保持、纯表情未调用上游、后续分句仍生成 // 当前日志只能确认incomplete，尚未实网对照确认诱因
- 验证手动重播、自动播报及纯emoji/混合文本/失败边界回归 // 用户已确认，手动22/22、Provider和动作28/28通过

### 豆包表情过滤自测映射

- tests/tts-provider-doubao-chat.test.js // 检查原Provider+公共服务：纯emoji不请求/不缓存，混合文本保留字词数字标点，组合字素移除完整，真实上游错误继续抛出
- tests/chat-manual-tts.test.js // 连接正式Markdown清理、真实分句、手动重播、ProviderRegistry和ProviderService；注入本地假WAV上游，不调用真实账号
- tests/display-mmd-tts-actions.test.js // 连接公共自动播报与豆包Provider；已识别动作准备/保留原文，未知emoji在最终合成边界去除
- 旧千问qwen-chat与qwen-business回归 // 验证旧导出引用和各业务null跳过契约保持
- 原句分为正文与纯emoji → 假上游拒绝无正文输入 → 等待队列结束 → 断言三段正文按序下发且无失败 // 旧代码会在纯emoji处失败
- 日志同款完整回复 → 跳过四段emoji → 八段正文按序下发 → 保持显示文本原样 // 覆盖用户实际失败路径
- 真正上游incomplete/超时/取消 → 保持错误码与provider标记、无空缓存 // 不吞没正常故障

## framework/Qwen Audio 3.1音色与五方式常开（2026-10-15，用户已确认）

### 已有声明

- PROVIDER_DEFAULTS.qwen-api、QWEN_API_RATE_MODELS、createQwenInput // 默认已是qwen-audio-3.1-tts-flash、乔小娇及官方Audio路径
- createApiSpeechAdapters.qwenApi.voices、createChat2ApiSpeechService.voices、getTtsProviderVoices // 复用已有目录查询，不新增HTTP配置接口
- normalizeProviderSettings、TtsProviderSettings.init/save、TtsVoicePicker // 现有enabled配置、四个启用复选框和未启用提示

### 新增定义

- QwenAudio31Voice { id, name, gender, tags, category, languages } // 仅整理官方3.1的68项，不导入其它模型音色
- listQwenAudio31Voices // 返回隔离副本，保持官方大小写及元数据

### 操作流程

- 固定默认模型为qwen-audio-3.1-tts-flash，缺省音色沿用qiaoxiaojiao_v3.1 // 当前源码和本机配置已符合，不擅自覆盖用户明确保存的其它模型
- 从官方3.1段的四个表分别整理4/22/15/27项并校验68个唯一ID // 试听列不当作全语言能力，语言只用官方明确说明
- 将性别、声线、场景和明确语言纳入目录元数据，保留ID原始大小写 // 共用当前搜索/性别/标签筛选
- 仅当实际解析模型为3.1时返回本目录，沿用映射规划与权限校验 // 不向其它模型错配3.1音色
- 使四个云/网页Provider的兼容enabled权威值恒为true，system继续不提供此字段 // 旧false和旧控制端保存不会形成隐藏禁用
- 去掉Provider适配器启用拦截、页面启用复选框及快选未启用提示 // 账号启用、凭据校验、播放开关仍由各自流程管理
- 保存仍走setTtsProviderConfig、config.set、ttsProviderConfig广播与重连回填 // 沿用AASC权威配置
- 补充默认模型、68项大小写/元数据/复制隔离、真实目录查询、五方式旧false兼容和无开关UI回归 // 用户已确认，相关回归已通过
- 合并此前音色按钮/豆包emoji修复，重新生成新服务版本并发布LAN/WAN // 已生成候选101不覆盖同名文件，依赖/min/任务沿用

### Qwen Audio 3.1与常开自测映射

- src/apps/server/modules/chat2api/chat2api-qwen-audio-voices.test.js // 目录68项/四类/47女21男/大小写/深拷贝；API适配器、统一语音映射及WS实际目录一致
- tests/tts-provider-settings.test.js、tests/tts-provider-ws.test.js // 缺省3.1/乔小娇；历史false和新提交false规范化true，快照与广播一致
- tests/tts-provider-ui-browser.test.js // 无Provider启用checkbox，保存不携带enabled，68项候选名称与ID保持，旧配置回填/失败/重连保持
- tests/control-tts-voices-browser.test.js // 共享组件加载真实3.1目录，双端回显、47项女声筛选和大写ID选择
- tests/tts-provider-integration.test.js、tests/tts-provider-qwen-chat.test.js、tests/tts-provider-doubao-chat.test.js // 旧false不再拦截；缺语音服务/账号与真实错误仍报错，纯emoji跳过保持
- self-test.js的tts_provider_config // 校验四个非原生Provider权威enabled=true以及页面无启用checkbox，不发合成
- 验证通过并同步文档/出包状态后上传Git → 新服务ZIP逐字节匹配源码 → LAN/WAN版本化上传/原子清单/HTTP验证/精确清理 // 不覆盖候选101或重建未受影响资源

## framework/豆包长句多Ogg流接收（2026-10-15，用户已确认）

### 已有声明

- validateOggOpus、OGG_LIMITS、decodeOggOpusToWav // 保留单流CRC/序列/BOS/EOS/声道/时长完整校验
- createDoubaoSpeechAdapter的complete句缓冲、WAV/PCM合并及120秒/16MiB上限 // 不改外部WAV协议

### 新增定义

- splitOggOpusStreams // 只按完整Ogg页与EOS/BOS边界识别顺序流，不修复缺页或截断数据

### 操作流程

- 扫描单个上游分句缓冲的Ogg页长度 → 以完整EOS划分流 → 对每流执行现有validateOggOpus // 实测原句上游同句含两个独立有效流
- 校验所有子流总页数/编码时长/压缩大小及最多64流 // 不以分流绕过安全上限
- 在豆包适配器按原顺序逐流解码 → 校验采样率/单声道PCM16 → 沿用累计PCM/时长校验与合并 // 两段各自pre-skip/EOS独立生效
- 对错CRC、错序、交错serial、缺BOS/EOS、尾部残余、超限继续报错 // 保持真正不完整音频可见
- 补真实两流形状的本地夹具、损坏/截断/限额与单流兼容回归，使用用户原长句实网复验 // 用户已确认，35项回归及原文实网验证通过

### 多流自测映射

- tests/tts-ogg.test.js // 单/双完整流、64流上限、累计页数/字节/时长，CRC/尾部截断/交错serial/BOS或EOS缺失仍拒绝
- src/apps/server/modules/chat2api/chat2api-doubao-speech-adapter.test.js // 同一TTSSentence包含两完整流，逐流解码顺序/PCM长度，坏第二流不输出部分WAV
- tests/tts-opus-decoder.test.js // 分割后逐段真实WASM解码与PCM合并，各段pre-skip保留
- 捕获原长句59027字节音频 → 新分割器识别两流 → 严格解码合并 → 与逐段PCM总长度一致 // 诊断音频仅.cache不提交
- 原长句再做一次受控合成 → 完整WAV非静音且总时长约11秒；整段原文逐句受控验证 → 不写账号/配置 // 不把文件验证宣称为实机听感

## framework / 在线TTS上游并发（2026-10-16，待实施确认）

已有声明
- TTS权威配置、setTtsProviderConfig、config.set、ttsProviderConfig // 复用AASC保存与重连
- 分句索引、有序交付、上游账号队列、令牌签名队列 // 不混淆生成与鉴权互斥

新增定义
- UpstreamConcurrency { doubao-chat: 3 }
- AccountSlot { active, waiting, limit }

操作流程
- 控制端提交豆包并发 → 校验1至8整数 → 持久化与广播 // 缺失默认3
- 在线分句任务 → 立即提交生成 → 按索引保序交付 // 不再限制分句生成并发
- 豆包请求选择账号 → 统一上游队列准入 → 在途不足限额则建连，否则FIFO等待 // 不让不同批次各自突破上游限额
- 上游完成或失败 → 幂等释放 → 准入下一等待项 // 收齐音频即释放，不把本地解码算为上游连接
- 配置升高 → 立即补位；配置降低 → 不取消在途并等待回落 // 保持热修改行为可预测
- 取消/期限/队满 → 现有上游固定错误 // 不迟到建连，不把排队失败归为账号失败
- 千问签名初始化、刷新、令牌消费 → 原互斥保持 // 当前无可调生成并发，本轮不自动新增
- 原生与本地显示端 → 原设备资源调度 // 在线接口并发与本地算力分开

自测流程
- 配置默认3、非法和边界、WS广播重连 → 同一权威值 // 对应配置与WS测试
- 同账号多批次同时提交 → 上游最大3；多账号独立；动态升降、取消超时与幂等释放 → 正确active数 // 对应队列与adapter测试
- 超过3句提交且乱序完成 → 原索引交付；旧本地资源并发 → 保持 // 对应有序调度与server集成测试
