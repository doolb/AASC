#skill: ai-code-translation

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
- `src/apps/server/modules/tts/qwen-chat-tts.js` // 国内千问签名及WebSocket朗读
- `src/apps/server/modules/tts/tts-chat2api-accounts.js` // 国内账号候选及请求内存凭证解析
- `src/external/tts/tts-wav.js` // PCM包装、WAV完整性和音量/速度变换
- `src/apps/web-mediacenter/ui/public/js/tts-provider-settings.js` // 控制端配置保存和目录查询
- `src/apps/web-mediacenter/modules/time/time-announce-app-service.js` // 报时标记为 systemBroadcast 业务
- `src/apps/server/modules/task-engine/builtin-tasks/time-announce.js` // 任务报时使用 systemBroadcast 业务
- `src/apps/web-mediacenter/ui/public/js/tts.js` // 控制端自定义文字播报保持 systemBroadcast 业务语义

## 范围约束

- 目标语言按当前真实项目使用 Node.js/CommonJS，不创建 Unity、dotnet、golang 或 nodejs 平台镜像目录
- 保留 `tts.device`、`tts.serverEnabled`、`sendTtsGenerateToDisplay` 和 `/uploads/tts` 音频引用协议 // 新 Provider 只扩展 Provider 选择，不替换现有设备路由
- API Provider 凭证只保存在用户配置；qwen-chat只保存Chat2API账号引用，模板只保存 `provider` 和 `voice`
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
- `Puppeteer`、`ws`、国内千问官方公开前端 doQwenAuth

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
- 所选Chat2API国内账号当前Cookie或ticket -> 临时Puppeteer首页 -> 官方doQwenAuth签名 -> WebSocket文本/结束包 -> 去重PCM -> 完成后WAV
- 国内网页所有阶段共享超时；签名并发上限2；finally关闭浏览器；不读取已有浏览器账户
- 自测映射 `src/apps/server/modules/tts/tts-provider-policy.test.js` 与 `tests/tts-provider-settings/integration/qwen-chat/ws/system-route/ui-browser.test.js`
- 自测templateTts/businessConfig/providers -> 比对继承、非法输入和业务隔离
- 自测fakeHttp/fakeWav/fakePcm -> 比对成功引用、完成事件、超时/超限/错误无缓存
- 自测controlSocket/failedSave/credential -> 比对脱敏、广播、重连与保存失败旧值
- 自测serverSource/browserSource -> 比对AI/Agent/textMedia入口与模板继承接线

## 操作流程

### qwen-chat 仅使用 Chat2API 账号（2026-10-11 已实现）

#### 已有声明

- Chat2API数据存储.listAccounts/getAccount、Provider注册表.getProvider // 复用既有账号库，避免复制凭证
- config.getTtsProviderSettings/setTtsProviderSettings、qwen-chat签名与生成 // 保持权威配置及音频协议

#### 新增定义

- QwenCredentialReference { chat2apiAccountId } // 仅记录用户明确选择的国内账号
- PublicAccountChoice { accountId, label, available } // 不向控制端发送凭证
- AccountChoiceMessage { type, requestId, accounts, success, message } // 用请求ID关联异步结果

#### 操作流程

- 规范化 selectedAccountId = qwen-chat.chat2apiAccountId // 限长且禁止换行，未选时保留为空
- 忽略旧 qwen-chat.credential 并在下次配置保存时移除 // 用户指定仅使用Chat2API账号，不暗中继续手动鉴权
- 保持其他 Provider 的凭证规则 // 本轮仅收敛qwen-chat
- 查询 publicAccounts = 国内qwen脱敏账号列表 // 只通过控制端WebSocket返回ID、名称、可用状态
- 渲染账号下拉框并保留失效的 selectedAccountId // 删除/查询失败不自动换号
- 保存 selectedAccountId = 权威配置回包 // 沿用config持久化、广播与重连初始化
- 读取 account = Chat2API当前所选账号、provider = 国内qwen当前Provider // 每次生成使用最新凭证，不依赖代理运行
- 将账号读取计入总超时并丢弃迟到结果 // 防止磁盘异常无限占住生成队列
- 未选/不存在/停用/错Provider/缺登录字段时返回脱敏错误 // 阻止隐式换号或回退
- 合并 credential = account.cookie 与 account.credentials.ticket // 当前ticket覆盖同名Cookie，避免使用旧登录值
- 传递 credential 至本次Chrome签名和WebSocket生成 // 凭证仅存在请求内存，不持久化或广播
- 完整音频写入原WAV缓存引用 // 播放、模板和业务路由保持既有行为
- 自测旧手动值忽略、账号候选脱敏、更新/删除/停用、界面保存/失败/重连及真实生成注入点 // 模拟不代替真实声音验收

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
- 再确定音色：模板显式音色 -> 同一Provider的业务默认音色 -> 最终Provider自身默认音色
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

- 根据 Provider 读取可用音色目录
- 返回音色 ID、名称和可用状态
- 将当前已保存但目录中不存在的音色标记为失效
- 音色目录查询失败时保留当前已保存音色
- 仅向前端返回非敏感配置和音色信息
