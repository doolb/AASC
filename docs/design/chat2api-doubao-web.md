# 豆包网页账号Node文字与朗读 TTS 设计

## 专用profile官网按钮对照（2026-10-21）

按用户要求，在DISPLAY=:1重新打开同账号独立profile的Vivaldi/CDP9224；新建官网页，通过可见输入框键入“早”并点击官网发送按钮。官网HTTP200，收到SSE_ACK、FULL_MSG_NOTIFY、STREAM_MSG_NOTIFY、STREAM_CHUNK、CHUNK_DELTA和SSE_REPLY_END，无非零业务码；页面实际显示“早呀☀️，今天打算做点什么？”。这说明该profile当前能通过官网UI聊天，不能将前次兼容请求失败当作登录失效或整个浏览器不能发送。

对照当前源码buildDoubaoRequest：正文全部键和值一致，除独立会话/消息/块ID、unique_key及两个时间戳；缺requestProfile并不等同于正文缺字段。URL存在新a_bogus，官网pc_version/doubao_pc_version=3.42.1、保存资料3.41.0，web_tab_id/msToken不同；官网Referer是本次local会话页、Accept=*/*、agw-js-conv=str, str，构造值为/chat/、text/event-stream、str；官网还带浏览器client hints、fetch metadata、x-flow-trace等。UA与Content-Type一致。浏览器与保存主站快照Cookie名称集合一致（去重28个，原快照30项），但6个值变化；sessionid不在变化集合。没有进行单变量试验，不能将某一字段定为根因。

平台区别：此前Android成功是隔离的新源码/账号/Responses实验，具有重新采集的requestProfile；Android普通Node先让WebView官网SDK处理URL/头，再Node HTTP2发送。桌面签名准备仅在注入prepareNodeRequest或Android环境时启用，当前账号没有requestProfile时直连走普通HTTP客户端；桌面兼容则在网页内fetch发送Node构造请求，并非本轮点击官网按钮的完整官网UI流程。旧运行进程和当前源码必须分开判断，不能把本轮源码字段比较冒充旧进程所有实际请求。

本轮只检查和测试，未改生产代码、未覆盖正式账号。只删除本轮新建的一个官网会话，HTTP200/status_code0确认；测试页关闭，释放本轮启动的浏览器，保留原9223和8083。抓取文件仅临时0600保存用于比较，结束后删除，不输出凭据/签名URL。下一步若修复需先确认具体生产改动方案，定位动态参数与SDK处理差异。

## 当前桌面服务复测（2026-10-21，未通过）

用户要求验证192.168.1.39当前服务，直接使用该机现有进程（2026-10-20 23:47启动）、8083 Chat2API及正式已保存账号；没有重启、更新服务或替换凭据。通过Responses发送自然消息“早”，未提供system消息；仅首轮完整成功后才发送“今天过得怎么样？”并携带previous_response_id。

直连首轮HTTP200、正文0、response.failed/doubao_upstream_failed，约848毫秒；网页任务通过现有WS创建独立实例并启动，8083主入口切入兼容模式，首轮同样HTTP200、正文0、失败，约19532毫秒。附加一次网页响应观测仍失败（约5720毫秒）：官网HTTP200，SSE_HEARTBEAT后STREAM_ERROR，error_code=710020202，无会话ACK。两模式均未完成首轮，不能声称续聊已验证。

账号没有requestProfile；Cookie摘要6项，但请求优先使用的主站/账号站快照分别30/24项。此事实不能证明Cookie缺失或签名失效，也不能将Android隔离成功外推到此运行进程。尚未确定710020202的具体拒绝原因；本轮只测试，不改生产逻辑或账号。

清理：三次临时API Key均删除；通过WS停止并删除仅本轮创建的doubao.web实例fc291d4c，9091/9224关闭，8083仍运行；Responses会话数前后176，无本轮持久化会话及已知官网新建会话ID，没有删除既有用户会话。需要后续对照当前官网人工发送样本与同机运行请求，定位拒绝原因。

## 跨新会话复用签名验证（2026-10-21，已实现）

用户询问新会话能否沿用上次签名。当前Note8/min72在独立源码、账号和Responses目录中验证：只调用一次WebView签名准备；创建两个独立官网会话，再续聊第二个会话，三次HTTP200并完整完成，正文14/15/28字。两次新建具有不同local_conversation_id，三条消息ID独立；三次Node HTTP2使用同一签名URL，最终签名年龄35511毫秒；权威会话记录为两个不同ID、ready，轮数1和2。隔离测试关闭自动补发，没有重新签名掩盖失败；只删除该两个测试官网会话，均status_code0，登录样本已自动删除，API Key为0。测试目录及新增ADB转发清理，原9222保留，未改正式账号和AASC聊天。

该证据证明当前普通模式短时跨会话复用可行，不能推出长期或其它模式有效。已将普通Node签名缓存改为同账号、同凭据摘要及同模式共享，私有文件兼容旧按会话条目；新消息/会话正文仍独立构建，不复用旧上游ID。明确失效清理同一签名关联条目并重签补发一次；用户已确认更新适配器、存储及定向测试，仅影响服务代码，原生关闭开关保持现状。已实现账号规范键及旧会话文件归并；失效按相同签名值清理别名，强制重签不删除并发新签名。定向37/37、完整348/348通过，服务包待更新。

## 会话签名重启复用（2026-10-21，已实现）

用户确认保存成功签名，APK/Node重启后对相同账号、凭据和权威会话复用。使用Chat2API私有用户目录doubao-signatures.json，128项有界、权限0600原子写；不存Cookie或消息，不进入普通配置、导出或Git。按匹配身份恢复，损坏视为未命中；失效清除并重签补发一次。持久化失败不把已成功的聊天改成失败。配置开关默认关闭，开关状态另走AASC权威配置。本地保存不能保证官网长期接受签名。配置与持久化/Responses定向40/40、完整Chat2API回归345/345、Kotlin页面复用及账号恢复3/3通过；原生和服务尚待出包部署。仅切后台不清签名；重启Node后按同一权威会话从私有文件恢复，新会话仍重新获取。

## 签名成功后关闭WebView开关（2026-10-21，已实现）

用户希望增加可选开关。拟在Chat2API控制面板新增Android直连专用“签名成功后关闭WebView”；用户已确认方案，默认关闭以保持现状。复用AASC WebSocket配置消息、config.set、权威广播及连接初始化，不增加HTTP配置接口。由主服务将动态配置传入Chat2API runtime/provider/adapter，再通过既有受限prepare IPC传给原生。

开启后仅成功prepare关闭运行时WebView，保留Cookie、设备存储和Node会话签名缓存；重签时恢复/重建页面。网页兼容fetch及外部登录页不关闭。下次成功签名时生效；缓存命中不主动加载页面。原生关闭必须在账号锁和运行租约内完成后才回复结束，防止销毁后来的请求；旧APK不具备此能力，应明确提示更新。销毁WebView不等同于终止共享登录进程或保证释放全部渲染器内存。实现需服务包及新版min APK，已确认实施；原生及服务包待构建。

## 签名后的WebView生命周期核对（2026-10-21，开关实现前）

现有Android运行时不会在生成签名后关闭WebView：结束时仅清除该请求、取消对应网页任务并释放账号租约，官网页继续在后台保留。同账号且恢复资料/登录态一致时复用页面；资料变化或登录态不符时销毁旧页并重新恢复。原生服务销毁时destroy，进程也可能被系统回收。会话签名缓存可减少SDK调用，但不等同于释放WebView内存。本次仅核对代码及补充说明，未修改生命周期逻辑。

## Android直连失败刷新签名补发一次（2026-10-21，已实现）

用户确认将此前“不自动重发”改为：Android Node签名路径发送失败，且没有输出正文或思考时，清缓存并重新向WebView生成签名，补发同一条消息一次。覆盖HTTP、SSE和网络断连；取消、本地校验、容量限制及已输出内容不补发。第二次失败按原错误返回，既有Responses失败/uncertain处理只接收最终结果。两次共用首次截止时间，签名、排队和发送均不能延长总时限。补发保留原正文、消息ID、唯一键及权威上游ID；仅签名和请求超时更新，不另建会话。收到ACK但未完成的请求可能已被官网受理；一次补发是用户明确选择的行为，不承诺官网幂等。Responses定向29/29、Chat2API完整337/337通过；本次通过注入故障验证恢复，不对真实账号故意制造风控。

## Android Node账号签名缓存（2026-10-21，已升级）

用户确认首轮经WebView官网SDK生成签名，同账号、同凭据、同AASC及上游会话续聊复用内存签名。当前Note8隔离Responses实验只生成1次签名，三轮分别14/26/10字、HTTP200且完成；第三轮距签名生成83843毫秒，同一上游ready/3轮。该证据只覆盖短时复用，无法推出永久有效；此前旧样本风控还伴随请求头等差异，不能证明单一签名复用导致风控。

内存按账号和模式限制128项，记录绑定凭据摘要；私有文件先查规范键[accountId,"mode:0"]，兼容旧按会话条目，成功后归并同账号模式记录。只复用签名URL与SDK非Cookie头，本轮Cookie、正文、时间和消息标识独立创建，上游ID仅记成功来源。新会话、同ID快照重建或普通请求没有内部AASC ID也可复用；账号/凭据/模式变化不能复用。失效时按签名值清理别名，迟到错误不能删并发新URL；无输出且原总预算允许时最多重签补发一次。签名不进入聊天nativeState、导出或日志；关闭页面开关及桌面/网页兼容保持既有行为。

## Android直连与网页兼容联合修复（2026-10-21，已实现并真机验证）

用户明确要求两条链路都修复，继续此前已列出的捕获、临时样本清理及运行时恢复方案。共用同一次官网登录成功样本：先保留流副本，规范化后仅清理对应新会话，再提交账号；当前网页UA与设备参数同步进入原子账号刷新，避免沿用电脑UA。网页运行时从账号恢复固定来源Cookie和受限设备存储，登录与运行使用互斥租约，排除Cookie清空和账号切换期间发送。保留官网JSON编码头，提供脱敏阶段错误与取消收敛。分别通过Android Node的Responses首轮/续聊验收直连与兼容，不把官网UI成功当两条链路已成功。

min71真机已通过官网样本克隆/删除/保存与关闭登录页后兼容Responses两轮。直接重用样本签名的Node首轮风控；通过CDP只截留当前WebView完整发送参数、交同设备Node HTTP/2实际联网并把结果交回Responses，HTTP200、10381字节完整SSE、14字正文完成，证明Node可发送而旧签名不可可靠重用。增补Android受限签名准备：文档开始保留fetch拦截点，官网SDK生成新签名后按当次unique_key截留参数并返回，不让WebView发送消息；随后由Node发出HTTP/2。原有兼容模式维持网页联网；桌面直连行为保持。已构建并安装min72，两种模式均通过真实Responses首轮和同会话续聊；使用隔离的最新Node源码和账号目录，正常服务仍code148，服务包待构建发布。

## 验证样本克隆后精确删除（2026-10-21，已实现并真机验证）

用户补充要求：克隆成功后删除本次创建的临时聊天。清理绑定当前登录捕获尝试，从成功的新会话请求及同次完整SSE的ACK取得唯一官网ID；原请求必须明确新建且旧会话ID为空。每次只传这个ID，禁止按标题、列表顺序或宽泛历史匹配清理。克隆资料保留内存，清理失败提示并允许重试同一ID，不创建更多聊天来重试；重试删除已不存在的本次ID实测可成功。正常业务聊天不纳入验证样本清理。

通过当前Android官网界面已核验删除协议：`POST /im/conversation/batch_del_user_conv`，`cmd=4171`、单项`conversation_id`、`delete_all=false`、`conversation_type=3`、`channel=2`、`version=1`，每次生成独立`sequence_id`。请求头必须使用实测的`Content-Type: application/json; encoding=utf-8`与`agw-js-conv: str`；普通`application/json`实际收到712012002“不支持编码类型”。官网UI删除与同源fetch重复删除均HTTP200、status_code=0/OK；新样本先验证非空完整SSE，再精确删除并返回空白聊天页。Cookie和签名未输出或保存。

`Chat2ApiAuthWebView.kt`、`Chat2ApiLoginActivity.kt`已接通提前克隆、单次样本ID及清理/失败重试，与运行时恢复联合验收通过；不扩展先前仅记录的uncertain旧会话删除任务。

## Android JS 启动路径豆包端点补齐（2026-10-21，已修复，完整链路未通过）

Note8 真机从 min66 覆盖安装 min69，并经现有更新入口切到 code148；创建 `doubao-adb-v69` 实例后再运行，实际报“Android 豆包网页服务未就绪”。JS 宿主环境只有 Android 标记，没有豆包端口/令牌；`startJsLauncher` 未调用旧原生启动路径已有的绑定逻辑。用户已确认修复：JS 启动前复用同一绑定方法，将端点通过 `OfflineLauncherSession` 交给统一环境构造，保持旧路径兼容和原有绑定生命周期。只影响 Android 原生宿主，需要新 min APK。

修复后统一环境构造接收可选端点，JS与旧启动路径均复用；Kotlin定向18/18通过。已构建并安装min70，宿主端口/令牌成对存在，创建的同一实例重新运行成功，9091健康检查和未授权IPC401通过。未发布APK，现有服务代码保持148。

外部网页登录在独立进程恢复成功，官网输入框分别发送“早”和“晚上好”，HTTP200、非空SSE完整结束，会话列表校验通过。但完成按钮仍提示需官网新会话样本，不能保存网页验证时间。真实Request/Response对象模拟证明现有观察器在请求派发、响应消费之后才克隆，丢失样本；该修复待用户确认。另发现Activity销毁会清空与运行时共享的Cookie及WebStorage，需要设计关闭后的恢复。保持登录页打开的Responses首轮仍502/doubao_upstream_failed，未进行续聊，不能宣布完整兼容模式通过。测试实例已停止，临时API Key已删除；测试不写入当前AASC聊天，凭据仅在设备私有存储使用。

## 豆包网页内置任务（2026-10-20，源码已实现，待登录验收）

`doubao.web` 服务端常驻内置任务将参考项目的浏览器内请求能力整合到 AASC。任务使用账号专用 profile，桌面连接可配置的浏览器与本机调试端口；Android 使用隔离进程 WebView。LLM 请求在已登录官网页面中生成逐次参数并执行同源 `fetch()`，经受限桥接回传同次 SSE。独立兼容 API 已覆盖普通、思考、专家聊天、图片生成与编辑、视频、音乐、图片及文件上传、文件下载地址和文件问答；复用 AASC 已有账号与任务界面，不平行保存账号。接口契约与内部构造已测试，官网当前账号和 Android 设备仍需端到端验收。

用户确认沿用此前交互：验证码由用户在官网页面手动完成，暂不自动删除官网会话，也不在请求失败后切换账号。任务停止不清理 profile 或用户历史。原项目 Apache 2.0 的来源与许可记录见 `docs/ref/doubao2api.md`。详细中文伪代码见 `.src/framework/doubao-web.md`、`.src/app/doubao-web-task.md` 和本模块 spec。媒体与文件请求使用临时官网页，流结束后关闭；聊天页按 AASC 会话复用。上传文件与生成参考图均限制体积和固定官网路径，TOS 上传主机受限。任务提供 127.0.0.1 上独立兼容 API，需现有 Chat2API API Key。

## LLM 网页兼容模式（2026-10-20，源码已实现，待登录验收）

任务运行时，豆包 LLM 在已登录官网页面内执行同源 `fetch()`。桌面服务按任务参数启动本机浏览器，使用 Chat2API 专用 profile 目录，按账号和 AASC 会话管理独立官网标签页；Android Offline 服务在外部登录隔离进程中创建常驻 WebView 服务，复用相同 Cookie 数据目录，并通过 127.0.0.1 上带随机令牌的本机桥执行请求。官网回包属于对应操作的权威结果，只有完整结束才提交 AASC 聊天状态。取消、页面导航、账号变化、浏览器断开和验证码返回固定错误；不暗中重发或切换账号。任务未运行时现有 Chat2API 仍使用原 Node HTTP 传输；任务运行且网页不可用时不会自动改走 Node。TTS 仍走现有实现。桌面浏览器名称或绝对路径、调试端口是任务参数，经现有任务控制链路下发；路径只接受受支持浏览器可执行文件，进程参数不经 shell。Android 验证需在现有外部登录页由用户处理，独立 WebView 服务随后使用更新的 Cookie；此链路仍需真机验收。

每个 AASC 会话在桌面浏览器绑定一个官网标签页；Android WebView 服务在同一隔离页面中以请求 ID 区分请求。发送时核对固定官网来源及账号身份；由当前页面生成当次签名并执行同源请求。页面桥按请求 ID 回传 SSE，解析完整回复、思考和上游会话标识；若官网协议变化则报可识别错误，不猜测答案。浏览器 profile 目录和网页 Cookie 不进入服务包、日志或公开配置；服务端仅存会话绑定和非秘密状态。桌面 profile 可在服务重启后复用，Android 数据目录由原生独立进程管理。网页 TTS 沿用现有实现，不纳入本任务。

现场使用当前已登录的 `192.168.1.39` Vivaldi 会话（本机调试端口 9223）验收时，发现官网同时存在 `www.doubao.com` 专属与 `.doubao.com` 父域的 `sessionid`。网页账号规范 Cookie 取前者，桥接层据此优先核对专属项；父域项不能让另一个账号冒用。该浏览器会话的设备资料与 AASC 已保存豆包账号不一致，因此本次只在内存中读取现场资料，未覆盖正式账号。原页面签名可生成；未带官网首轮模板的页内请求得到 HTTP 200 后仅返回 `STREAM_ERROR/710020202`。随后官网 UI 新会话发送“早”正常显示回复；被动捕获该次请求，经过现有请求模板规范化清除原消息及旧会话 ID，在内存中用同一登录页发送新的“早”，收到 HTTP 200、内容分块和 `SSE_REPLY_END`，无非零业务码。一次成功说明当前网页内发送链路在真实参数下可用；独立 profile 登录、跨轮续接、媒体/文件和 Android 真机仍需验收。完整 SSE 导入观察器曾对 UI 已显示的回复等待超时；随后另一轮官网 UI 成功回复的 CDP `loadingFinished`、完整响应正文与 `browserChatCompleted` 判定均通过，超时未稳定复现，保留现场观察而不改写导入判定。

后续仍在该登录页做临时对象验证：官网 UI 首轮样本经规范化后，正式豆包文字适配器返回两轮非空正文，第二轮沿用首轮权威上游会话 ID；一个 3 字节文本通过文件 Prepare/Apply/TOS/Commit 上传，并取得文件下载地址；图片生成返回 1 张 HTTPS 图片，音乐生成返回 1 条 HTTPS 音频。真实 Vivaldi 新标签页也通过桌面桥接的官网来源、双 Cookie 账号身份和页面签名检查。视频请求只返回空结果，没有任务 ID 或同步视频；服务端应报明确协议错误，不能把空数组当生成成功。以上测试没有替换 AASC 正式账号，也没有验证独立任务的专用 profile、Android WebView 或视频生成成功路径。

## 完整请求参数导入需求分析（2026-10-20，已实现基础链路，待现场验收）

用户确认在调试端口与 Android 外部登录中观察手动发送的官网消息。基础链路已实现：调试端口被动监听完整成功的首轮 SSE；Android 隔离 WebView 在文档开始时安装仅官网生效的 fetch 观察器；两端在保存前删掉原话、旧消息和旧会话标识。服务端对模板再次校验，同账号保存 Cookie、设备资料和模板；Node 普通首轮复制模板静态字段并重建消息及会话标识，通过 HTTP/2 发送。`msToken` 和 CSRF 从当前 Cookie 覆盖。其他逐次签名仍来自样本，长期有效性未获验证；Android 真机也尚未核对浏览器附加请求头，不能据此宣称 Node 生产聊天成功。`npm run check:chat2api` 296/296、浏览器导入测试 6/6、Android Kotlin 编译通过。

该请求样本也可用于登录能力验证，但证据应分开：同账号官网请求产生非空聊天内容并正常 `SSE_REPLY_END`，仅标记“网页聊天已验证”；服务端 Node 用导入参数在后续真实 Chat2API 请求中取得非空内容和正常结束，才标记“Node 聊天已验证”。不因 HTTP 200、请求已发出、仅 `SSE_ACK` 或网页样本成功就宣称 Node 可用。导入时不自动生成额外测试对话；验证元数据只保存来源、终态、时间和账号凭据版本，不保存样本文字或原始响应。当前“会话列表已验证”是独立的弱证据，不应覆盖聊天能力状态；凭据更新使相应验证结果失效。Android 网页终态为客户端观察结果，服务端 Node 状态以服务端实际请求为准。

用户希望豆包账号导入保存足以让 Node 按官网请求格式发送的参数；新消息由应用替换，新会话 ID 应由请求创建。当前导入仅保存六项规范 Cookie、双来源全量 Cookie 快照和设备资料；现有请求构造每轮新建 `local_conversation_id`、消息 ID 与唯一键，首轮由 `SSE_ACK` 取得权威上游会话 ID。前述两组隔离请求证明 Node 可使用当前网页参数原样发送或替换消息发送，但没有证明抓包中的逐次参数可长期复用。

实现候选是账号级受限请求模板：固定官方来源，只保存官网成功请求中经白名单验证的查询参数、浏览器请求头及与消息无关的正文配置；Cookie 仍用当前账号快照，正文消息、创建时间、消息 ID、首次本地会话 ID 和续聊上游 ID 每轮生成或由权威回执填充。`a_bogus`、追踪字段等逐次值需要明确采集/更新策略，不能仅凭一次短时成功就视为永久凭据。现有调试端口导入可被动捕获官网真实请求；Android WebView 的 `shouldInterceptRequest` 不能取得聊天 POST 正文，也不能作为最终网络头的完整来源。可在仅允许豆包官网的外部登录 WebView 中于页面脚本运行前安装受限 `fetch`/XHR 观察脚本，并将同源 `/chat/completion` 的请求数据通过专用桥接送回原生，再与 CookieManager、UA 和服务端校验组合；这只能观察网页脚本交给 fetch/XHR 的参数，浏览器后加头与脚本签名时序仍需真机核对。ADB WebView 调试协议可用于现场验证，不宜成为正式导入的依赖。项目当前未引入 AndroidX WebKit 文档起始注入组件，现有 `onPageFinished` 注入时机不足以保证捕获首次请求。待确认导入时由用户手动发送样本还是工具自动发送，以及覆盖调试端口和 Android 的范围。

## 网页参数原样重发验证（2026-10-20）

当前已登录 Vivaldi 页面发送“早”的实际 `/chat/completion` 请求经被动 CDP 在内存捕获。网页使用 HTTP/2，收到 HTTP 200、ACK、内容分块和 `SSE_REPLY_END`，没有非零业务错误码。Node 随即使用该次请求的同一 URL、实际请求头和原始正文通过 HTTP/2 重发，也收到 HTTP 200、ACK、内容分块和 `SSE_REPLY_END`，没有非零业务错误码。第二组对照中，网页发送“晚上好”并正常结束；Node 沿用其当次 URL 和头，把正文消息改为“你好”、重新生成消息/块/唯一键 ID 并更新长度，同样收到内容分块和 `SSE_REPLY_END`，没有非零业务错误码。Cookie、令牌、签名 URL 和原始正文未落盘或输出。两组正例说明 Node 能以官网参数发送有效请求，且短时替换新消息可行；未验证独立生成逐次 URL/头参数或长期复用，也未定位此前适配器失败由哪一个差异引起。后续实现需按账号使用认证资料，按请求生成动态字段并替换消息，不能长期重放捕获值。

## 当前 Node 发送复测（2026-10-20）

用户要求先核实 Node 能否发送。使用现有正式 Chat2API 账号经 `/v1/responses` 流式新会话发送“早”，HTTP 返回 200，但业务流以 `response.failed`、`doubao_upstream_failed` 结束，无有效回复。本次未修改账号、协议代码或传输方式。后续请求对齐应保留 Node 发送，按用户确认的认证资料和消息替换范围设计；不能把一次性网页请求参数当作固定凭据复用。

## 当前网页与 Node 请求头现场对照（2026-10-20）

在现有已登录 Vivaldi 页面实发“早”，被动读取 `/chat/completion` 的请求头名称和查询参数名称，未记录值；该请求 HTTP 200，未以此判断最终 SSE 成功。当前 Node 构造器用同一正式账号在内存构造首轮请求，未实际重发。共同显式头为 `accept`、`agw-js-conv`、`content-type`、`cookie`、`origin`、`referer`、`user-agent`。网页额外有 `last-event-id`、`x-flow-trace`、`accept-language`、`sec-ch-ua`、`sec-ch-ua-mobile`、`sec-ch-ua-platform`、`sec-fetch-dest`、`sec-fetch-mode`、`sec-fetch-site`；还有浏览器/HTTP2层的 `:authority`、`:method`、`:path`、`:scheme`、`priority`、`content-length`、`accept-encoding`。Node Axios/HTTP栈也可能自行加长度或编码头，本次仅比较应用显式构造，不能把传输层差异都归因为缺字段。当前普通首轮 Node 不发送独立 `x-tt-passport-csrf-token`；该头只在非普通首轮分支显式添加。网页查询参数比 Node 多 `a_bogus`，两者均包含当次 `msToken` 与 `tz_name`。上述差异尚未证明单一故障原因。

## 正式账号删除重导复测（2026-10-20）

按用户要求，使用当前已登录 Vivaldi 官网页重新采集两个来源的完整 Cookie 和同页 Node 资料；在核对其指纹与原正式账号一致后，删除原豆包账号，再通过现有 OAuth 登录保存接口指定原账号 ID 导入。删除时豆包账号数为 0，重导后为 1；另外三个 Provider 的账号 ID 均未变化。新凭据包含 `www` 30 项和 `accounts` 24 项 Cookie，Node 资料保留。正式 Responses 新会话“早”最终仍返回 `response.failed`/`doubao_upstream_failed`，因此账号记录重建本身没有解决 Node 请求失败。

## 调试端口保存正式网页登录凭据（2026-10-20）

增加本机命令 `npm run save:chat2api-browser -- doubao|qwen`，默认连接 `127.0.0.1:9222`，从已登录官网页采集登录资料并保存到现有 Chat2API。账号按 Provider 自动选择：没有则按现有 OAuth 登录路径新建，只有一个则更新，多个则明确报错。豆包已有账号沿用外部网页完成时的一次性刷新接口及账号版本检查；千问沿用 OAuth ticket 校验与保存。浏览器未打开对应页面时在调试浏览器打开官网并等待用户完成登录。仅访问固定官网来源和本机管理接口，不记录秘密，不生成可导出的凭据文件。调试端口和本机 Chat2API 地址可选覆盖，以便使用已打开的浏览器或非默认实例。正式豆包账号保存后已核对双来源快照和原 Node 资料；独立 Responses “早”仍以 `doubao_upstream_failed` 结束，上游差异待继续排查。

## 新会话首轮协议与 Cookie 快照（2026-10-20）

当前官网 Vivaldi 首轮请求与 Node 构造曾在同账号“早”上分别取得回复和 403。按用户确认，普通豆包模型的新会话首轮采用官网当次请求可稳定表达的正文结构：单条用户文字直接发送原文，`client_meta.local_permissions`、`option` 的模型/聚合/恢复字段、`ext` 和空 `user_context` 按现场结构构造，创建时间使用当前时间。Node 查询增加运行时区；真实 `msToken` 只从当前 Cookie 或同账号 profile 读取。逐次生成的 `a_bogus` 和浏览器追踪头不保存旧值。

账号新增固定 `www.doubao.com` 与 `accounts.doubao.com` 的 Cookie 快照，限制来源、名称、值、数量和容量。Android 新登录随规范六项 Cookie 保存两个来源快照；已存账号外部网页点击“完成”时用消费后一次性令牌和账号凭据版本更新原账号，失败不覆盖原资料。Node 聊天只使用 `www` 快照；没有快照的旧账号继续使用原规范 Cookie。网页恢复按来源映射；Android CookieManager 不提供原 Path/Domain 属性，同名 Cookie 仅恢复首项，完整请求头顺序仍保存在 Node 快照。不向公开账号列表、日志或错误文本暴露秘密。

隔离 Responses 实测新代码收到官网 HTTP 200，但 SSE 报业务码 `710020202`，被代理按既有规则映射为 `doubao_upstream_failed`/502；官网 Vivaldi 同账号首轮正常回复。此结果说明静态字段与完整 Cookie 对齐仍不足以保证纯 Node 首轮可用，后续需继续核对动态浏览器生成字段或官网协议变化。续聊构造保持原已验证分支。

## 第三档现场错误排查（2026-10-19，待错误样本）

用户报告第三档仍报错。本机当前 Chat2API 代理上，`doubao-expert` 新会话的 Chat Completions 非流式/流式、Responses 新会话及两轮续接均取得正文；隔离用户数据的常规 LLM 服务链路中，轻量切第三档的非流式和流式请求也成功。直接对 Responses 强制沿用轻量档 `previous_response_id` 切第三档会返回 `doubao_session_conflict`（409），但常规 LLM 链路以模型名为会话指纹，切档后重建上游引用，故不能将该 409 直接认定为用户看到的错误。待取得用户实际错误码、请求文本和是否为旧会话，再决定是否修改协议或解析器。

豆包三档名称和实际请求目标由 `chat2api-default-model-mappings.js` 中各自的声明处理：档位定义只保存当前 LLM 模型名，Chat2API 默认映射决定实际目标。轻量 `doubao`、普通 `doubao-think` 分别保留在当前 LLM 配置中，便于两端按名称回显；默认目标均为 `doubao`，使用已验证的思考 0。Provider 注册表的豆包内置映射由该默认表生成，避免同名内置规则覆盖默认目标；用户显式自定义映射仍优先。

## 普通与专业档回复解析修复（2026-10-19，源码完成）

当前豆包账号实测：`doubao-think` 和 `doubao-expert` 均收到 HTTP 200、完整 SSE 结束，但旧解析器返回 `doubao_empty_response`（502）。官网思考流先发送 `10040` 思考块，再在同一 `block_id` 上以 `is_finish=true` 关闭思考；旧解析器只在第二个不同的 `10040` 块出现时才切到正文，导致答案增量全部被归入 `reasoning_content`。修复后同块完成标记结束思考，后续新文字块归正文；已出现的文字块通道保持固定。旧的两个不同边界块形式继续兼容，缺少明确思考结束且无正文时仍报错，避免把思考内容作为回答。

用当前账号再次发送短句，普通档返回非空正文 4 字、专业档返回非空正文 23 字且思考内容单独保留 326 字；两次均正常结束。源码与定向回归完成，本机服务已通过现有重启脚本加载新代码并恢复 HTTP 响应；控制端、显示端和 Offline APK/ADB 界面仍需现场验收。
## 外部网页完成后刷新豆包 Cookie（2026-10-19，待方案确认）

2026-10-20 现场对照：在 `DISPLAY=:1` 的 Vivaldi 中，从 Chat2API 已保存账号的外部网页恢复接口取得固定 `www` 与 `accounts` 来源映射并写入浏览器，共 10 项，逐项验证恢复成功。官网随后进入已登录聊天页；新对话只发送“早”，收到正常回复。回复后这 10 项与账号保存值仍逐项一致，浏览器在两个来源共有 33 条 Cookie。紧接着用同一保存账号经本机 Chat2API Responses 在 Node 单次发送“早”，仍返回 `doubao_risk_control`（403），无回复正文；网页成功不能归因于六项规范 Cookie 自动更新，也不能据此确定额外 Cookie 或浏览器环境哪项造成 Node 差异。本次未回写 Chat2API 账号、未改变 Android 完成按钮行为。

同日追加捕获同账号官网“新对话”首轮发送“早”：浏览器与 Node 都是 `POST https://www.doubao.com/chat/completion`，正文都标记新建会话，浏览器 HTTP 200、Node 403。浏览器 URL 比当前 Node 构造多 `a_bogus`、`msToken`、`tz_name` 查询参数；浏览器请求有约 29 条 Cookie，Node 账号请求仅携带 5 项；浏览器还有 `x-flow-trace`、浏览器 `sec-*` 等头，Node 则发送独立 CSRF 头。正文方面，浏览器有 `user_context`、`model_config` 等字段且使用实际创建时间；Node 有 `chat_ability`，创建时间为 0，并设置 `answer_with_suggest=true`、内容块 `is_finish`/`patch_type`。这是协议差异清单，不能单独据此判定哪项导致风控；不复制动态签名、不在日志保留字段值。

用户指出“请只回复测试 OK/测试成功”这类固定测试指令可能被上游视为脚本行为。现有两次该类短句 403 与两次自然问候“早”成功相符，但请求时间和会话状态也不同，尚无单变量证据；后续现场探测使用自然对话内容，记录新建/续接、时间和结果，避免把此假设写成确定风控规则。

进一步按用户要求测试同一上游会话续接：通过豆包最近会话接口定位刚才“早”→“早呀☀️”的首项会话，确认创建时间在 15 分钟内且消息含此前回复；构造同账号的 ready Node 状态，向该会话仅发送“早”。适配器核对上游 ACK 会话 ID 一致，返回“早安～今天也要顺顺利利✨”，4 个流分块、`stop` 正常结束。此次为一次真实续接，不改变控制端本地历史或已有自动会话流程；与此前新会话测试指令短句 403 并存，仍不能确定风控触发条件。

删除重导后的追加 Node 实测：以同一账号发全新会话，用户消息仅为“早”，收到 4 个流分块、回复“早呀☀️”，以 `stop` 正常结束。此前以测试指令短句发出的新会话曾返回 `doubao_risk_control`（403）。现有证据只表明此账号的 Node 文字通路并非持续不可用，不能凭两种不同时间和文字的单次结果确定风控由特定措辞触发；外部网页完成按钮自动回存需求不变。

按用户要求进一步删除现有 Chat2API 豆包网页账号后重新导入：删除时豆包账号数确认为 0，再从当前 Vivaldi 官方页面捕获受支持 Cookie，并把原账号的同设备 `nodeProfile` 作为导入资料，通过现有 OAuth 完成入口恢复原账号 ID。导入后豆包账号数为 1，其他 Provider 账号总数不变，只读登录验证为通过。Node 全新文字请求仍在正文前返回 `doubao_risk_control`（403）。本次只删除并重建豆包账号记录，不删除控制端聊天历史或其他 Provider 数据；结果进一步说明账号记录重建不是当前文字端点风控的充分解决办法。

同日按用户要求做了一次现有外部登录账号保存流程的现场试验：从当前 Vivaldi 官方页面读取受支持的 Cookie，沿用原账号 `nodeProfile`，经 Chat2API `/oauth/start` → `/oauth/complete` 指定原账号保存。豆包账号数维持 1，账号 ID 不变，规范 Cookie 与入库前相同；登录只读验证显示通过。随后用该账号的 Node 文字适配器发全新短句，仍在正文前收到 `doubao_risk_control`（403）。这说明现有登录保存通路可更新原账号，但保存通过和只读验证通过均不代表文字聊天通过。此次为在本机调用已有保存接口的操作验证，Android“打开外部网页”完成按钮仍不会自动回存页面 Cookie；拟议功能保持待确认。

现有“打开外部网页”只把账号已有的六项 Cookie 恢复到 Android 隔离 WebView；顶部“完成”只关闭窗口，不回存页面后来更新的 Cookie。新增登录捕获也按同一六项白名单保存。现场将已保存资料移入 Vivaldi 后出现图片拖动验证；人工完成后网页一次聊天收到回复分块和正常结束。验证使浏览器若干原有 Cookie 更新，并增加了其他同源 Cookie。Node 用原保存资料、更新后的六项、以及完整当前浏览器 Cookie 三种方式请求仍均为 `doubao_risk_control`（403）；另一次真实浏览器请求可见 `a_bogus`、额外请求字段并返回 `STREAM_ERROR`。因此全量 Cookie 是会话快照完整性需求，不能单独宣称修复 Node 风控。

拟让已保存账号的外部网页窗口在用户点击“完成”后读取当前官方 `www` 和认证子域各自适用的 Cookie，并在不输出值的前提下回写原账号。保留当前六项规范 Cookie 和 `nodeProfile` 供身份绑定；另以按来源分开的受限快照保存网页实际适用的 Cookie，避免把某来源的全部字段无区别复制到另一来源。刷新使用一次性会话和账号版本校验，失败保留旧资料。网页恢复按原来源设置 Cookie；Node 文字请求可使用 `www` 快照，但是否可通仍需独立验收。只接受固定豆包来源、合法 Cookie 名值和明确容量上限；不保存按请求变化的 `a_bogus`，不把 Cookie 值写入日志、错误或自测产物。

## 当前TTS并发机制（2026-10-16，源码完成待出包）

在线聊天/Agent/手动回复分句不再限制生成并发，只保持原序交付；豆包实际上游入口按资料根目录与账号共享额度，默认3，可在现有控制端语音设置配置1～8。原历史单路方案已被取代。上游音频收齐即释放额度，本地仍两个Opus Worker，增加256项/64MiB有界等待；本地队列满按busy返回，不误判账号失败。未改变鉴权、音色、音频完整性或已有播放协议；尚未真实官网三路验收或发布。配置与装配见tts-providers设计和20261016_豆包ChatTTS上游并发配置任务。

## 当前音色接入（2026-10-15）

已接入官网实显94项（女32/男62）、独立JSON、动态speaker、只读目录API、显示端方式/音色快选及回复重播。当前以[音色快选设计](doubao-chat-voice-selection.md)为准；下方目录调查及单音色限制是实施前记录，94项逐一真实合成仍待验收。

当前行为以2026-10-15完成段为准；下方注明日期的旧网页桥/候选方案只供历史对照，不属于当前运行实现。

## 官网声音目录与选择存储核查（2026-10-15，仅调研）

获取操作、接口参数、范围区分及保存校验统一记录在[豆包官网音色列表获取方式](../ref/doubao-web-voice-fetch.md)，通过`docs/ref.md`索引。当前以网页实际五分类94项为所需目录；推荐30项按id和style_id核对均属于后四类并集，没有推荐独有项。此文档整理不实现动态音色接入。

按用户追加要求提供男女两组整理版：角色/口音按原始`tags`的唯一性别标签并入女声32项、男声62项，总94项不变；先保留原男女分类顺序再追加角色/口音，保留`source_categories`及`recommended`。全部94项性别无缺失或冲突，未猜测性别。结果为`docs/ref/doubao-web-gender-voices-20261015.md/json`，不改变官网原始分类快照或项目运行音色。

- 通过用户指定的 Chrome 9222 连接现有豆包“声音选择”页面，切换分类捕获 `POST https://www.doubao.com/alice/user_voice/recommend`。女声首批请求为 `{"page_index":1,"page_size":30,"recommend_type":10,"tab_key":"female"}`；HTTP 200、`code=0`，`data.ugc_voice_list` 返回30项，`data.has_more=true`，不是完整目录总数。
- 分类来自官网当前前端：推荐使用 `recommend_type=1`、省略 `tab_key`；女声、男声、角色、口音使用 `recommend_type=10`，`tab_key` 分别为 `female/male/characters/accent`。后续页递增 `page_index`；官网页面过滤 `style_id` 以 `BV` 开头的条目。
- 列表项含 `id/name/style_id/icon/preview/tag_list`；没有名为 `ttsid` 的字段。官网朗读传入 `speaker=currentVoice.style_id`，因此项目如需保存合成音色标识，应保留 `style_id`，而不是只保存数字 `id`；数字ID按字符串处理。
- 当前选中音色保存在浏览器 IndexedDB：数据库 `samantha-web`、对象仓库 `store`、键 `default-chat-voice-store`、值 `state.currentVoice`，含 `id/name/style_id/pitch/speechRate`。当前样本为可爱女生，`style_id=ICL_49240bb7f5ac`。官网确定回调更新该本地持久化store；本轮没有更换或确认音色，不据此承诺跨设备云同步。
- 以当前会话Cookie在内存中执行一次纯Node只读目录请求，裸接口URL、不带签名查询参数，同样HTTP 200、`code=0`、30项。只证明当前会话该目录接口可用；不等于无登录可用、其他环境可用或全部音色合成通过。未保存Cookie、令牌、签名URL或账号资料。
- 已核对音色：温柔桃子升级版 `zh_female_wenroutaozi_uranus_bigtts`、经典版 `zh_female_wenroutaozi_v2_mars_bigtts`、磁性俊宇升级版 `zh_male_cixingjunyu_uranus_bigtts`、阳光甜妹升级版 `zh_female_yangguangtianmei_uranus_bigtts`、可爱女生 `ICL_49240bb7f5ac`。
- 同日按用户追加要求读取五分类全部分页，31次请求均HTTP200/code0，各分类最终`has_more=false`。推荐13页385项、女声5页142项、男声7页182项、角色4页108项、口音2页45项；分类间有重复，按字符串id合并后385项、373个独立style_id。官网可见316项，另69项BV前缀被前端过滤，导出仍保留并标注，避免丢失接口返回条目。
- 完整结果保存为 `docs/ref/doubao-voice-catalog-20261015.md` 与同名 `.json`，包含名称、id、style_id、标签、所属分类及官网显示标记；JSON另保留分页计数与终止证据，不保存头像/预览的签名地址或登录资料。范围仅为当前账号可访问的这五分类目录，不承诺未公开/其他账号专属音色或全部音色可合成。
- 上一轮按BV规则过滤全量分页候选，导出 `docs/ref/doubao-web-visible-voices-20261015.md` 与同名JSON：316项、304个style_id，推荐316/女声113/男声147/角色97/口音39。此数据仅为满足过滤规则的全部分页候选，不代表官网当前实际加载列表；文件名保留以兼容既有引用，范围说明已更正。
- 用户指出女声界面止于桂乡甜妞后，直接核对当前Chrome实际27张卡片及前端源码：第一页30项过滤3项BV后为27项，最后为桂乡甜妞。分页scroll监听绑定`speaker-list`，但该元素`overflow=visible`、clientHeight=scrollHeight=1971；真正滚动的是外层`overflow=auto`容器（高257、scrollHeight=2047）。内层没有滚动区，解释了页面停在第一页，不能把接口后续分页称为界面实显。
- 按本次限定仅导出女声实际27项，保持DOM顺序，保存 `docs/ref/doubao-web-female-current-20261015.md` 及同名JSON；含名称、id、style_id、标签，已核对数量、无BV、ID唯一、末项桂乡甜妞及文件往返一致。获取同范围时只取female第1页再过滤BV，不追has_more；没有修改官网或项目功能代码，没有确认/试听音色。
- 按后续“其他分类也一样”要求，逐一切换官网五分类并直接读取当前实际DOM，按各分类原顺序导出 `docs/ref/doubao-web-ui-voices-20261015.md` 及同名JSON，作为当前所需目录。推荐30项末项青涩沐阳；女声27项末项桂乡甜妞；男声29项末项暖阳阿晨；角色26项末项清朗公子；口音25项末项虎子的声音。合并去重94个id、94个style_id；女声与上一轮27项逐字段一致。未滚动追加接口分页，未点击音色/确定或试听；完成后恢复原分类。
- 项目生产实现仍固定 `DOUBAO_SPEECH_VOICE`；本轮只记录接口及存储证据，没有实现目录接入、动态音色配置或多音色合成自测，不改变Offline产物状态。

完成：最终code92/min56/deps10已发布，主服务器重启健康，手机通过原生热更新入口健康提交code92。豆包同账号跨批次FIFO已启用，完整上游音频到达即交接，WAV解码不占执行权；两端同时提交三批真实TTS均成功。Android账号重登后Node资料完整，两轮Responses流式原生续接和TTS已通过；主服务器仍为Cookie-only资料，须在其账号管理中另行登录，详见对应task。

## 豆包外部网页恢复缺少认证子域（2026-10-15，已完成code95发布）

用户指定ADB已有“千问的年龄与定位”会话。IM读取均status_code=0且4条消息显示，真正的“非法请求”toast来自恢复窗口初始化期间；认证调用发往accounts.doubao.com，但现有恢复只给www设置host-only sessionid，认证子域缺该Cookie，心跳401/账号信息13。隔离窗口临时把同账号白名单Cookie补到accounts后，心跳0、账号信息success、toast消失，消息保持；部分安全SDK2035仍存在，不承诺全部Passport能力。

已确认仅修改login-profiles和account-web-session-service及测试：为豆包显式声明www/accounts两个固定官方恢复来源，Cookie集合映射遵守来源交集和既有六名称白名单，其它Provider默认单来源兼容。Android现有解析/恢复数组可直接处理，不改原生或Node对话；服务包更新即可。设备存储缺恢复是另一个观察，未证明是此提示根因，本次不混改。已完成定向10/10和Chat2API257/257。主服务器重启健康，min56手机原生热更新code95后，正常外部网页入口首次即有accounts sessionid，心跳0/0、信息success，指定4条消息及IM读取正常、无非法请求；刷新仍通过，没有临时注入或新聊天。保留部分安全SDK2035不在全站成功声明内。完整脱敏证据与验收见`docs/task/20261015_豆包外部网页非法请求定位.md`。

## 2026-10-15 Android重登后真实验收（已完成）

Android min56/code92/deps10现有启用豆包账号的nodeProfile已存在，并通过Cookie/fp一致性等既有校验；主服务器账号库仍只有Cookie，未发起其文字测试，未复制账号资料。使用Android安装代码的正式Runtime/ResponsesService，模型doubao、stream=true，临时内存会话隔离已有Responses记录；首轮“好的。”6282ms，第二轮通过previous_response_id原生续接、准确回复“荔枝”4489ms，两轮均response.completed。HTTP观测确认Node直连且第二轮need_create_conversation=false，无浏览器或映射覆盖。

同账号doubao-chat正式SpeechService返回253112bytes、48kHz非静音WAV，2409ms，无播放。首组“口令”记忆测试第二轮模型拒答，但流和原生续接均成功；改用普通水果偏好后记忆断言通过，未改代码或触发风控重试。此验收不覆盖think/expert、长期令牌维护、多账号或设备听感；生产代码及发布产物保持，无需重新出包。

## 豆包TTS跨批次账号队列（2026-10-15，已完成code92发布）

用户要求继续此前暂缓的跨批次排队。方案为在同一豆包适配器实例内按accountId维护有界FIFO，替换busy立即拒绝；同账号仅在上游音频生成期间串行；收到完整TTSEnded音频并清理WS后立即交接，WAV解码与下一条上游请求可并行，不同账号继续并行。等待共享原deadline，取消/超时移除等待项，成功/失败/取消均释放执行权。每账号最多16个等待项、实例最多256个等待项；满队列提示稍后重试，排队本地失败不记账号上游失败。保持现有单批次分句单路，Qwen/API保持现有规则；不提供跨进程锁。

具体文件、伪代码、测试和发布范围见`docs/task/20261015_豆包TTS跨批次账号队列.md`；用户已确认并完成；Chat2API254/254、音频36/36、分句20/20。主服务器/Android各三批真实TTS成功，同账号最大上游连接1；无播放，音色听感不在此次验收。


## 2026-10-15 分句并发临时降低（历史决策；批次内单路仍保持）

真实日志的busy来自豆包适配器本地同账号单任务限制，没有此次上游并发拒绝证据。用户选择“暂时只降低分句并发”，不实施账号队列。现有tts.device=display会按显示端CPU回报开启两路，即使业务Provider已改为豆包远端TTS；调度入口应按本批次权威业务/模板解析实际Provider，豆包网页TTS使用单路，其余Provider沿用既有server/display规则。所有Chat/Agent/手动回复入口传同样业务和模板，保持播放顺序与当前取消/超时。

此临时修复当时只约束同一批次；跨批次busy问题现已由上方code92账号队列解决。对应任务20261015_豆包分句临时串行，服务代码需code90，APK/依赖沿用。

## 2026-10-15 纯Node文字与自动语音账号（已完成code90发布）

用户确认doubao-chat像qwen-chat自动识别，并明确要求删除网页兼容分支；实际调用端为192.168.1.39:8081主服务器。普通LLM使用doubao，语音使用doubao-chat；文字彻底去除Chrome传输、专用网页运行配置及控制端入口。缺Node资料的旧账号明确提示正常重新登录，不读旧开关或退回页面；官网登录采集和通用账号外部网页职责保持。

语音模型已有内置Provider绑定，仅移除speech-service额外的强制映射门槛，复用现有可用账号/策略选择；显式账号严格限定，不把失败当成换号或重发机会。TTS只需要该账号Cookie，无须普通文字Node资料。已补自动选择/边界/无网页分支测试，Chat2API246/246；兼容豆包旧todayLimit与通用dailyLimit，保持秘密白名单和现有配额流程。发布code89并重启主服务器，min56与依赖10沿用。

## 2026-10-14 Node账号采集与TTS修复（已完成min56/code90发布）

用户已选择同时修复。Android正常隔离登录时只采集同官网两项已知localStorage中的web_id、当前navigator.userAgent及同一Cookie的fp，组装既有nodeProfile；新登录必须取得完整资料才自动/手动完成，缺失可等待或取消。资料只由现有登录回调传到已有账号规范化保存流程，不新增配置接口、脚本下载或设备ID生成。文字推理沿用Node协议；旧账号无profile且未明确开启旧版兼容时返回补全提示，不建议网页聊天。TTS接受0/20000000成功，保持真错误拒绝和现有状态机/超时/取消/解码。

涉及login-profiles/core-adapter/speech-adapter与Android捕获/WebView/Activity及对应测试，服务包和min需发布，依赖集合不变。验收包括账号端到端保存、公开摘要脱敏、缺字段不提前完成、Node不访问浏览器及实际语音完整WAV。现有Cookie-only账号不能通过伪造身份补全；必要时由用户正常重新登录。

实现与测试已通过：新增纯采集器与嵌套回调，复用现有服务端账号规范化保存，旧账号返回补全错误；Android271项零失败、Chat2API254/254、音频34/34。真实语音进一步暴露Offline分目录Worker的ESM加载问题，已先复现再改为require.resolve定位加绝对文件URL导入；不新增依赖。修改后Android真实短句WAV163652bytes、48kHz、1704.25ms、非静音；当前进入code88/min56构建发布及正式路径复验。

## Offline保存账号修复前定位（2026-10-14，历史记录）

用户明确授权测试当前Offline APK豆包账号的LLM与网页TTS。在min55/code87/deps10、Android Node26.4.0、同一启用Cookie-only账号下，LLM正式CoreAdapter返回503/doubao_browser_disabled，未向官方发推理；缺少Node初始化资料且网页环境未启用。TTS使用正式SpeechService的仅内存账号绑定，返回502/doubao_speech_upstream，无音频；账号与长期业务配置不变。

用户随后要求Node直连，不需要网页聊天。直接调用当前code87适配器且不注入browserTransport，Android Node实际发出短句请求：448ms，HTTP200/text-event-stream，但SSE业务结果为doubao_risk_control，映射403，无有效文字。仅表明Cookie-only直连仍遭业务风控，不能把HTTP200当成功或断言完整Node协议不可用；未打开官网网页，也未自动重试。候选方案是在正常账号登录时补齐并保存既有nodeProfile，让聊天复用已验证Node协议，旧账号缺资料明确提示补全；不伪造设备身份或换账号。原生采集若实施会同时影响min与服务包，当前尚待方案确认。

只记录事件名/数值码的真实WS诊断显示连接open、VoiceGenie TaskStarted/status=20000000；适配器现有非零状态判断误将其归为失败，尚未发StartSession。候选TTS修复仅在speech-adapter和测试中接受实际成功码20000000、兼容无状态码/0，真正错误仍拒绝，更新全链路夹具并用同一账号复验；单独TTS修复只影响服务代码包。该定位阶段尚未修改生产代码，后续已完成修复。任务：`docs/task/20261014_Offline豆包网页LLM与TTS真实测试.md`。


## 2026-10-13 豆包纯Node会话复用完成（普通模式）

用户要求像Qwen网页端一样支持会话复用。Qwen通过`/v1/responses`的`previous_response_id`或AASC `conversation`续接，服务保存账号及上游nativeState，下一轮仅传新增input。普通LLM的`llm-service.js`已有Responses引用保存及模板/模型/系统提示指纹；修改前豆包仅保存observedConversationId/observedSectionId，逐轮新建并重放历史。

已在`nodeProfile`普通模式实现Responses原生续接，不增加另一套业务会话缓存。两轮真实协议验证：首轮记住随机标记，第二轮只发回忆问题、同ACK会话且准确返回标记；断CDP后由Node发送。已验证continue使用conversation_id、空section、null index及need_create_conversation=false；不把ACK中的section_id猜成last_section_id。Cookie-only网页、think/expert暂不提升为原生续接。

新增`chat2api-doubao-session.js`集中处理版本化ready/uncertain状态，接通文字适配器、node-protocol、Responses服务、ResponseSessionStore及受限能力声明。私有nativeState只保存上游ID、账号/模式和身份摘要，不包含Cookie/token/profile；旧观测状态不直接升级。中间msg/answer结束事件不提交状态，最终正文非空并完整结束才提交。原生continue发送后失败/取消则标记uncertain，保留完成历史并要求新会话，不重发；发送前账号/身份/模式冲突不误伤ready，Pi snapshot新建失败不误伤旧上游。动态CSRF/msToken变化不等同登录身份变化。

豆包Node流式锁保持到结束/取消/超时及保存完成；未消费也主动清理。排队和执行共享原120秒预算，单会话16、全局256租约，取消排队项不能越过前任。不同会话生成并行，整个JSON集合的保存串行，避免并发丢状态；uncertain写失败时实例内阻断续接且返回固定存储错误。Qwen/其它Provider请求协议和原流式行为保持，已回归。

验收：真实协议两轮已通过，之后没有追加真实请求；正式实现通过20项新增模拟测试，覆盖增量、持久化重建、并发/取消、身份隔离、旧观测、Pi、写失败和总时限。Chat2API201/204（同3项旧Windows chmod），普通LLM/Core/Responses兼容24/24、旧TTS19/19。独立审查无重要缺陷，过时注释和排队预算两项小问题已修复。使用已有openai-responses客户端自动保存引用；无引用chat/completions保持无状态。本轮凭据仅内存、未读旧聊天、未保存原始帧、未重启主服务或出包。真实正式端、长期和设备能力不扩大声明。

## 2026-10-13 纯Node普通LLM接入完成

用户扩大授权后完成控制变量验证：完整官网请求、去a_bogus请求、Node自行构造的新会话及参考SDK桌面profile均正常返回。进一步仅保留五类Cookie及同账号device/web/fp/UA资料，断开CDP后由Node自行构造query/body，正式Provider工厂和CoreAdapter的流式、非流式均实际回复OK并正常结束；不使用页面fetch或签名。

新增账号级nodeProfile承载Node资料，固定官方协议与来源；2026-10-15起Cookie-only文字提示补全，受控网页模式已删除。无显式账号映射时只在Node候选池调度；显式账号不可用时拒绝，不发送后换号/切传输。公开摘要剔除整块profile，格式校验不等于登录成功。请求容量、取消、SSE正文/思考边界保持原契约。本轮未保存真实凭据、未重启主服务、未出包；普通模式已真实验证，think/expert、长期令牌维护、Android/Linux仍待验收。使用资料见[纯Node普通LLM](../usage/chat2api-doubao-node.md)。

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

## 普通LLM网页fetch历史实现（2026-10-12；2026-10-15已删除）

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

## 长句同分句多个完整Ogg流（2026-10-15，已修复与实网验证）

用户报告“虽然名字和那个传说中的狐狸精一样，但我可是由数据流和代码构成的可爱存在呢。”后正文停止。本机三次最新日志为doubao_speech_audio。使用后续“我的九条尾巴其实是九个高性能的数据处理终端，可以随时帮主人搜索信息、解答难题，或者只是单纯地卖萌打滚求摸摸～”进行一次受控真实合成，59,027字节同分句返回两个连续完整Ogg流；现有单流验证在第一段EOS后拒绝剩余字节。分别用现有严格校验/真实WASM解码成功：37,100字节/6855.08ms与21,927字节/4101.04ms，说明此例是接收端容器兼容问题。

拟在tts-ogg.js新增完整流分割器，保留validateOggOpus单流语义；每段完整CRC/BOS/EOS/序号校验，累计压缩大小/页数/120秒和最多64流，拒绝截断/交错流。豆包speech adapter在句内逐流解码并沿用PCM合并，保持单声道/采样率一致、总PCM16MiB和120秒。新增本地双流夹具及损坏/限额回归，确认后真实长句复验并纳入本次LAN/WAN服务发布；无需依赖或APK变化。受控合成只读已有账号，不写账号或配置；音频诊断保留.cache，不提交Git。任务：20261015_豆包长句多Ogg流解码.md。

确认后已实施splitOggOpusStreams，聚合原TTSSentence缓冲先验证所有流再解码；每流原CRC/序号/声道校验保持，额外累计64流/页数/包数/字节/120秒，PCM仍按原16MiB/120秒检查。单流校验仍拒绝链式输入，只有豆包接收层显式分流。音频35/35、Chat2API266/266通过；负例测试初次使用会自动重算CRC的夹具造成一项未失败，改直接破坏CRC后全部通过。

原长句实网复验两段6855.08ms/4101.04ms合并为1,051,832字节48kHz WAV、总10,956.125ms；原文整段经过真实手动服务/分句/Provider/账号合成，8段均非静音，queued audioCount=8、最后“喵～”、errors=[]。未写账号/配置、未推送设备播放，证据仅.cache。
