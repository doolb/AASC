# 豆包网页文字 Chat2API 与网页登录朗读 TTS 设计

## 2026-10-15 纯Node文字与自动语音账号（实施中）

用户确认doubao-chat像qwen-chat自动识别，并明确要求删除网页兼容分支；实际调用端为192.168.1.39:8081主服务器。普通LLM使用doubao，语音使用doubao-chat；文字彻底去除Chrome传输、专用网页运行配置及控制端入口。缺Node资料的旧账号明确提示正常重新登录，不读旧开关或退回页面；官网登录采集和通用账号外部网页职责保持。

语音模型已有内置Provider绑定，仅移除speech-service额外的强制映射门槛，复用现有可用账号/策略选择；显式账号严格限定，不把失败当成换号或重发机会。TTS只需要该账号Cookie，无须普通文字Node资料。已补自动选择/边界/无网页分支测试，Chat2API246/246；兼容豆包旧todayLimit与通用dailyLimit，保持秘密白名单和现有配额流程。发布code89并重启主服务器，min56与依赖10沿用。

## 2026-10-14 Node账号采集与TTS修复（用户已确认，实施中）

用户已选择同时修复。Android正常隔离登录时只采集同官网两项已知localStorage中的web_id、当前navigator.userAgent及同一Cookie的fp，组装既有nodeProfile；新登录必须取得完整资料才自动/手动完成，缺失可等待或取消。资料只由现有登录回调传到已有账号规范化保存流程，不新增配置接口、脚本下载或设备ID生成。文字推理沿用Node协议；旧账号无profile且未明确开启旧版兼容时返回补全提示，不建议网页聊天。TTS接受0/20000000成功，保持真错误拒绝和现有状态机/超时/取消/解码。

涉及login-profiles/core-adapter/speech-adapter与Android捕获/WebView/Activity及对应测试，服务包和min需发布，依赖集合不变。验收包括账号端到端保存、公开摘要脱敏、缺字段不提前完成、Node不访问浏览器及实际语音完整WAV。现有Cookie-only账号不能通过伪造身份补全；必要时由用户正常重新登录。

实现与测试已通过：新增纯采集器与嵌套回调，复用现有服务端账号规范化保存，旧账号返回补全错误；Android271项零失败、Chat2API254/254、音频34/34。真实语音进一步暴露Offline分目录Worker的ESM加载问题，已先复现再改为require.resolve定位加绝对文件URL导入；不新增依赖。修改后Android真实短句WAV163652bytes、48kHz、1704.25ms、非静音；当前进入code88/min56构建发布及正式路径复验。

## Offline保存账号真实测试（2026-10-14，发现问题，修复待确认）

用户明确授权测试当前Offline APK豆包账号的LLM与网页TTS。在min55/code87/deps10、Android Node26.4.0、同一启用Cookie-only账号下，LLM正式CoreAdapter返回503/doubao_browser_disabled，未向官方发推理；缺少Node初始化资料且网页环境未启用。TTS使用正式SpeechService的仅内存账号绑定，返回502/doubao_speech_upstream，无音频；账号与长期业务配置不变。

用户随后要求Node直连，不需要网页聊天。直接调用当前code87适配器且不注入browserTransport，Android Node实际发出短句请求：448ms，HTTP200/text-event-stream，但SSE业务结果为doubao_risk_control，映射403，无有效文字。仅表明Cookie-only直连仍遭业务风控，不能把HTTP200当成功或断言完整Node协议不可用；未打开官网网页，也未自动重试。候选方案是在正常账号登录时补齐并保存既有nodeProfile，让聊天复用已验证Node协议，旧账号缺资料明确提示补全；不伪造设备身份或换账号。原生采集若实施会同时影响min与服务包，当前尚待方案确认。

只记录事件名/数值码的真实WS诊断显示连接open、VoiceGenie TaskStarted/status=20000000；适配器现有非零状态判断误将其归为失败，尚未发StartSession。候选TTS修复仅在speech-adapter和测试中接受实际成功码20000000、兼容无状态码/0，真正错误仍拒绝，更新全链路夹具并用同一账号复验；单独TTS修复只影响服务代码包。当前尚未修改生产代码。任务：`docs/task/20261014_Offline豆包网页LLM与TTS真实测试.md`。


## 2026-10-13 豆包纯Node会话复用完成（普通模式）

用户要求像Qwen网页端一样支持会话复用。Qwen通过`/v1/responses`的`previous_response_id`或AASC `conversation`续接，服务保存账号及上游nativeState，下一轮仅传新增input。普通LLM的`llm-service.js`已有Responses引用保存及模板/模型/系统提示指纹；修改前豆包仅保存observedConversationId/observedSectionId，逐轮新建并重放历史。

已在`nodeProfile`普通模式实现Responses原生续接，不增加另一套业务会话缓存。两轮真实协议验证：首轮记住随机标记，第二轮只发回忆问题、同ACK会话且准确返回标记；断CDP后由Node发送。已验证continue使用conversation_id、空section、null index及need_create_conversation=false；不把ACK中的section_id猜成last_section_id。Cookie-only网页、think/expert暂不提升为原生续接。

新增`chat2api-doubao-session.js`集中处理版本化ready/uncertain状态，接通文字适配器、node-protocol、Responses服务、ResponseSessionStore及受限能力声明。私有nativeState只保存上游ID、账号/模式和身份摘要，不包含Cookie/token/profile；旧观测状态不直接升级。中间msg/answer结束事件不提交状态，最终正文非空并完整结束才提交。原生continue发送后失败/取消则标记uncertain，保留完成历史并要求新会话，不重发；发送前账号/身份/模式冲突不误伤ready，Pi snapshot新建失败不误伤旧上游。动态CSRF/msToken变化不等同登录身份变化。

豆包Node流式锁保持到结束/取消/超时及保存完成；未消费也主动清理。排队和执行共享原120秒预算，单会话16、全局256租约，取消排队项不能越过前任。不同会话生成并行，整个JSON集合的保存串行，避免并发丢状态；uncertain写失败时实例内阻断续接且返回固定存储错误。Qwen/其它Provider请求协议和原流式行为保持，已回归。

验收：真实协议两轮已通过，之后没有追加真实请求；正式实现通过20项新增模拟测试，覆盖增量、持久化重建、并发/取消、身份隔离、旧观测、Pi、写失败和总时限。Chat2API201/204（同3项旧Windows chmod），普通LLM/Core/Responses兼容24/24、旧TTS19/19。独立审查无重要缺陷，过时注释和排队预算两项小问题已修复。使用已有openai-responses客户端自动保存引用；无引用chat/completions保持无状态。本轮凭据仅内存、未读旧聊天、未保存原始帧、未重启主服务或出包。真实正式端、长期和设备能力不扩大声明。

## 2026-10-13 纯Node普通LLM接入完成

用户扩大授权后完成控制变量验证：完整官网请求、去a_bogus请求、Node自行构造的新会话及参考SDK桌面profile均正常返回。进一步仅保留五类Cookie及同账号device/web/fp/UA资料，断开CDP后由Node自行构造query/body，正式Provider工厂和CoreAdapter的流式、非流式均实际回复OK并正常结束；不使用页面fetch或签名。

新增账号级可选nodeProfile明确选择Node传输，固定官方网页profile与来源；旧Cookie-only账号仍走既有受控网页模式。无显式账号映射时只在Node候选池调度；显式账号不可用时拒绝，不发送后换号/切传输。公开摘要剔除整块profile，格式校验不等于登录成功。请求容量、取消、SSE正文/思考边界保持原契约。本轮未保存真实凭据、未重启主服务、未出包；普通模式已真实验证，think/expert、长期令牌维护、Android/Linux仍待验收。使用资料见[纯Node普通LLM](../usage/chat2api-doubao-node.md)。

## 2026-10-13 早期缺完整profile的Node诊断失败（历史）

用户明确另授权“使用这个会话做纯Node发送”。仅从原Chrome官方target提取当前会话标识、白名单Cookie及UserAgent到内存，断CDP后由Axios直接发送一次“请只回复：OK”；未调用页面fetch/签名函数、未复制聊天历史。诊断wrapper设置conversation_id为当前会话、local_conversation_id为空、need_create_conversation=false、sub_conv_firstmet_type=0，并使用当前UA/官方会话Referer；生产代码未修改。实际529ms、HTTP200/SSE、SSE_HEARTBEAT→STREAM_ERROR→SSE_REPLY_END，业务码718013001，无有效回复，现有适配器映射doubao_upstream_failed/502。

该码在本项目及参考SDK源码中没有专门释义，不能写成此前710022004验证码风控或声称已通过风控。原标签官网UI成功与此次同会话Node失败并存，沿用conversation_id并不足以证明Node可用；本次没有逐项复制官网query/signature/profile/user_context，不能据此否定所有纯HTTP协议。停止且不重试，凭据/会话ID/原始帧/回复正文均未保存，Chrome与原标签保持，无主服务器操作；下一步协议完善与新的真实请求仍需单独确认/授权。

## 2026-10-13 原标签真实收发成功

用户明确要求使用正在操作的原Chrome标签测试。仅连接先前核对的唯一官方target，不新建页、不导航；核对可见输入框为空后，通过现有contenteditable输入一次“请只回复：OK”。当前会话中实际POST /chat/completion，mode=0、newConversation=false、tts=false；HTTP200/SSE正常包含SSE_ACK、FULL_MSG_NOTIFY、STREAM_MSG_NOTIFY、STREAM_CHUNK及SSE_REPLY_END，无业务错误码。未保存或输出回复正文/Cookie/签名URL；临时观察与拦截状态已恢复，只断CDP，保留原标签/Chrome，未操作主服务器。

这次也由脚本操作而成功，因此不能将前次临时页失败简单归因于“所有自动化都被阻断”。已知差别之一是原标签沿用既有会话，而临时页新建会话；页面状态/参数/新会话流程差异尚未控制变量验证，不能指定唯一根因。此为官网UI原标签成功，不是本项目固定path bridge的真实验收，也不是纯Node桌面协议成功。仍需按批准范围补齐协议并单独验证，不能将成功请求中的会话ID或秘密签名复制给其它账号。

## 2026-10-13 实际官网路径与手动成功的区别

在用户新增浏览器收发/路径观察授权下，新建同一Chrome登录context的临时官方页，由脚本通过输入框发送一次“请只回复：OK”。实际POST /chat/completion，query字段包括a_bogus、msToken、aid/real_aid、device_id、fp、web_id/tea_uuid/web_tab_id、版本/平台/时区；正文包含client_meta/ext/messages/option/user_context，普通模式0、新会话、tts_switch=false。HTTP200/SSE返回SSE_HEARTBEAT、STREAM_ERROR、SSE_REPLY_END，业务码710022004，无有效回复。临时测试页已关闭，原标签和Chrome保留，未重试；只记录路径/参数名/结构及固定状态，不保存凭据/签名URL/原始帧。

用户随后说明自己在浏览器手动发送能成功。此为用户提供的成功证据，本轮没有观察那条手动成功请求；不能将脚本临时页的失败推定为账号失效或整个Chrome环境不可用。新页/已有页状态、页面初始化和自动化输入等因素尚未逐项排除，真实请求已包含安全签名字段，也不能仅以“缺a_bogus”解释失败。下一步优先比较用户原标签的手动成功请求（标签来源待用户补充），仅做已授权范围内的路径/字段结构观察，不自动重复发消息；SDK桌面profile和纯Node能否稳定成功仍独立待验证。

## 2026-10-13 脱离浏览器的Node候选方案（待确认，不改运行代码）

用户希望像其它Chat2API网页Provider一样由Node直接收发。源码核对：独立client.py正常请求链路使用aiohttp Cookie/CSRF、_security_params桌面端profile和SSE，不需要Playwright/page.evaluate；默认captcha_handler=auto的挑战处理会打开浏览器，None可关闭该分支。未发现该SDK在正常聊天路径中调用frontierSign，也未发现完整自动刷新self.ms_token的逻辑；不能据此推定服务端不校验其它状态或当前账号稳定可用。qr_login.py存在纯HTTP扫码代码，但登录端点/设备身份生成及默认设备值均未经本项目真实验收，不自动采用随机或作者设备身份。

可先做独立Node桌面协议等价实现并mock验证：新增chat2api-doubao-desktop-protocol.js及测试，复用现有请求限额、固定来源、SSE解析和错误脱敏；Cookie来自显式所选账号，设备/profile必须同账号来源且格式规范，拒绝缺字段，不复制SDK硬编码默认身份。遇风控/验证码立即失败、零自动重试，不创建浏览器。真实单请求验收需重新明确授权。只有完整回复得到确认后再把desktop-http作为明确选择的实验transport接入既有runtime/core/WS控制配置，不自动在网页与Node之间回退。

后续候选影响文件：doubao-chat-adapter及测试（传输注入/保留SSE）、data-store/credential-validators及测试（仅经用户确认的账号级设备profile白名单/导入；仍不把格式校验当登录成功）、doubao-web-config/web-ws/runtime/core及测试（显式transport、严格绑定），doubao-web-settings/self-test（只读能力、默认禁用、不要求浏览器target的Node模式）。第一阶段不修改真实账号、配置或现有网页运行模式。尚缺项是可验证的账号设备元信息来源及真实无验证码有效回复；该候选记录属于当时阶段；现在选择已验证的官网网页query profile实现Node，参见文首，不以早期失败否定现状。

> 2026-10-13参考源码进一步核对：doubao2api默认CLI进入unified_server，服务启动BrowserClient，由Playwright自行启动/维持登录浏览器，chat_completion构造带网页aid/device_id/web_id/tea_uuid/fp/版本/msToken的query，再page.evaluate内fetch，以expose_function/asyncio.Queue回传SSE；网页fetch封装自动补安全参数是其设计意图，源码的非native检查不能代替真实请求证据。另一独立DoubaoChatClient SDK使用aiohttp直连、桌面端aid/client_platform及安全参数，并有验证码处理/重试分支；服务主文字路径没有调用该SDK。其browser_client模块顶部“all actual API traffic through httpx”注释与当前聊天函数不符，解释以实际调用链为准。我们的受控桥接已有页面fetch基础，但固定/chat/completion尚未补齐参考query profile与hook就绪检查；这部分是后续协议完善范围，不应把离线接线通过写作完全复刻或生产验收。今日Node实测仅针对现有Node适配器，并未逐项复现该SDK桌面端协议。此次只读源码，未读取运行session文件、凭据或发请求，未改运行代码。

> 2026-10-13新增真实Node诊断：用户明确授权使用Chrome凭据。唯一官方豆包page的Cookie仅内存用于一次doubao普通模式“请只回复：OK”请求；HTTP200、text/event-stream，但SSE业务错误被现有适配器识别为doubao_risk_control（对外映射403），没有完整有效回复。仅说明当前账号/环境/请求路径仍遭业务风控；不把HTTP200当成功，也不推定其它路径永不可用。停止且不重试，没有网页fetch/TTS真实请求，没有保存凭据、原始帧或响应正文，未操作主服务器。既有Node HTTP403是先前独立测试记录，不能混写为本次HTTP状态。

> 2026-10-12 用户确认实施纯文字 LLM，并允许用现有 Chrome 9222 的豆包页面进行一条短测试对话和一次朗读观察。本文仅覆盖网页账号；独立的豆包 API TTS 及先前未确认的多模态统一草案均不在本轮改动范围。

> 当前实施状态：用户已批准B方案，完整Ogg校验、worker解码及Frontier/speech/TTS模拟接线均已实现；豆包网页朗读默认禁用、标为实验性，真实运行未重新验收。受控Chrome网页fetch已获独立实施确认并完成离线接线，默认关闭；真实账号/官网运行仍待另授权验收。后续最小只读授权仅用于核对公开模块协议，未读取Cookie/聊天内容，也没有新聊天或合成。
> 最终Chat2API159/162通过，3项仍为既有Windows chmod断言失败；TTS/解码/配置/浏览器回归95/95，既有播报与并发回归19/19。独立审查的总时长和权威音色回填两项问题均先RED再修复。

## 目标与边界

用户进一步询问普通LLM接入。按当前网页任务上下文，建议通过项目已有普通LLM配置调用Chat2API的文字模型doubao，而不是使用语音模型doubao-chat；llm-service已有OpenAI兼容地址/模型配置，不需要新增一条业务聊天链路。早期文字适配器和取消已实现，但当时缺完整profile的Node403；现在普通Node已按文首方案真实验证。以下为当时拟议的登录网页fetch路径：新增浏览器桥接及运行配置模块，修改doubao-chat-adapter/provider-adapters/runtime/core的注入与严格账号选择，沿用server-app/config-app-service及chat2api控制端的WS权威配置。真实页面绑定协议尚须可靠核对，核对失败不得仅因网址相同而启用；本轮不连接Chrome、不读凭据、不发真实请求，实施批准与真实验证授权分别处理。

- Chat2API 内置 `doubaochat` 文字 Provider，复用已有 API Key 鉴权、账号持久化与启停、模型列表、调度、会话和管理界面；模型 `doubao`、`doubao-think`、`doubao-expert` 是网页 `need_deep_think` 模式别名，并非三个已证实的独立上游模型。只接文字，图片、视频、音频输入和上游原生函数调用不宣称支持。
- 目标是在独立文字合成及用户选定的音频格式通过验收后新增业务 TTS Provider `doubao-chat`，与既有 `doubao-api` 和 `qwen-chat` 并存；届时仅允许 AI/Agent 回复与其模板选用。豆包网页账号 Cookie 由 Chat2API 管理，业务 TTS 配置只保存启停、受验证的网页朗读模型/音色及非秘密偏好。复用现有 `setTtsProviderConfig` 权威回传、重连补发、缓存和播报队列，不新增配置 HTTP 接口。**当前已作为默认禁用的实验选项列出；参数来自公开模块，真实账号/音色尚未重新验收。**
- `doubao2api` 的文字客户端支持 `/chat/completion`、Cookie/CSRF 和 SSE，其服务端实际使用登录网页内 fetch；其 `tts_switch` 关闭、`/v1/audio/generations` 为音乐生成，**没有可复用的网页 TTS 实现**。首次授权：官网一次短消息得到 HTTP 200、`SSE_REPLY_END`；仅针对该回复点击一次朗读，官网使用 `wss://frontier-audio-web-ws.doubao.com/api/v2/sami/voicegenie` 二进制 WebSocket。追加授权：Node 文字直连一次被 HTTP 403 风控；另一次**不创建聊天消息**的独立 Frontier 语音测试向已建立会话发送短文，服务器按 `TaskStarted→SessionStarted→TTSSentenceStart→TTSResponse×4→TTSSentenceEnd→TTSEnded` 返回约 5 KiB、带 `OggS` 起始标记的音频。未保留原始帧或凭据，未再次发消息或朗读。服务器接受独立文本已得到这一次正例，但音频完整性、音色及不同账户尚未验收。


## 文字账号与请求

- Provider 固定豆包 HTTPS 官方来源；按2026-10-14用户确认，手动/Android捕获添加经严格本地格式校验后允许保存，明确显示未远端验证；会话列表身份校验仅记录待办。现有凭证包导入仅格式校验并要求用户明确确认，不能代称登录已验证。服务端错误/日志/API 返回中不暴露 Cookie、CSRF、`msToken` 或签名参数。仅允许已确认的 Cookie 名称、合法长度与字符；自定义上游不能借网页 Provider 发送凭据到任意主机。Android自动登录已确认并实现；二维码另行确认。
- 已落地的文字模块按参考项目构造 Node 独立 HTTP 请求/SSE，但额外获授权使用 Chrome 豆包域 Cookie 在内存中仅做一次极短 Node 直连：`POST /chat/completion` 被 HTTP 403 拒绝并映射为固定 `doubao_risk_control`；未吐正文，**生产聊天并未验收通过**，不得自动再试或绕过验证码。若需采用登录网页内 fetch，须独立评估受控 CDP 实例与账号绑定；不能隐式挪用其他账号的 Chrome 标签，也不能把当前 Chrome 当成所有部署环境的必备依赖。CDP 仅允许本机指定豆包页面，断连只断调试会话、不关闭用户 Chrome。
- 账号格式严格限制为 `credentials.cookie` 中的 sessionid 与 CSRF 等已知项。安全只读身份验证端点尚未确认，**普通手动新增固定失败**；现有账号凭证包可以预览、明确确认后导入格式正确的 Cookie，但导入不代表真实登录验证或上游请求可用。这一缺口须在对用户宣布生产可用前解决。
- request/messages 映射为一轮文字网页请求；当前只证实首轮 conversationId，Responses 续聊每次创建新网页会话并重放本地文字历史，仅保留 ACK ID 供诊断，不将 `doubaochat` 加入原生续聊字段表。将来证实原生续接后才切换为仅发送本轮增量，防止双重叠加历史。SSE 区分正文、思考、会话 ACK、风控和结束；分片 UTF-8、流取消、容量与超时均有上限。非流式收集同样依赖完整结束信号，失败不当空回答成功。
- 仅返回白名单错误码和固定脱敏中文说明；验证码和风控交由用户在官网处理，不自动绕过，不借参考项目的无鉴权管理 API、Cookie 回显或任意 JS 调试接口。

## 网页朗读与业务接口

- 已完成官网已产生回复的一次真实朗读和一轮**独立短文**音频验证。公开[豆包语音 SDK](https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/chat/static/js/async/s2-doubao-speech-sdk.2fa7019ed1.js) 中 `TextTTSClient.sendBidirectionalTTS(text)` 把字符串放入 protobuf `BidirectionalTTS` 事件 `payload.text`；`TTSResponse.data` 由 Ogg Opus 解码器转 PCM 播放。经额外授权的 Node Frontier WebSocket 在空 conversation/message ID、新建任务/会话后只发送一次独立短文并得到四个音频事件和 `TTSEnded`；这是**一例独立文字合成成功**，不是对其他音色/账号和任意长度文本的保证。服务器配置 `request_type=TEXT_TTS`、24 kHz、`format=ogg_opus`；当前项目只接受/缓存/响应 WAV，Ogg 原样交给现有接口会被拒绝或错报类型。用户询问能否扩展 Ogg，已说明须同时修改音频校验、缓存后缀/MIME、HTTP speech 与播放器兼容回归；**用户后续选择并批准B，已解码为WAV并完成模拟接线**。
- 当前 Chat2API `/v1/audio/speech` 始终返回经校验的 WAV，业务缓存只接受 `.wav`、HTTP 按 `audio/wav` 发送；旧 `qwen-chat`、`QUARK_VOICE`、`MINI_MAX` 路径及默认音色必须保持。B已实施：新模型 `doubao-chat` 只接受wav响应，独立TEXT_TTS按完整句收集Ogg、确认TTSEnded并逐句校验解码，再拼为一个合法WAV。缓存仍为 `.wav`/`audio/wav`，不增加Ogg分支；旧模型语义保持。
- `doubao-chat` 业务薄层只把文本和可验证的语音参数交给 Chat2API speech service；TTS 配置不含 Cookie/账号 ID。不把 `doubao-api` 的资源 ID、`context_texts` 或密钥误发往网页登录接口；失败不切换豆包 API 或系统原生。网页不支持音色/语速/音量时 UI 不提供虚假的可调承诺，未验证的输入应拒绝或按明确固定默认处理。

## 风险与验收

- 网页协议、Cookie 生命周期和账号健康仍有风险；Node HTTP 文字直连一次遭 403 风控，不能绕过验证或宣称已可用。网页 Frontier 独立短文合成有一例成功，不能据此假设任意账号、超长文本或所有音色均可用；现有播放器与缓存尚仅支持 WAV。首次授权一条官网聊天及一次官网朗读、追加授权一次 Node 聊天及一次独立短文音频已经用完；不接管、重启主服务器进程。
- 模拟测试覆盖模型/账号隔离、流式与非流式、风控/过期/敏感字段、中文分片、续聊、取消、WAV 截断/过大及旧 Provider 回归；真实朗读必须单独标注是否成功且能否合成任意文本。优先运行 `npm run check:chat2api` 和现有 TTS 定向脚本。
- 服务端/网页改动使servicePackage=true，新增生产依赖使dependenciesPackage=true，minApk保留原true；未构建发布包、未操作主服务器或清理其它工作区改动。

## 2026-10-12 续接核查与待确认方案

### 用户选择更新：B解码为WAV

用户后续明确选择B。对外保持WAV/.wav/audio/wav，取消A的Ogg缓存/MIME及播放器扩展范围，不新增通用多格式适配层。拟固定 `ogg-opus-decoder@1.7.5`（npm只读元数据已核对；包自身unpackedSize为10,196,320字节，不等于生产依赖全集大小），普通解码器运行在Node worker_threads，不启用机器学习增强。其返回errors不为空时必须失败，不能接受库继续解码得到的部分PCM。首版只接受单声道，音频时长≤120秒、累计Float32 PCM≤32MiB，WAV含头≤16MiB；以解码器实际采样率复用既有wrapPcm/validateWav。上述界限是项目保护策略，尚未验证上游长度能力。

Chrome网页fetch方案尚待单独确认，不能把这次B选择视为启用9222或授权真实凭据访问。实施顺序及验收任务见[WAV解码实施计划](../task/20261012_豆包网页WAV解码实施计划.md)。后续用户批准B实施，解码及模拟接线已落地；Chrome运行模式后续已实现默认禁用的实验接线，真实运行未验收。

### B实施记录：校验与解码基础模块（先前阶段）

用户确认计划后新增 `src/external/tts/tts-ogg.js`、`tts-opus-decoder.js`、`tts-opus-decode-worker.js`，安装精确依赖1.7.5。Ogg验证覆盖单一serial、CRC、页序、包续接、OpusHead/Tags、四种包帧结构及BOS/EOS、120秒/16MiB界限；首版严格拒绝mapping非0、多声道、链式流、非零初始音频granule及不一致容器，不补写结束页。最多2个worker，无等待队列；按页解码并校验非空errors、Float32有限值/容量、采样率/声道和最终样本数。父线程独立校验WAV，取消/超时直到worker释放后交付前仍生效。旧 `tts-wav.js`、speech、缓存、下载MIME及播放器未改。

本地构造的静音及非静音Opus包通过真实WASM，实际48kHz输出、pre-skip/EOS裁剪及signed Q8正负增益得到验证；不是豆包账号语音或实际显示端播放验收。独立审查发现的魔数高位、跨页Tags/continued和输出增益问题分别先复现再修复；解码前将已验证音频包规范化为单包单页的内部布局，保留pre-skip/EOS，头部gain归0并在PCM阶段只应用一次原增益。首版音频包≤65024字节，超大padding拒绝；Tags仍可跨页。当前21项新增本地测试全部通过，现有TTS19/19；Chat2API147项144通过，仍为同样3项Windows chmod断言失败。发布状态servicePackage=true、dependenciesPackage=true、minApk保留原true，未出包/发布。

仅匿名读取公开SDK和官网静态资源，未读取登录态。SDK在 `TextTTSClient` 的构造参数中接收调用方auth.appkey，StartSession转发调用方sessionParams；现有可核对资料不足以确定生产鉴权和默认音色契约。当时任务3/4按资料门槛暂停。后续用户授权最小只读核对，已从公开模块T57/VgE补齐普通网页业务标识、TEXT_TTS=5、默认音色和protobuf；目前模拟接线已完成、Provider默认禁用。企业/飞书账号不支持，实际鉴权与运行仍未重新验收。Chrome fetch后续已确认实施并通过离线验证，真实请求授权仍用完。

方案阶段先检查源码/文档并更新伪代码，用户随后批准B实施。按 brainstorming 的架构方案流程审查，因为这次同时改变传输运行环境和语音格式契约。需求分析可选 standard/enterprise；沿用默认 enterprise，但音频方案未选择，先完成明确性检查，最终实现判级在用户选定后补齐。明确的落地边界是把账号绑定、页面桥接、语音状态机、音频验证和缓存契约分别下放为 L4 声明与数据流，不形成一长段条件分支。

### B接线完成与参数边界

新增chat2api-doubao-speech-protocol.js按公开SDK的protobuf字段编码并严格解析；普通网页公开业务appkey不是用户凭据。固定VoiceGenie、TEXT_TTS=5、默认音色zh_female_wenroutaozi_uranus_bigtts、上游24kHz/ogg_opus，静态查询参数来自公开模块；没有读取动态web_id/tea_uuid等身份值，其必要性与普通账号握手能力待真实验收。飞书/企业appkey不支持，不换标识重试。独立会话使用空conversation/message，不借既有回答。

speech通过已有模型映射显式指定preferredProviderId=doubaochat及preferredAccountId；调度用新增requiredAccountId严格约束，重读账号/Provider权威状态，没有可用的所选账号即失败，不换号。业务配置仍无账号/Cookie。1–1000 UTF-16字符且UTF-8≤4000字节，voice固定、speech speed=1/volume=100/wav，业务speed=0；这些是项目保护限制，不冒充上游验收能力。

Frontier仅处理当前任务，最多64句/10000事件/1MiB帧/16MiB压缩音频；要求完整句和TTSEnded，逐句验证Ogg并解码，不串接多条Ogg逻辑流。WAV必须相同采样率、单声道16位PCM，含头≤16MiB、累计音频≤120秒，总deadline≤60秒，同账号仅一任务；取消/超时关闭WS及worker，不重连或重试。HTTP speech断连复用现有取消控制器，错误只返回固定代码。

AI/Agent及模板可选“豆包网页朗读（实验）”，默认禁用；固定音色只读且目录标为待真实验收。旧Provider WAV、缓存/下载/播放器及MMD算法保持。权威配置先更新来源控件状态再回填音色，避免从豆包切回其它来源时丢失保存值。自测及目录查询不合成。实际音色、Android Node worker/WASM、显示端播放/停止/队列和MMD事件仍待设备或独立授权验收。

### 音频方案比较

| 项目 | A：仅 doubao-chat 返回完整 Ogg Opus | B：新增解码依赖转 WAV |
| --- | --- | --- |
| 外部契约 | `model=doubao-chat` 必须显式 `response_format=ogg`，`.ogg`、`audio/ogg` | 新模型返回验证过的 PCM WAV，`.wav`、`audio/wav` |
| 旧 Provider | 原模型/音色、缺省 wav、Buffer 返回值保持 | 同左 |
| 新依赖 | 不新增生产依赖，复用已有 puppeteer-core/ws | 候选固定版本 `ogg-opus-decoder`，隔离 worker、解码参数及 PCM 上限需新增验证 |
| 网页 | Chrome/Edge/Firefox具备格式支持；仍需本项目样本播放、ended、停止及下一句验收 | 沿用原 WAV 播放，仍需新模型端到端验收 |
| Safari | Safari 18.4及相应系统起新增 Ogg Opus，旧设备不能统一承诺 | 保留项目原 WAV 能力 |
| Android显示网页 | 按设备 WebView 的 `canPlayType` 和实际播放结果验收，不能仅凭 Android 版本宣称可用 | WAV格式不扩展；服务端WASM另做兼容验证 |
| Node/C#/Go显示端 | 当前播放器不具备统一 Ogg 解码路径，不列为首版支持，播放失败必须明确报告 | 消费 WAV 可减少格式影响，但仍需各实际播放路径回归；Go路径不因WAV转换自动宣称通过 |
| 发布影响 | `servicePackage=true`；原 `minApk=true` 保留，`dependenciesPackage=false` 不变 | 服务代码包及依赖包需更新；是否影响min APK取决于实际打包资源，不能预先全标记 |
| 代价 | 改 speech、缓存、下载及网页错误处理，压缩音频内存较小 | 增加解码CPU/PCM内存、worker取消及部署验证；无需扩展缓存MIME |

推荐 A 用于网页显示端优先的第一阶段；如果必须覆盖现有 Windows/Linux Node 和 C# 播放端，则选 B。两种方案都必须验证 Ogg 页/包结构、CRC、BOS/EOS、OpusHead/OpusTags、序号及任务完成；`OggS` 和 `TTSEnded` 各自都不是完整可播放文件的充分证据。24kHz是上游请求参数，Ogg Opus granule 使用48kHz单位，转WAV必须依据解码器实际输出参数。

首版建议项目保护限制为1–1000字符且UTF-8≤4000字节、60秒总时限、音频≤16MiB、同一绑定一次仅一项任务；不是已验证的上游能力保证。只接受唯一已验音色、speech `speed=1`/`volume=100`（业务速度0），未验参数明确拒绝，UI不提供无效滑条。音色实际ID和Frontier协议还须从可复核协议补齐，不能猜测或用新请求补探。B也不自动获得变速/音色能力。

### 受控网页内 fetch

- 只借鉴 `E:/ref/doubao2api/doubao2api/browser_client.py` 的实际 `chat_completion → _browser_fetch_stream` 路径：同源 POST、页面内 CSRF、`credentials: include`、流分片桥接。参考文件顶部部分说明仍声称 httpx 请求，不能作为真实调用链依据。其原始错误正文回传、无界队列、忽略非法JSON、取消evaluate而不明确取消fetch等行为不移植，也不引入stealth、手算签名或验证码绕过。
- 运行配置默认 `disabled`，显式启用 `chrome-cdp` 并选择 Chat2API `doubaochat` 账号和指定豆包 target/context；仅本机127.0.0.1:9222（端口可规范化），核对CDP实际连接地址。使用现有puppeteer-core，不启动或关闭Chrome，不借用未授权页面，也不作为Android/离线服务的默认能力。
- 现有 `LoadBalancer.selectAccount` 的 `preferredAccountId` 找不到时会回退候选，必须新增可选严格账号约束，仅网页模式使用。映射冲突、目标失效、账号变更或绑定丢失立即失败，不换号、不回退 Node。页面URL不能证明账号身份：真实绑定须另获最小凭据访问授权，在内存核对所选会话，不能导出/注入/保存Cookie；不能核对就拒绝绑定。
- 新运行参数通过AASC/WS带type消息、服务端规范化、`config.set`持久化、广播和连接补发；target/context绑定保存在内存，服务端或Chrome重连后要求重新选择及核对。账号ID属于Chat2API运行配置，不加入业务TTS设置。旧Chat2API管理HTTP继续原职责，不新增配置HTTP入口。
- 复用现有120秒/256KiB请求/8MiB流/512KiB事件/2MiB正文和SSE解析。桥接有背压；每次任务有独立AbortController，HTTP断连、迭代取消、导航和CDP失联释放当前任务。页面内部Cookie、CSRF和签名查询不跨桥接，错误只用固定白名单；不记录原始流量。403、验证码、登录失效立即停止，零自动重试。
- 网页fetch只解决文字HTTP传输，不能替代Frontier WebSocket。语音首版拟沿用已获一次独立短文正例的Node WebSocket路径，固定官方来源、严格采用显式选定的doubaochat账号；凭据只在Chat2API运行内部使用，不从Chrome导出到Node。公开模块已核对普通网页静态参数并完成模拟接线，实际鉴权/动态身份元数据必要性待验收；不改用页面WebSocket，新真实请求及凭据访问仍需另获授权。这一单例不保证所有账号或音色。

### 文件级方案对照（B相关已实施，Chrome与A部分未实施）

以下文件均相对项目根 `E:/ref/web-mediacenter`；带“新增”的文件目前不存在。

| 模块 | 文件 | 拟改动 |
| --- | --- | --- |
| 浏览器边界 | 新增 `src/apps/server/modules/chat2api/chat2api-doubao-browser-bridge.js`、`chat2api-doubao-web-runtime.js`、`chat2api-doubao-web-ws.js` 及mock测试 | 固定CDP连接、内存target/context绑定、任务桥接、取消、默认关闭及WS配置 |
| 文字复用 | 同目录 `chat2api-doubao-chat-adapter.js`、`chat2api-provider-adapters.js`、`chat2api-runtime.js` | 将body构造/SSE解析与传输分开，注入网页transport，不复制Cookie头，不改别名及历史重放 |
| 严格调度 | 同目录 `chat2api-load-balancer.js`、`chat2api-core-adapter.js` 及测试 | 可选requiredAccountId约束，绑定账号不可用立即失败；保留其他Provider原语义 |
| 配置接线 | `src/apps/server/modules/config/config-app-service.js`、`src/apps/server/boot/server-app.js`、`src/apps/web-mediacenter/ui/public/js/chat2api.js`、`websocket.js` | 权威配置保存/广播/连接补发、显式启用与账号/target选择；仅新增受控设置，不编辑真实config.json |
| 网页语音 | 新增 `src/apps/server/modules/chat2api/chat2api-doubao-speech-adapter.js` 及测试；修改 `chat2api-speech-service.js`、`chat2api-proxy-service.js` 及测试 | Frontier状态机、模型→Provider分派、受验证格式返回、HTTP断连取消；旧千问契约保持 |
| 音频公共契约 | 新增 `src/external/tts/tts-speech-audio.js`、`tts-ogg.js` 及定向测试；原 `tts-wav.js` | 按白名单格式验证；新增Ogg页/包校验，保留WAV校验；B复用WAV封装 |
| A缓存/下载 | `src/external/tts/tts-audio-cache.js`、`src/apps/server/modules/tts/tts-audio-http.js` | 显式格式元数据、`.ogg`引用和正确MIME；旧storeAudio/Base64仍默认WAV；HEAD/Range/TTL保持 |
| B解码 | 新增 `src/external/tts/tts-opus-decoder.js`、`tts-opus-decode-worker.js` 及测试；`package.json`、`package-lock.json` | 固定版本WASM解码、独立PCM/时限上限、实际采样率封装、worker可终止；不需改缓存/下载格式 |
| 业务TTS | `src/apps/server/modules/tts/tts-provider-policy.js`、`tts-provider-settings.js`、`tts-provider-registry.js`、`tts-provider-service.js`；新增 `doubao-chat-tts.js` | AI/Agent专用、默认禁用、唯一已验参数、无业务凭据或账号选择；A对象/旧Buffer兼容 |
| 控制与播放器 | `src/apps/web-mediacenter/ui/public/js/tts-provider-settings.js`、`self-test.js`、`chat.js`、`device-list.js`、`src/apps/web-mediacenter/ui/public/upload.html`、`display.html` | 新选项及固定参数提示；A在现有播放入口核对Ogg能力和错误结束；B保持WAV播放路径 |
| 回归范围 | Chat2API模块测试、`tests/tts-provider-{settings,integration,qwen-chat,ws,ui-browser}.test.js`、`tests/chat-manual-tts.test.js`、`tests/server-tts-concurrency-integration.test.js`、`tests/display-mmd-tts-actions.test.js` | 旧Provider隔离、真实格式/缓存/WS、业务/模板、播放停止及队列；mock不会访问真实Chrome |
| 文档及状态 | 本design/spec、现有task、todo、usage及changelog；`release/offline-release-status.json` | 完成项移出todo，仅保留实际未完成项；按受影响产物标记，不出包、不发布 |

MMD、其它多模态、真实配置/凭据和Android原生代码不属于上述实施范围。MMD口型现有实现读Audio时间和事件，不需改其算法，但必须回归播放错误、停止和来源切换。

### 验收分层及本轮证据

1. 实现验收：离线mock覆盖绑定/调度/取消、SSE及Frontier状态机、错误脱敏、Ogg完整性和旧WAV回归；公开许可或本地生成的样本验证播放，不用账号合成测试样本。自测只检查配置/能力，不自动发送真实请求。
2. 显示端验收：A逐一验证网页浏览器、Android WebView和MMD事件/队列；不支持的Node/C#/Go路径明确列出。B还要验证目标Node版本的WASM/worker、PCM/WAV参数和原播放路径。`canPlayType`仅作为预检，不代替实际播放。
3. 上游验收：新的网页模式、默认音色、真实账号及完整Ogg尚需独立授权；未获授权时保持“实现已mock验证、真实运行未验收”，不能宣布生产可用。授权须明确聊天/合成次数、文本、所选账号以及最小凭据访问；本轮不执行这些动作。
4. 既有验证由用户提供：Chat2API 147项中144通过，3项为修改前已有Windows chmod断言失败；断连定向43/43，TTS回归19/19。上述是初始基线；B实施后重新验证结果见本文当前状态。发布状态为servicePackage=true、dependenciesPackage=true、minApk保留原true，未出包。

参考：[Ogg Opus RFC 7845](https://www.rfc-editor.org/rfc/rfc7845.html)、[MDN容器兼容表](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers)、[WebKit Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)、[Android媒体格式](https://developer.android.com/media/platform/supported-formats)、[WASM Audio Decoders官方项目](https://github.com/eshaz/wasm-audio-decoders)。格式支持文档不等于本项目真机验证。

本地播放补充：`node --test tests/tts-provider-doubao-playback.test.js tests/display-mmd-tts-actions.test.js tests/agent-chat-tts.test.js` 22/22通过。使用本地构造Opus包经真实worker解码、现有内存缓存及隔离HTTP，GET/HEAD/Range/416、Chromium Audio实际播放/ended/停止/下一句和DisplayLipSyncAudio来源清理均验证；无上游请求或账号音频。实际MMD模型、Android及其它设备音频仍未验收。

## 普通LLM网页fetch实施结果（2026-10-12）

用户已单独确认实施，新增chat2api-doubao-web-config.js、browser-bridge.js、web-ws.js及对应测试；修改文字适配器/factory/runtime/core注入，沿用已有SSE、HTTP取消和Responses历史重放。固定doubao/think/expert别名不能通过冲突Provider映射发往其它上游；对doubaochat严格requiredAccountId，不换号/Node回退。生产Runtime默认读主服务权威doubaoWebRuntime，构造与保存不连接Chrome。

server-app复用控制消息白名单、连接初始化和广播；config.set持久化失败恢复原值。控制端新增独立doubao-web-settings.js并在账户管理中显示，未新增HTTP配置入口。端口默认9222、默认禁用，绑定accountId/targetId/contextId；显式allowSessionCheck允许运行时在所选官方标签CDP筛选sessionid、仅内存比较，页面CSRF及fetch仍在页面内，不复制Cookie到Node请求头/日志/配置。目录查询只读取官方标签元数据，无页面标题/路径/正文/凭据。

网页fetch固定同源/chat/completion、credentials:include、redirect:error。页面自身检查location.origin，主frame监听注册后复核当前origin；配置/账号指纹监控在连接前开始，读Cookie与fetch前重查授权。120秒覆盖连接、CDP创建/send/detach、身份和流；目录查询全流程≤5秒。原始流按≤64KiB拉取，单块≤512KiB、总8MiB，保留SSE字节分片；取消仅清理对应页面临时状态并断调试连接，不关闭用户标签或Chrome。

独立审查3项重要竞态（导航漏检、连接阶段授权撤销、detach挂起）均先RED后GREEN；实际隔离Chromium还复现并修正Puppeteer使用off而非Node removeListener的接线差异，contextId使用实际CDP元数据，不假定默认context为空。所有网页请求被拦截为本地HTML/SSE，假sessionid仅用于测试profile，无真实上游或用户凭据。最终Chat2API173/176（同3项Windows chmod）、TTS/解码/配置/浏览器97/97、旧播报19/19。真实官网/账号、网页think/expert及Android/设备能力仍未验收，不宣布生产可用。

## Android完成后保存与会话列表验证（2026-10-14，代码已完成、真实接口待验收）

用户要求继续此前暂缓的“请求会话列表验证登录”，并报告Android外部登录后点击完成没有进入账号列表。这次两项一起处理，未授权新的真实聊天/合成、读取现有浏览器凭据或操作主服务器。

已确定保存故障：chat2api.js的completeNativeLogin(result)在try内声明同名const result，构造保存请求体时引用result.credentials触发JavaScript暂时性死区。使用正式网页模块和虚构原生回调只读复现：请求0次、刷新0次、保留登录session，提示Cannot access 'result' before initialization。服务器OAuth和AndroidCookie捕获无需为此改写；修复网页回调命名，保存成功才清理会话并刷新列表，保存失败保留可重试状态。

原实现只校验格式且页面按Provider固定显示未验证。本次已新增独立有界只读会话验证器，网页登录/手动添加完成本地校验后执行一次；成功记录conversation-list，失败仍保存未远端验证账号并显示固定脱敏原因，不能让网络失败再次导致账号消失。原有凭证导入继续只校验格式。已有账号可通过显式“验证登录”按钮复验，不依赖重新登录或隐藏的后台循环。

2026-10-14无Cookie访问公开官网HTML/静态JS，核对当前前端采用POST /im/chain/recent_conv、PULL_RECENT_CONV_CHAIN=3200、channel=2/version=1/sequence_id；请求限制1项且not_need_message=true，不读正文，不翻页。响应列表位于downlink_body.pull_recent_conv_chain_downlink_body.cells。公开前端协议只是接线依据，不代表已获真实账号响应或身份语义验证；HTTP200、HTML跳转、任意code=0、匿名响应不能单独判定登录有效，未知结构不升级状态。

验证固定www.doubao.com官方HTTPS，最多15秒、响应512KiB，无重定向/重试；仅临时使用所选账号规范化凭据。响应标题/消息/URL/原始JSON不返回客户端、不记录或持久化，仅保存验证方法、时间、状态和固定失败码。空列表可通过结构校验，不要求用户先建立会话；仅宣称“会话列表访问已验证”，不冒充聊天/TTS可用或已验证实名身份。新增配置不走独立HTTP读写，复验端点是现有受保护账号管理下的业务操作。

需要防止失败复验留下旧成功标记、导入/更换凭据继承验证结果、请求过程中换凭据后迟到结果更新新账号；复验更新仅针对同一凭据版本。具体L4和文件范围见docs/spec/chat2api-doubao-web.md及任务20261014_豆包Android完成保存与会话列表验证。用户确认方案后已完成运行代码，账号写操作在同根目录队列中串行，验证在锁内比较规范化凭据摘要和内部revision；删除重建或相同凭据导入也拒绝迟到结果。未实际请求官网会话接口。

公开协议参考（2026-10-14匿名获取）：[官网chat页面](https://www.doubao.com/chat/)、[当前主前端脚本](https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/chat/static/js/chat.a5ff61a604.js)、[async-fallback-logics](https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/chat/static/js/async/async-fallback-logics.bc78fd2002.js)。主模块CA/CL给出cmd和direction枚举，异步模块Rms/WE给出列表请求/通用IM包装，MM给出cells访问位置；这些构建URL随官网版本变化，不作为运行时动态下载依赖。

## Android网页登录添加与后续验证方法（2026-10-14，历史首版）

用户已明确批准所有内置外部登录统一完成/取消，并允许豆包网页登录捕获后自动保存为未远端验证。Android登录和普通手动添加均采用严格Cookie本地规范化与format-only状态，允许未验证添加。Cookie仅按已确认的六名称捕获和恢复，秘密继续存credentials.cookie。

“请求豆包会话列表验证”按用户要求先记录待办，本轮不选择未确认的URL或请求参数，不实施远端会话校验。该策略不能作为已验证登录宣称；未验证账号可添加并正常显示明确状态。

历史首版的列表暂缓策略已由上述2026-10-14实现取代；原Android捕获与未验证添加已随min41/code76发布内外网，ADB顶部按钮/缺字段保留/取消返回与未验证提示通过；真实账号登录仍待用户验收。
