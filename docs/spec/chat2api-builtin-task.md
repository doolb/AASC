# Chat2API 核心内置任务实现规范

## 任务注册与生命周期

```text
registry.tasks 增加 chat2api.proxy
task.mode = service
task.target = server
task.run(context):
    读取 chat2api 用户配置
    创建 Chat2APIProxyService
    启动独立 HTTP Server(host, port)
    注册代理路由、鉴权中间件和管理回调
    返回 { type: 'service', stop() }

stop():
    停止 OAuth 临时回调
    关闭 SSE 和活动连接
    关闭 HTTP Server
    清理 Provider、账号和 API Key 的内存缓存
```

## 上游核心装配

```text
loadChat2ApiCore():
    加载 3rd/chat2api-core 的 Provider、OAuth、Store、Forwarder 和路由模块
    不加载 Electron、IPC、Tray、Window、Renderer、Updater
    将上游 Store 适配为 AASC UserConfig 存储
    将上游日志适配为 AASC 结构化日志
    返回 core
```

## 代理请求

```text
POST /v1/chat/completions(request):
    校验代理已运行
    校验 Authorization Bearer API Key（启用鉴权时）
    校验 model 和 messages
    通过 modelMapper 解析 Provider 和模型
    通过 loadBalancer 选择启用且健康的账号
    将请求交给 Provider adapter
    stream=true -> 转发标准 SSE 并在结束时记录统计
    stream=false -> 转换为标准 OpenAI response 并记录统计
    Provider 失败 -> 按故障转移策略选择下一账号
    全部失败 -> 返回不泄露凭据的错误摘要
```

```text
GET /v1/models:
    汇总启用 Provider 和模型映射
    返回 OpenAI models 数组
```

## 管理接口

```text
GET/PUT /api/chat2api/config:
    读取或校验代理配置
    保存 host、port、timeout、loadBalanceStrategy、enableApiKey

GET/POST/PUT/DELETE /api/chat2api/providers:
    列出、创建、修改、删除 Provider
    删除前检查关联账号和模型映射

GET/POST/PUT/DELETE /api/chat2api/accounts:
    列出脱敏账号、导入凭据、启用/禁用、删除和健康检查

POST /api/chat2api/oauth/start:
    生成一次性 state 和过期时间
    打开或返回 Provider 登录地址
    等待绑定 Provider 的回调
    校验 state 后保存凭据并删除临时状态

GET/POST/PUT/DELETE /api/chat2api/api-keys:
    管理访问密钥
    列表只返回脱敏值，创建时完整值只返回一次
```

## 数据安全

```text
saveSecret(data):
    创建 chat2api 目录
    以用户私有权限写入凭据文件
    写临时文件并原子替换正式文件
    日志只记录账号 ID、Provider ID 和操作结果

importChat2ApiData(file):
    读取并校验版本和字段
    预览 Provider、账号和模型映射
    用户确认后合并，不覆盖未出现在导入文件中的数据
    删除或隔离导入临时文件
```

## 本地数据存储实现

```text
createChat2ApiDataStore(options):
    rootDir = options.rootDir 或 ~/.config/aasc-user/chat2api
    创建 rootDir，权限设为 0700
    为 config/providers/accounts/api-keys 建立 JSON 文件入口
    为 oauth-sessions 建立临时会话目录

readCollection(name, fallback):
    读取对应 JSON 文件
    文件不存在 -> 返回 fallback 的深拷贝
    JSON 格式错误 -> 抛出可定位错误，不覆盖原文件

writeCollection(name, value):
    序列化为 UTF-8 JSON
    在同一目录创建私有临时文件，权限设为 0600
    flush 临时文件后原子 rename 为正式文件
    正式文件权限保持为 0600

saveAccount(account):
    校验 providerId、accountId 和账号结构
    合并同 accountId 记录
    保存完整凭据到 accounts.json
    返回脱敏账号，不返回 token、cookie、refreshToken、accessToken 或 apiKey

listAccounts():
    读取 accounts.json
    只返回账号公开字段和 secretConfigured
    对可能存在的兼容字段统一脱敏

getAccount(accountId):
    仅供服务端 Provider adapter 读取指定账号的完整凭据
    不直接作为控制端管理接口返回

createApiKey(input):
    生成不可预测的完整 key
    只在创建结果中返回一次完整 key
    持久化 key 的哈希和脱敏预览

validateApiKey(value):
    读取启用的 key 哈希
    使用恒定时间比较逐项校验
    只返回匹配的 key 元数据或 null，不返回持久化密钥

previewImport(data):
    校验版本、集合类型和字段上限
    统计待新增/合并的 Provider、账号和模型映射
    返回脱敏预览，不写入正式文件

mergeImport(data, confirmed):
    confirmed 不是 true -> 拒绝写入
    先在内存中合并并校验全部集合
    依次原子写入，任一失败则保留原文件并返回错误
    成功后返回新增/更新统计和脱敏摘要

previewLegacyImport():
    读取当前用户 ~/.chat2api/data.json
    将 Electron Store 的 providers、accounts、config.modelMappings 和 userModelOverrides.*.addedModels 转换为 AASC 导入格式
    addedModels 使用 displayName 作为 model、actualModelId 作为 actualModel，并保留所属 Provider
    返回 Provider、账号、模型映射数量、代理配置预览和脱敏账号摘要

mergeLegacyImport(confirmed):
    confirmed 不是 true -> 拒绝写入
    重新读取并校验 ~/.chat2api/data.json
    复用 mergeImport 合并 Provider、账号和模型映射
    userModelOverrides.*.addedModels 转换为带 providerId 的模型映射并合并
    将 proxyHost、proxyPort、loadBalanceStrategy、enableApiKey 转换并合并到 AASC config.json
    不迁移原 Chat2API API Key、日志、会话和桌面应用状态

createChat2ApiGateway(taskManager):
    接收控制端同源 HTTPS 请求和 chat2api.proxy 实例 ID
    从 TaskManager 查询实例状态和端口，只允许运行中的 chat2api.proxy 实例
    仅转发 /api/chat2api、/v1、/health 和 /stats 路径到服务器本机回环地址
    重新生成请求体长度，移除冲突的 transfer-encoding，透传响应状态、头和流
    实例不存在、未运行或转发失败 -> 返回可识别的网关错误
```

## Provider、模型映射和负载均衡

```text
createProviderRegistry(dataStore):
    加载 Chat2API 内置 Provider 元数据
    读取 providers.json 中的用户覆盖项
    以 providerId 合并默认配置和用户配置
    默认 Provider 缺失时补齐，不覆盖用户的 enabled、模型和描述修改
    返回 Provider 列表、Provider 详情和可用模型列表

saveProvider(provider):
    校验 providerId、名称、认证类型和接口地址
    只允许修改 AASC 允许的字段
    原子保存 Provider 配置

resolveModel(requestedModel, provider):
    优先匹配指定 Provider 的精确模型映射
    再匹配全局映射和通配符映射
    未找到映射 -> 使用原始模型名
    兼容映射中的 preferredProviderId 和历史 providerId 字段
    返回 requestedModel、actualModel、preferredProviderId 和 preferredAccountId

selectAccount(model, strategy, preferredProviderId, preferredAccountId):
    有 preferredProviderId 时只筛选指定 Provider；用户明确配置的自定义模型不再要求出现在 Provider 内置模型列表
    对每个候选 Provider 先调用 modelMapper.resolveModel(model, provider)
    actualModel 优先使用 Provider 内置映射，其次使用全局精确/通配符映射，最后使用请求模型
    Provider 支持性判断和候选返回的 actualModel 使用同一解析结果
    无 preferredProviderId 时继续过滤 Provider 内置模型支持和账号 enabled/status/dailyLimit
    preferredAccountId 可用时优先使用
    fill-first -> 选择当日使用量最低且最久未使用账号
    failover -> 排除冷却中的账号，全部不可用时选择失败次数最少账号
    round-robin -> 按 Provider/模型候选集合轮询
    返回 provider、account、actualModel；无候选 -> 返回 null

markAccountFailed(accountId):
    累加失败次数并记录时间
    达到阈值后进入冷却期

clearAccountFailure(accountId):
    删除账号失败状态
```

## AASC 原生代理边界

```text
POST /v1/responses(request):
    校验 model 和 input；input 支持字符串或 Responses 输入项数组
    校验 conversation 与 previous_response_id 不同时出现
    conversation 缺失且 previous_response_id 缺失 -> 创建新的 conversation 和 response 链
    previous_response_id 存在 -> 在 responses-sessions 集合中查找对应会话
    conversation 存在 -> 读取对应会话并校验会话仍可使用
    将 instructions、input message、function_call 和 function_call_output 转换为内部 messages
    从会话记录取得固定 Provider/账号/原生状态；无记录时按模型映射和负载均衡选择
    有原生状态 -> 传递 Provider 专用 session/chat/conversation/parent 标识
    无原生状态 -> 将会话历史和本轮输入合并后重放给 Provider
    调用现有 coreAdapter.forwardChatCompletion
    生成唯一 resp_ 响应 ID并保存 response -> conversation 关联
    非流式 -> 将 chat.completion 转换为 response、message、output_text 和 usage
    流式 -> 将 chat.completion.chunk 转换为 response.created、response.output_text.delta、response.output_text.done、response.completed
    Provider 返回的原生状态和本轮 assistant 输出写回会话
    Provider 失败 -> 返回 Responses error，不泄露账号凭据
```

```text
createChat2ApiCoreAdapter(options):
    注入 dataStore、providerRegistry、modelMapper、loadBalancer 和 Provider adapters
    不加载 Electron、Koa 或上游 Store

createProviderAdapters(httpClient):
    为每个 Provider 注册独立 adapter
    根据 Provider ID 选择原版专用请求体、认证头和 endpoint
    DeepSeek 使用会话/挑战协议和 prompt 转换
    GLM 使用 token refresh、签名头和 assistant stream 请求体
    Kimi 使用 5 字节长度前缀 gRPC-Web 帧和专用 payload
    MiMo 使用保存会话、Cookie、查询参数和 bot/chat 请求体
    MiniMax 使用设备/用户参数、签名请求体和 chat/send_msg 协议
    Perplexity 使用 perplexity_ask 查询体和会话 Cookie
    Qwen AI 使用 chats/new 会话及 chat/completions phase 请求体
    Z.ai 使用 chats/new、请求签名、查询参数和 phase 请求体
    Qwen adapter 使用原生 /api/v2/chat 请求协议，生成 req_id、session_id、nonce、timestamp 和 Qwen 专用消息体
    Qwen adapter 按响应 content-encoding 解压 gzip、deflate、br 后再读取 SSE 事件
    Qwen adapter 统一按 SSE 事件读取 data.messages，并从 multi_load/iframe 或 text/plain 提取答案内容
    核心适配层统一把所有网页 Provider 的 function tools 转成 managed_xml 标签提示
    将 managed_xml 提示加入首个 system 消息；没有 system 消息时新建一条
    Provider 请求移除 tools 和 tool_choice，不依赖 Provider 的原生 OpenAI tools 支持
    responseSession.nativeState 保存工具提示指纹，原生会话增量请求不重复注入
    没有指纹的旧原生会话按已注入提示处理，避免重复生成 System
    adapter 接收可选 responseSession.nativeState
    Qwen、DeepSeek、Mimo、MiniMax、Qwen AI、Z.ai、Kimi 优先复用可用原生会话标识
    原生会话标识无法安全续接时回退为请求历史重放，并返回本轮可观察的原生状态
    Qwen 非流式请求先聚合 SSE 增量，再转换为单个 OpenAI chat.completion
    Qwen 流式请求按累计内容长度只发送新增文本，过滤 deep_think 标记
    非流式响应转换为 OpenAI chat.completion
    流式响应解析为 OpenAI chat.completion.chunk SSE
    默认不记录原始请求和响应内容
    配置 debugRawTraffic=true 后，统一 HTTP 追踪层记录每个 Provider 预处理请求和最终请求
    记录项包含 requestId、providerId、序号、脱敏 URL、方法、请求头、请求体、响应状态和响应头
    流式响应按原始块记录并继续透传给现有 SSE/gRPC 解析器，不消费或改变响应流
    Authorization、Cookie、Token、Ticket、签名、API Key、密码及同类查询参数替换为 [REDACTED]
    请求体和响应块共享 rawTrafficMaxBytes，超限停止记录并标记 truncated
    调试日志写入服务日志，追踪器异常不得改变 Provider 请求结果

createChat2ApiResponsesService(dataStore, coreAdapter):
    读取和原子保存 responses-sessions 集合
    以 conversationId 建立持久会话，以 responseId 建立响应链索引
    保存 providerId、accountId、actualModel、history、latestResponseId 和 nativeState
    为同一 conversation 串行化状态更新，避免并发请求覆盖最新 parent 标识
    返回非流式 Responses response 或 Responses SSE 事件生成器

toChatRequest(responseRequest, session):
    将 instructions 转成 system message
    将 input_text/output_text 文本转成 user、assistant、tool 消息
    将 function_call 转成 assistant tool_calls
    将 function_call_output 转成 tool 消息
    将 Responses tools 转成 Chat Completions tools

toResponsesBody(chatBody, metadata):
    生成 response.id、response.object、response.status、response.model 和 response.output
    普通 assistant 文本转为 output message 的 output_text 内容
    tool_calls 转为 function_call output item
    保留 previous_response_id、conversation、store 和可用 usage

toResponsesStream(chatStream, metadata):
    先发送 response.created
    文本增量 -> response.output_text.delta
    文本结束 -> response.output_text.done
    工具调用增量 -> 对应 function call 事件；无法识别的 Provider 增量不伪造工具参数
    流结束 -> 保存会话并发送 response.completed 和 [DONE]

forwardChatCompletion(request):
    校验 model 和 messages
    解析候选 Provider、actualModel 和账号
    读取选中账号的完整凭据，仅在内存中传给对应 Provider adapter
    adapter 返回非流式 JSON 或可读流
    Provider 失败 -> 标记账号失败并返回不含凭据的错误

listModels():
    汇总启用 Provider 和可用账号的有效模型
    转换为 OpenAI models 响应

createChat2ApiProxyService(options):
    使用 Node 原生 HTTP Server 监听 host/port
    OPTIONS -> 返回 CORS 响应
    /health -> 返回运行状态和请求统计
    /stats -> 返回请求统计
    /v1/models -> 返回模型列表
    /v1/responses -> 解析 Responses JSON、鉴权、转换并转发
    /v1/chat/completions -> 解析 JSON、鉴权并转发
    /v1/completions -> 将 prompt 转成 chat messages 后转发
    stream=true -> 设置 text/event-stream，逐块输出 data: JSON
    stop() -> 结束活动连接并关闭 HTTP Server

运行验证:
    重启主服务后访问 Chat2API 代理根路径 -> endpoints 包含 /v1/responses
    POST /v1/responses 空请求 -> 返回 invalid_request_error，而不是 not_found
    使用已配置模型发送真实非流式请求 -> 返回 response/output_text/conversation
    使用 previous_response_id 发送第二轮 -> 复用 conversation 并返回新的 response
    使用 stream=true 发送真实请求 -> 返回 Responses 增量事件和 [DONE]
```

## 原始请求/响应调试日志

```text
DEFAULT_CONFIG:
    debugRawTraffic = false
    rawTrafficMaxBytes = 262144

saveConfig(input):
    合并配置
    校验 debugRawTraffic 为布尔值
    校验 rawTrafficMaxBytes 为 1024 到 2097152 之间的整数
    原子保存 config.json

createRawTrafficLogger(sink):
    sanitize(value):
        递归复制对象和数组
        敏感字段或 URL 敏感查询参数 -> [REDACTED]
        Buffer/二进制 -> 截断后的可识别文本或 base64 摘要
    traceRequest(meta, requestConfig):
        调试关闭 -> 返回原始 HTTP 请求结果，不序列化原始数据
        调试开启 -> 输出脱敏请求记录并创建单次字节预算
        响应返回 -> 输出脱敏状态和响应头
        响应为流 -> 记录每个原始响应块后原样透传
        非流式响应 -> 记录脱敏响应体
        超出预算 -> 停止记录并标记 truncated
        日志 sink 失败 -> 忽略，不影响请求和响应

createProviderAdapter(providerId):
    读取当前 Chat2API config 的调试开关和字节预算
    用 rawTrafficLogger 包装 httpClient
    Provider 会话创建、Token 刷新、设备注册、聊天请求和详情轮询统一使用包装后的 client
    使用同一个 AASC requestId 关联同一次 OpenAI 请求产生的内部 HTTP 请求
```

## 控制端登录与 OAuth 会话

```text
startLogin(providerId):
    校验 Provider 存在且启用
    创建随机 state、Provider 绑定和过期时间
    将临时会话写入 oauth-sessions/<state>.json，权限 0600
    返回 state、expiresAt、loginUrl 和支持的凭据字段

completeLogin(state, providerId, credentials, accountInfo):
    一次性读取并删除 state 会话
    校验 state 未过期且 Provider 一致
    调用 Provider OAuth/manual adapter 验证凭据或交换 code
    生成 accountId，保存 active 账号和完整凭据
    返回脱敏账号

handleOAuthCallback(query):
    只接受已创建且未过期的 state
    Provider 绑定不一致 -> 拒绝
    code/token -> 交给对应 adapter 交换或验证
    回调重复使用 -> 拒绝

cancelLogin(state):
    删除对应临时会话，不影响已有账号

stopOAuthService():
    删除全部临时会话并关闭回调监听器
```

## 内置服务任务装配

```text
createChat2ApiRuntime(options):
    创建 dataStore、Provider registry、modelMapper、loadBalancer
    创建 OAuth service、core adapter 和 proxy service
    所有组件共享同一个数据存储和配置快照

chat2api.proxy.run(context):
    从 params 读取 host、port、enableApiKey
    创建 Chat2API runtime 并启动 proxy service
    推送运行状态、监听地址和统计到任务 widget
    注册 refresh、updateConfig、stop 等 widget action
    返回 { type: service, stop }

chat2api.proxy.stop():
    停止 OAuth 临时会话
    停止代理 HTTP Server
    清理 runtime 引用和 widget action
```

## 控制端管理服务

```text
createChat2ApiManagementService(runtime):
    getConfig/saveConfig -> 读取和保存代理配置
    listProviders/saveProvider -> Provider 元数据管理
    listAccounts -> 只返回脱敏账号
    startLogin/completeLogin/callback -> 委托 OAuth service
    listApiKeys/createApiKey -> API Key 管理，完整 key 只返回一次
    previewImport/mergeImport -> 委托 dataStore 导入流程

proxy /api/chat2api/*:
    本机控制端请求可访问管理接口
    非本机请求必须通过代理 API Key 鉴权
    账号列表、Provider 列表和 API Key 列表不返回秘密字段

proxy /api/chat2api-gateway/{instanceId}/*:
    控制端通过 AASC 当前 HTTPS 主服务访问
    校验实例为运行中的 chat2api.proxy 后转发到对应回环端口
```

## 控制端账户弹窗

```text
Chat2APIControl.open():
    获取 config/providers/accounts/api-keys
    根据代理监听地址设置管理 API base URL
    以 chat2api-modal/chat2api-dialog 等语义 class 创建账户管理弹窗
    所有表面、文字、输入控件和分隔线使用控制端主题变量
    展示 Provider 选择、已登录账号和 API Key 列表

Chat2APIControl.render():
    不写入固定深色背景、文字色或边框色内联样式
    使用 chat2api-section、chat2api-field、chat2api-list-row 等 class
    主题切换只修改根元素 data-theme，弹窗通过 CSS 变量即时更新
    模型映射列表提供新增、编辑和删除操作
    配置区显示 debugRawTraffic 开关和 rawTrafficMaxBytes 输入框

Chat2APIControl.saveModelMapping():
    校验请求模型和实际模型不能为空
    保存可选 preferredProviderId、preferredAccountId
    编辑请求模型名称时先删除旧 model，再保存新 model，避免残留旧键
    保存成功后刷新模型映射列表

chat2api.css:
    定义弹窗、配置区、账号列表、API Key、模型映射和响应式布局样式
    使用 --bg-*、--text-*、--border-color、--input-background 和语义色变量

login(providerId):
    POST oauth/start
    使用返回的 loginUrl 打开 Provider 官方登录页
    按 credentialFields 展示 Token/Cookie 输入框
    提交 oauth/complete，成功后刷新账号列表

createApiKey(label):
    POST api-keys
    将完整 key 仅展示给当前控制端一次
    后续刷新只显示掩码
```

## 管理操作补充

```text
updateAccount(accountId, patch):
    读取完整账号
    只更新 enabled、status、label、dailyLimit 等非凭据字段
    原子保存并返回脱敏账号

deleteAccount(accountId):
    删除账号凭据和 Provider 会话缓存
    返回删除结果，不返回凭据

deleteProvider(providerId):
    存在关联账号或模型映射 -> 拒绝删除并提示关联项
    无关联项 -> 删除 Provider 用户覆盖

saveModelMapping(mapping):
    校验 model、actualModel、Provider/账号引用
    原子保存并返回映射

disableApiKey(keyId) / deleteApiKey(keyId):
    更新启用状态或删除密钥哈希
    列表永远只返回掩码
```

## 上游同步

```text
syncUpstream(version):
    记录上游仓库地址、版本和许可证
    更新 3rd/chat2api-core 快照
    检查 AASC 排除清单仍未引入 Electron/Renderer 文件
    运行 npm run check:chat2api，覆盖核心协议、Provider、OAuth、鉴权和流式测试
    运行 AASC 内置任务启动/停止/重启测试
    失败 -> 不更新当前可运行版本
    成功 -> 更新 UPSTREAM.md 和版本记录
```

## 兼容与验收测试

```text
测试旧 AASC LLM profile:
    不启动 chat2api.proxy
    原有 LLM 请求和 Pi Agent 行为不变

测试内置任务:
    启动成功 -> health、models、chat completions 可访问
    重复启动 -> 拒绝或复用同一实例，不重复占用端口
    停止 -> 端口释放、SSE 关闭、OAuth state 清理
    服务器重启 -> 不残留子服务和旧路由

测试管理:
    Provider/账号/API Key 增删改查
    OAuth state 过期、错误 Provider 和重复回调
    账号轮询、失败切换、全部失败
    敏感字段脱敏和日志安全
```
