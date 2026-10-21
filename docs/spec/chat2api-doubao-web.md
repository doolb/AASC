# 豆包网页账号Node文字与朗读 TTS 实现伪代码

## 跨新会话复用签名（2026-10-21，已实现）

```text
已有声明 := 普通Node模式、同账号凭据摘要、签名私有文件、准备/联网分离、无输出失败单次补发
现场验证 := 一次prepare → 新会话A首轮 → 同签名新会话B首轮 → 同签名B续聊；HTTP2三次、不同新会话local ID两个、独立消息ID三个、同一签名URL；Responses14/15/28字且完成，两个权威ID的ready轮数1/2；无自动重试，签名最大年龄35511毫秒
新增定义 := 账号级签名键{accountId,mode}，记录绑定凭据摘要；私有文件旧版本条目兼容读取，原生会话ID仅用于历史来源不限制签名复用
存储布局 := 保持文件version1，规范键为JSON数组[accountId,"mode:0"]；没有规范键时查找同账号/摘要/模式的最近旧条目，成功后写规范键并移除该账号模式旧条目
清理契约 := 失效/补发前删除该账号/摘要/模式中相同URL的全部旧别名；迟到清理不能删除已经更新为新URL的记录
无内部AASC ID := 普通模式仍可按已验证账号缓存签名；原生会话ID不进入新请求，只有正常完整SSE才保存签名
执行流程 := 普通模式同账号/凭据/模式查最近有效签名 → 命中只复用URL/SDK非Cookie头 → 每次按本轮请求重新创建消息、唯一键、时间及新会话或权威续聊参数
失效流程 := 删除该账号/凭据/模式中同签名的内存与文件条目 → 原总预算内只重新准备/补发一次 → 成功保存新签名；取消/已输出内容不补发
边界 := 不跨账号/凭据/模式复用，不把签名共享变成会话/消息共享，旧私有文件不泄漏至普通配置或导出；长期有效期未验证
并发边界 := 相同URL/摘要/模式的不同加载对象一起失效；只删除失败签名值，保护其它请求刚更新的新URL；补发强制准备但不删除并发新签名
状态 := 已实现，三文件定向37/37、完整回归348/348；已清理测试会话/Key/目录/新增ADB转发
```

## 会话签名私有持久化（2026-10-21，已实现）

```text
已有声明 := 适配器128项LRU缓存、账号凭据摘要、普通模式账号签名键、重签补发一次、Chat2API rootDir
新增定义 := rootDir/doubao-signatures.json私有文件，128项、总字节有界；签名字段仅固定官网URL及受限非Cookie头、账号/模式键、凭据摘要、模式和成功来源上游ID（旧AASC键兼容）
加载 := 新runtime创建私有存储 → 首次需要签名时有界读取 → 严格校验结构/固定来源路径/头白名单/长度/账号会话字段 → 只允许当前账号/凭据/模式命中，旧上游ID不用于复用判定；损坏/过期业务拒绝按缓存未命中处理
提交 := 仅完整成功SSE后缓存并原子写入私有文件，权限0600；串行读改写+临时文件rename，失败不把聊天成功改成失败；持久化写失败不输出秘密
淘汰 := 最多128条LRU，账号/凭据/模式不匹配删除旧项；明确失效或补发前删除持久化同签名别名；新会话复用账号签名
重启 := Node进程缓存清空 → 对相同账号/凭据/模式可从私有文件恢复签名（含新聊天），无需重签；签名实际被官网拒绝时仍只重签补发一次
边界 := 不保存Cookie/消息/正文；不写普通config.json/nativeState/导出响应/Git；没有rootDir或注入存储时保留内存行为；未验证永久有效
测试 := 两次runtime/适配器共享目录的Responses续聊只签一次；凭据/会话隔离、删除及失败后重签覆盖、损坏文件、文件容量/权限/原子写和导出不包含签名
```

## 签名成功后关闭WebView开关（2026-10-21，已实现）

```text
已有声明 := AASC配置WS/持久化/广播、Chat2API runtime装配、prepare IPC、原生账号锁/租约、后台WebView及Node签名缓存
新增定义 := 关闭签名页配置{closeAfterSign:布尔}，默认false；AASC路径chat2api.doubaoWebView.closeAfterSign；请求关闭标记仅用于prepare
远端链路 := 控制端发送带type配置 → 服务端验证规范化 → config.set持久化 → 广播权威值 → 控制端回显；连接初始化补发，未收到时使用明确默认值
执行 := 主服务动态读取配置 → runtime/provider/adapter → Android prepare IPC；兼容fetch不携带关闭策略
成功关闭 := prepare返回有效prepared及正常end → 在同一账号锁/租约内主线程销毁该运行时WebView并置空 → 不删除Cookie/存储 → 回传关闭确认后结束请求
再次重签 := 账号恢复资料相同且Cookie身份有效时保留登录态；ensurePage没有实例则重建 → 生成新签名 → 按开关决定保留或销毁
隔离 := 失败/取消不当作成功；不关闭登录Activity网页，不杀共享进程，不清Node签名缓存；旧原生不确认关闭则提示需更新APK
自测候选 := WS规范化/落盘失败/广播/重连默认、IPC仅prepare传标记及能力确认、原生成功/失败/关闭与重建、Responses缓存及一次补发回归
状态 := 用户已确认实施，默认关闭以保持现状；原生关闭后等待完成再释放锁，重建不清同账号Cookie
```

## 签名后页面生命周期（2026-10-21，开关前代码核对）

```text
prepare结束 := pending删除该请求 → 中止该请求对应网页任务 → 释放账号租约/锁；不调用WebView.destroy
页面复用 := ensurePage已有实例直接返回；恢复资料摘要相同且登录态有效时不重建
页面重建 := 恢复资料变化或登录态失配 → destroy旧实例 → 恢复Cookie/存储 → 下次ensurePage创建
服务结束 := DoubaoWebViewService.onDestroy销毁实例；系统回收进程也会失去页面
内存含义 := Node按会话缓存签名仅减少prepare调用，未新增签名后关闭或空闲回收
```

## Android直连失败刷新签名补发一次（2026-10-21，已实现）

```text
已有声明 := 单次Node请求控制器、Responses总截止时间、会话签名缓存、SSE迭代器及原生状态完成提交
新增定义 := 本次执行{原始prepared,共享nativeState,首次deadline,已补发次数=0,已输出内容=假,已取消=假,当前签名scope}
首次尝试 := 按既有缓存/签名流程发送；HTTP握手失败和stream.next失败统一进入失败判断
可补发 := Android Node签名路径已进入 且 已补发次数为0 且 无正文/思考delta 且 未取消 且 原截止时间未到 且 错误属于上游/网络/签名失败白名单
排除 := 本地参数/账号或会话冲突/容量限制、用户取消、已有正文或思考输出不补发
补发 := 清理本次对应缓存及失败流 → 次数置1 → 保留原prepared正文/消息标识/会话参数 → 新控制器使用原deadline剩余预算 → 强制调用WebView准备新签名 → Node发送一次
流透明 := 握手与SSE失败均可补发；没有输出内容才更换迭代器；共享nativeState仅在成功完整SSE后提交；上层Responses只收到最终完成或最终错误
取消 := return/cancel/AbortSignal停止当前尝试并阻止再次准备/发送；过期不补发，不重置超时
再次失败 := 直接返回白名单错误，无第三次网络调用；Responses沿用原uncertain保护，不在适配器内新建会话
测试 := Responses流式/非流式刷新后成功、二次仍失败、HTTP/SSE/断连、消息ID保持、更新后缓存复用、已输出正文/思考不补发、取消/总时限/非Android路径
```

## Android Node账号签名缓存（2026-10-21，已升级）

```text
当前范围 := 普通mode0且账号有效，按[accountId,"mode:0"]管理最多128项内存缓存；无需内部AASC ID，凭据摘要变化强制新准备
恢复 := 先规范账号键，再查同账号/摘要/模式最近旧会话记录；成功后合并为规范键，保留文件version1
命中 := URL与非Cookie SDK头来自缓存，本轮Cookie/正文/时间/unique_key/消息ID/创建或续接参数均由本轮构造
成功 := 只有完整非空SSE才更新签名，upstreamId仅记成功来源，不放入其它新会话正文
失效 := 清除失败签名值的内存及文件别名；forceFresh补发不加载旧缓存、不清理别人刚更新的新URL；没有输出内容且预算允许才补发一次
兼容 := think/expert及非Node签名路径保持既有行为；桌面和网页兼容不新增账号签名路径
```

## Android直连与网页兼容联合修复（2026-10-21，已实现）

```text
已有声明 := 官网成功首轮捕获、账号刷新原子校验、Node HTTP/2适配器、Android受限网页IPC
新增定义 := 登录/运行互斥租约、运行时账号恢复资料{固定来源Cookie快照,Node设备资料}、样本清理状态
捕获时序 := 原始fetch前克隆Request → 返回给调用方的then内先克隆Response → 立即返回原Response供官网读取 → 后台有界读取副本
捕获提交 := 完整非空SSE和唯一ACK → 原生规范化模板成功 → 回授同次单ID清理许可 → 官网同源精确删除 → 原生收到成功结果后允许完成保存
设备一致性 := 当前样本带有效navigator.userAgent → 账号刷新从已规范化请求query及UA重建Node设备资料 → Cookie/设备/模板同批验证并原子写入
运行准备 := Node仅向带随机令牌的本机IPC传固定来源Cookie与设备资料 → 原生再次校验边界和session身份 → 互斥租约排除登录与其它账号 → 恢复Cookie和受限localStorage → 等官网页面与签名器就绪 → 再核对身份
运行请求 := 保留prepared中的受限JSON Content-Type → 使用当前网页生成签名并同源fetch → 分块回传 → 等流结束后释放账号租约
失败策略 := 捕获/清理失败不伪成功；身份错配不发送；页面/签名/网络错误按白名单阶段回传，不打印凭据或URL；取消中止对应网页fetch
直连续聊 := 普通模式沿用成功模板的JSON编码头、HTTP/2与参数结构；只替换新消息/权威会话/本轮ID和时间，单条用户原文不另加角色前缀
Android当次签名 := 旧样本直连风控，但当前网页完整参数经同设备Node HTTP/2成功；仅本会话签名缓存未命中时，Node调用受限/prepare IPC → 官网文档开始保留底层fetch拦截点 → 调用官网SDK签名 → 以本轮unique_key匹配并截留最终请求，禁止实际联网 → 回传固定官网URL和受限请求头 → Node自身HTTP/2发送消息
签名准备边界 := WebView不发送LLM消息；准备时只准本轮payload原文完全匹配、同源同路径和设备字段一致；不持久化当次签名、不回退网页传输、不自动重发风控请求；取消/超时清理待签名项
直连验证 := 使用Android Node自身进程调用Responses，关闭doubao.web → 首轮非空完成 → 同一Responses引用续聊 → 验证同一上游会话
兼容验证 := 创建并运行doubao.web实例 → 关闭登录页后Responses首轮和同会话续聊；测试会话独立于当前AASC对话
```

## 验证样本克隆后精确删除（2026-10-21，已实现）

```text
已有声明 := Android官网样本观察器、请求模板规范化、完成按钮、官网同源fetch
新增定义 := 当前捕获尝试{是否已选样本,已克隆资料,同次SSE确认的新ID,清理状态}
捕获前提 := 请求明确新建且原conversation_id为空；先保留Request与Response副本，再交给官网消费
成功样本 := 副本具非空回复与完整SSE结束 → ACK提供合法新ID → 模板规范化成功 → 固定本次样本并停止选择其它聊天
精确清理 := 当前官网来源及当前捕获尝试仍有效 → 只将本次新ID放入单元素conversation_id列表 → POST官网已核验删除路径
删除报文 := cmd4171 + uplink_body.batch_delete_user_conversation_uplink_body{conversation_id:单项新ID,delete_all:假,conversation_type:3} + 独立sequence_id + channel2 + version1
删除请求 := 当前官网同源fetch；固定路径/im/conversation/batch_del_user_conv；Content-Type为application/json; encoding=utf-8；agw-js-conv为str；不复用聊天路径的动态签名
成功判定 := HTTP成功且status_code为0；只有满足后标记样本已清理，不将HTTP200本身当删除成功
失败重试 := 保留已克隆资料和本次新ID → 显示清理失败 → 用户重试只发送同一个单ID；不删除其它会话、不重复创建样本
拒绝清理 := 旧会话续聊、流失败/取消、缺失或冲突ACK ID、资料克隆失败、捕获尝试失效；禁止delete_all为真或多ID删除
数据边界 := 样本ID只在当前捕获尝试内存保留，不进入账号级请求模板；凭据、完整签名URL不写日志
现场证据 := 当前官网新样本完整SSE后删除HTTP200/status_code0；已删除ID重复请求同样0；错误Content-Type实际712012002
```

## Android JS 启动器豆包服务接线（2026-10-21，已实现）

```text
已有声明 := NodeServerService.ensureDoubaoWebViewEndpoint、buildNodeEnvironment、OfflineLauncherSession.start
新增定义 := 可选豆包端点{本机端口,随机令牌}
JS启动 := 在后台启动线程绑定同应用隔离WebView服务 → 获取可选豆包端点 → 传入OfflineLauncherSession
统一环境 := JS与旧启动路径均将可选豆包端点交给buildNodeEnvironment；有效端点同时输出AASC_DOUBAO_WEBVIEW_PORT与AASC_DOUBAO_WEBVIEW_TOKEN
端点校验 := 端口在1024至65535且令牌长度至少32；损坏端点拒绝构造；服务未绑定时不生成或伪造变量
进程传递 := 相同环境同时交给JS宿主配置和ProcessBuilder → 启动器按既有环境继承传到服务Node → doubao.web实例使用Android桥
生命周期 := 服务绑定由NodeServerService持有与释放；不为每次聊天重复绑定；令牌只存应用私有启动资料与当前子进程环境
验收 := 有效与缺失/非法端点环境定向测试 → Kotlin编译 → min APK覆盖安装 → 创建并运行doubao.web实例 → 官网UI完成登录验证 → Responses首轮和续聊
```

```text
现场结果 := min69/code148创建并运行实例失败 → 修复后min70/code148端口令牌同时存在且实例running、9091健康、无授权IPC返回401
验证分层 := 官网UI两轮非空SSE完成与会话列表校验通过；登录样本保存未通过；Responses首轮502，未进入续聊，不宣称完整兼容链路成功
观察器缺口 := 当前实现派发fetch后才克隆Request、异步body处理后才克隆Response；立即消费请求/响应的真实对象模拟均未捕获成功样本，待确认修复
登录态缺口 := 外部登录Activity销毁删除共享Cookie及WebStorage；网页任务同目录依赖登录态因而失效；保持登录页打开的对照仍报doubao_upstream_failed，待恢复策略及完整模板验收
产物 := min70已在出包机生成并覆盖安装Note8，未发布；原生接线变化无需改服务代码，保留既有servicePackage状态
```

## 豆包网页内置任务与浏览器内请求（2026-10-20，源码已实现，待登录验收）

```text
已有声明 := AASC内置任务注册表、Chat2API账号/Responses/SSE、豆包官网浏览器运行时
新增定义 := doubao.web常驻任务{监听地址,专用profile,浏览器路径,调试端口,账号绑定,任务状态}
任务启动 := 注册server/service任务 → 读取规范化配置 → 建立专用浏览器profile或Android隔离WebView → 检查官网登录态
网页请求 := 核对账号与会话 → 逐轮生成消息、ID、模型参数 → 在当前官网页调用签名能力 → 执行同源fetch → 按请求ID回传SSE或媒体结果
聊天结果 := 只有非空正文且SSE完整结束才提交权威会话；取消或结果不确定不自动重发
传输切换 := 旧Node或网页nativeState与当前任务传输不一致时，从AASC已保存历史构造新上游会话，保留控制端对话ID和历史；新回执成功后提交新传输状态
其他能力 := 图片生成/编辑、视频、音乐、文件上传分别映射官网操作，并暴露独立兼容API及Chat2API接入
媒体选项 := 默认保存官网历史；显式 memory_type=0/2 或 save_history 布尔值覆盖默认；请求版本优先采用当前账号网页资料
视频终态 := 首轮若有异步task_id则轮询并提取视频；若没有task_id则仅接受同步视频结果；若轮询后仍无视频结果，返回明确协议错误，不返回空videos伪成功
文件上传 := 接受受限 JSON/Base64 或 multipart 文件 → 限制字段、体积与文件名 → PrepareUpload → ApplyImageUpload 签名 → TOS 上传 → CommitImageUpload → 返回文件URI
文件问答 := 校验已上传 URI 与提问 → 在官网消息块加入附件和文本 → 走浏览器同源聊天请求 → 仅在完整SSE结束后返回正文
接口入口 := 兼容任务对上传和文件问答同时验证API Key、体积与来源；官网签名和TOS凭证不出服务端
媒体编辑 := 图片编辑及视频参考图既可传已上传图片URI，也可用有界multipart图片上传后引用
异常 := 登录失效或验证码提示用户在专用页面处理；不自动求解、删除官网历史或切换账号
退出 := 释放请求监听、计时器和本任务浏览器；保留专用profile与用户历史
验证 := 任务启动停止、普通/思考/专家聊天、流式/非流式、媒体、文件、账号隔离、Android WebView与回归
```

现场验收伪代码：

```text
选择现场浏览器 := 连接当前设备127.0.0.1:9223 → 只读取官网页的Cookie名称与账号匹配结果 → 不输出或保存秘密
隔离请求 := 从现场页内存采集设备资料 → 生成临时首轮“早” → 在同一登录页签名并同源发送 → 检查HTTP状态和SSE业务码
结果处理 := 若HTTP200但STREAM_ERROR/710020202，则记录为本次业务失败；不能仅据此归因为登录或验证码
成功模板 := 在官网UI新会话手动发送“早” → 被动读取同次首轮请求 → 规范化删除原消息与旧会话ID → 用同一登录页和新消息构造请求 → 检查HTTP200、内容分块和SSE_REPLY_END
导入边界 := UI已显示回复但完整SSE观察器超时时，重测CDP的loadingFinished、完整响应体与browserChatCompleted；若下一次均通过且超时不可稳定复现，则只保留现场观察，不修改正常终态判定；本次内存验证的请求模板不写入不匹配的正式账号
现场续聊 := 从成功首轮模板构造临时账号 → 桌面桥接真实新标签页先核对官网来源、双Cookie身份和签名能力 → 正式文字适配器发送首轮 → 核对非空正文和ready上游会话 → 第二轮核对非空正文与相同conversationId
现场媒体文件 := 临时账号上传小文本并取下载地址 → 图片与音乐各核对一个HTTPS结果；视频无task_id且无同步视频时按视频终态规则报协议错误
正式账号 := 若现场设备资料与已存账号不一致，则不覆盖正式账号；专用profile仍须单独登录与验收
```

## LLM 网页兼容模式（2026-10-20，先于代码更新）

```text
配置 := doubao.web任务默认browser-fetch；浏览器名/路径、调试端口、账号和兼容API端口通过现有任务参数链路下发；任务未运行时现有Chat2API继续Node传输
桌面准备 := 检查本机专用profile目录 → 若专用浏览器未运行则spawn受支持可执行文件及remote-debugging-port → 仅连127.0.0.1 → 核对专用进程和官网来源
桌面显示 := 优先继承服务器DISPLAY；本机Linux无DISPLAY时尝试当前设备的:1桌面，窗口供用户手动登录与安全验证
Android准备 := 在:chat2api_login进程维持官网WebView和独立Cookie目录 → 通过同设备受限IPC接收LLM任务 → 主线程操作页面
Android IPC := NodeServerService绑定同应用不导出的WebView服务 → 分配随机令牌与127.0.0.1监听端口给Node子进程 → 只接受固定官网路径/账号Cookie身份/有界JSON → 回传带请求ID的响应分块
Android会话 := WebView服务与现有外部登录页共用独立数据目录；首次请求懒加载官网页；页面来源或登录态不符则返回明确错误，由用户在现有外部登录页人工验证
会话页 := 桌面按AASC会话ID查找已绑定官网页；没有则创建专用新页；Android固定隔离WebView以请求ID区分；续聊仍按权威上游会话ID发送
短任务页 := 媒体/文件操作使用临时官网页；结果流结束、失败或取消时关闭该页，避免请求次数增加时累积空标签页
发送前 := 从官网页读取适用于www.doubao.com的sessionid；若同名Cookie同时存在，优先使用www.doubao.com专属项，其次使用.doubao.com域项；与所选账号的规范sessionid恒时比较 → 校验页面来源、签名能力、模型模式与任务仍有效；每个页面同一时刻只处理一轮
发送 := 用当前消息构造正文 → 在官网页生成当次签名 → 在页面内调用同源fetch → 关联请求ID
回执 := 页面桥逐块回传同次官网SSE并使用现有豆包事件解析 → 收到非空正文与SSE_REPLY_END后完成 → 记录权威会话ID → 回送Chat2API Responses
失败 := 登录失效、验证码、导航、连接断开、超时或取消时停止本轮并返回固定公开错误；已发送的未知结果标记会话不确定，不自动重发
退出 := 释放任务监听和请求缓存；不关闭用户登录页或删除专用profile目录
显式Node模式 := 沿用现有Node构造与账号模板；浏览器不可用时网页模式返回明确错误，不自动换传输或账号
TTS := 沿用现有语音适配器
```

## 完整请求参数导入与聊天验证（2026-10-20，基础链路已实现）

用户确认将 Android 外部登录页面请求观察与网页聊天完成结果纳入导入和验证；手动发送官网消息形成样本，不由导入工具自动发消息。

```text
导入输入 := 同账号官网登录上下文 + 经确认的真实/chat/completion请求样本
样本校验 := 固定HTTPS来源和路径 → 校验账号Cookie/设备指纹一致 → 只提取受限查询、请求头和非消息正文参数
账号资料 := 现有Cookie、cookieSnapshot、nodeProfile + 经校验的请求模板；不保存样本消息或旧会话ID
新会话 := 生成新的local_conversation_id、local_message_id、block_id、unique_key、创建时间；发送新用户文字
权威会话 := 只在完整SSE结束后接受SSE_ACK中的conversation_id；续聊按现有nativeState发送
逐次字段 := 按官网来源与有效期策略更新，失效时返回明确错误；不把旧抓包值认作长期有效
捕获范围 := 调试端口浏览器和Android外部登录均等待用户手动发送官网聊天样本
Android捕获 := 同源文档起始脚本观察fetch的/chat/completion参数及完成事件 → 专用桥接送原生 → 合并当前Cookie/UA并校验；XHR与浏览器追加头待真机核对
网页验证 := 同账号请求+非空内容分块+SSE_REPLY_END且无业务错误 → 保存凭据版本绑定的“网页聊天已验证”观察状态
Node验证 := 后续真实Chat2API请求由Node获得非空正文和完整结束 → 保存“Node聊天已验证”；无需导入时自动发测试消息
失败处理 := HTTP200或仅ACK不升级状态；凭据更新时清除旧验证；会话列表验证与聊天能力状态分别记录
服务校验 := 固定官方路径、同账号身份与容量边界 → 拒绝任意URL/头注入 → 样本消息和旧会话ID不得持久化
发送 := 读取账号请求模板 → 复制静态参数 → Cookie、msToken、CSRF从当前快照更新 → 新用户文字与本地会话/消息ID覆盖 → HTTP/2发出 → 解析SSE终态
当前边界 := a_bogus及其余逐次字段仅保存样本值；尚未证明长期复用，故真实账号首轮及续聊需另行验收
```

## 网页请求原样由 Node 发送的隔离验证（2026-10-20）

```text
样本 := 当前已登录Vivaldi网页发送“早”时，CDP仅在内存收集同次/chat/completion的URL、实际请求头和正文
网页结果 := HTTP200/h2；SSE包含ACK、内容分块和REPLY_END；无非零业务错误码
Node验证 := 用Node HTTP/2把同一URL、头和正文立即原样发送；只重算相同正文的Content-Length
Node结果 := HTTP200；SSE包含ACK、内容分块和REPLY_END；无非零业务错误码
替换消息对照 := 网页另发“晚上好”并正常结束 → Node沿用当次URL和头，将正文消息改为“你好”、重新生成local_message_id/block_id/unique_key并更新Content-Length
替换消息结果 := Node HTTP200；SSE包含ACK、内容分块和REPLY_END；无非零业务错误码
边界 := 原样重放及替换消息均证明Node可以发送这两组有效请求；未验证独立生成逐次URL/头参数或长期复用
保密 := Cookie、令牌、签名URL及原始响应只保留在测试进程内，不写文件或日志
```

## 当前 Node Responses 发送复测（2026-10-20）

```text
输入 := 正式Chat2API豆包账号 + Responses流式新会话 + 用户文字“早”
调用 := Node通过现有适配器发送一次，不修改账号、请求构造或会话
判定 := HTTP状态不能代替SSE终态；继续读取data事件直到response.completed或response.failed
结果 := HTTP200，终态response.failed，公开错误码doubao_upstream_failed，无有效回复
后续 := 保留现有失败状态；待用户确认协议对齐范围后再修改请求
```

## 请求头差异现场核对（2026-10-20）

```text
网页样本 := 当前已登录Vivaldi页面实发“早” → 被动采集/chat/completion头名和查询参数名 → HTTP200，未判定SSE终态
Node样本 := 同一正式账号调用buildDoubaoRequest在内存构造普通首轮 → 只取显式头名和查询参数名，不发网络请求
共同显式头 := accept、agw-js-conv、content-type、cookie、origin、referer、user-agent
网页新增应用/浏览器头 := last-event-id、x-flow-trace、accept-language、sec-ch-ua、sec-ch-ua-mobile、sec-ch-ua-platform、sec-fetch-dest、sec-fetch-mode、sec-fetch-site
网页传输层头 := :authority、:method、:path、:scheme、priority、content-length、accept-encoding；Node HTTP栈可能自行生成部分对应项
首轮CSRF := 当前普通首轮Node不显式发送x-tt-passport-csrf-token；旧版抓包差异描述不能直接沿用
查询差异 := 网页有a_bogus；Node缺此逐次字段；msToken与tz_name两边均存在
结论 := 只有头名差异证据，没有单变量因果证明；后续方案仍需用户确认
```

## 正式账号删除重导复测（2026-10-20）

```text
预检 := 正式doubaochat账号恰好一个；浏览器www官网页恰好一个；当前快照与Node资料校验通过；浏览器fp等于旧账号fp
保护 := 原账号完整资料留在本次进程内存；先申请OAuth状态；重导失败则将原账号恢复
操作 := DELETE原账号 → 确认豆包账号数为0、其他Provider账号未变 → OAuth.complete用本次浏览器凭据和原accountId导入
核对 := 豆包账号数为1、总数恢复4、其他3个账号ID不变、原accountId和Node指纹不变、www快照30项、accounts快照24项
验收 := 正式Responses新会话流式发送“早”一次 → HTTP200但终态response.failed/doubao_upstream_failed、无正文
结论 := 凭据和账号重导成功；上游Node文字失败仍待协议差异排查
```

## 调试端口保存浏览器凭据（2026-10-20）

```text
输入 := Provider别名 doubao 或 qwen；可选本机调试端口，默认9222；Chat2API本机地址默认8083
Provider映射 := doubao → doubaochat、www.doubao.com与accounts.doubao.com；qwen → qwen、www.qianwen.com
连接 := 只连127.0.0.1的CDP端口；查找对应官网页面，没有则打开登录页；用户完成网页登录后触发采集
账号选择 := 读取正式Chat2API公开账号列表 → 同Provider无账号则新建，恰好一个则更新，多个则拒绝以免覆盖错号
豆包采集 := CDP按固定两个来源读取适用Cookie → 保留同名不同路径的顺序 → 限定快照格式；从同一www页面读取两项既定localStorage、userAgent和指纹，构造Node资料
豆包已有账号 := 创建并消费原账号外部网页会话 → 用一次性刷新令牌提交Cookie快照；服务端校验原账号凭据版本和原Node指纹，原子更新
豆包新账号 := OAuth开始 → 用本次规范Cookie、完整快照与Node资料完成登录；服务端校验身份和格式
千问采集 := 只从允许来源读取tongyi_sso_ticket → OAuth开始 → 服务端校验ticket → 完成登录；恰好一个原账号时复用其ID
输出 := 只打印Provider、账号ID、采集项数量和成功/脱敏错误；不打印Cookie、ticket、令牌、profile或网页正文
失败 := 浏览器未登录、来源不符、多个账号、格式错误、版本冲突或服务端拒绝时停止，不重试和不删除原账号
验证 := 模拟CDP与管理接口覆盖Provider映射、默认端口、同名Cookie、单账号复用、多账号拒绝、秘密不出日志；现场Responses单次短句仅报告真实结果
现场结果 := 已登录Vivaldi端口9223保存原doubaochat账号；www快照30项、accounts快照24项、Node资料保留；正式Responses流式“早”HTTP200后response.failed/doubao_upstream_failed
```

## 第三档报错定位伪代码（2026-10-19，待错误样本）

```text
已有声明 := 三档默认模型映射；LLM会话指纹含模型名；Responses原生会话绑定；豆包SSE正文/思考分流
新增定义 := 失败样本{入口,请求模型,新建或续接,流式与否,HTTP状态,公开错误码,提问文本}
操作流程 := 本机代理以新会话、同档续接和轻量切专业调用 → 记录公开状态与正文长度 → 常规LLM隔离配置复测非流式/流式
观察结果 := 新会话与常规LLM切档成功；直接复用轻量previous_response_id切专业返回409，但尚未对应用户现场错误
后续流程 := 获取用户失败样本 → 在相同入口和会话条件复现 → 对照上游事件和会话状态 → 仅修改已定位的分支并补回归
```

## 三档默认模型映射（2026-10-19）

```text
已有声明 := Chat2API默认映射；Provider内置模型映射；用户自定义映射；豆包网页请求模式
新增定义 := 快选名称 { doubao, doubao-think, doubao-expert }；实际目标 { doubao, doubao, doubao-expert }
操作流程 := 三档定义只保存当前LLM配置的模型名 → Chat2API映射层为Qwen三档生成专用请求别名并声明实际目标，豆包按名称声明实际目标 → 豆包Provider内置映射由默认规则生成 → 请求优先匹配用户自定义映射，否则匹配Provider内置映射或默认映射
操作流程 := doubao-think 命中默认映射 → 实际模型 doubao → 豆包请求构造器发送思考模式0
操作流程 := 控制端与显示端仅按LLM模型名识别普通档，不读取Chat2API映射配置
验证 := 三档名称独立回显；默认映射与真实调度均选择实际目标；自定义映射仍可覆盖默认目标
```

## 豆包普通与专业档回复分流修复（2026-10-19）

```text
现场复现 := 当前账号新会话，doubao-think 与 doubao-expert 均收到 HTTP 200、SSE_REPLY_END，却返回 doubao_empty_response/502
事件证据 := 思考块 10040 首次出现 is_finish=false → 后续 10000 文字块与 CHUNK_DELTA 属于思考 → 同一个 10040 块以 is_finish=true 结束 → 新的 10000 文字块与 CHUNK_DELTA 属于答案
流状态 := 10040 新块且未结束 → 进入思考；同块完成通知 is_finish=true → 退出思考；保留旧协议中两个不同 10040 边界块切换的兼容行为
文字归属 := 每个 10000 块首次出现时固定所属通道；后续快照与增量沿用该块通道；结束前只有正文非空才作为成功
安全边界 := 思考文字仍只进入 reasoning_content；没有可识别结束边界且没有正文时继续明确失败，不将思考冒充回复
验证 := 相同 block_id 的 10040 开始/结束、旧两个不同边界、流式与非流式、正文为空、实际账号普通/专业档短句
```

## 外部网页完成后保存当前豆包 Cookie（2026-10-20，首轮实现）

### 新会话首轮协议对齐（2026-10-20，实现顺序）

```text
输入 := 当前账号规范Cookie、同设备nodeProfile、可选按www/accounts来源保存的Cookie快照
登录捕获 := Android隔离WebView从固定两个HTTPS来源读取当前Cookie；规范Cookie仍保留六类字段，快照分别保存完整适用Cookie，不把accounts快照送到www聊天请求
网页恢复 := 按来源写回CookieManager；原Path/Domain不可由getCookie读出，同源同名项取首项写回，Node快照仍保留原完整Cookie头顺序
已存账号外部网页完成 := 用一次性消费后刷新令牌提交两个来源快照；服务端在账号锁内核对凭据版本并原子写入；失败保持原凭据，令牌过期或重复提交失败
快照校验 := 仅固定来源，限制数量、名称、值、单项和总字节；拒绝控制字符与畸形片段；不在公开账号、日志或错误中返回值
首轮构造 := Node固定官网/chat/completion；优先当前www快照作为Cookie头，旧账号回退原规范Cookie；msToken只从该次Cookie或真实nodeProfile读取
请求参数 := 保留同账号设备ID、webId、fp及动态web_tab_id；加入浏览器实际时区；不复用历史a_bogus或伪造逐次追踪头
首轮正文 := 普通doubao且新会话时，单条User输入发送原文；client_meta.last_message_index=null且附三项local_permissions；content_block.extra_info={}，不设is_finish/patch_type
首轮正文 := option含现场model_config/aggregate_params/conversation_init_ext/recovery_option/general_task_param等结构；create_time_ms用发送时刻；ext含agent_mode/is_finish/conversation_init_option；user_context=[]，不设chat_ability
结果 := 一次请求，一次完整SSE校验；限流/风控沿既有脱敏错误返回，不自动更换账号、重试或借浏览器绕过
范围 := 只修改need_create_conversation=true的新会话首轮；续聊待单独对照
验证 := 脱敏结构测试、旧账号回退、刷新令牌/版本冲突、Android采集与完成、Responses实账号新会话一次
现场结果 := 隔离Responses新会话上游HTTP200但STREAM_ERROR业务码710020202 → 代理doubao_upstream_failed/502；官网同账号首轮有正文；不能宣称Node首轮通过
```

```text
2026-10-20现场恢复 := Chat2API已有账号 → 创建并消费外部网页会话 → 将www/accounts固定来源的10项Cookie映射写入DISPLAY=:1 Vivaldi → 逐项验证10/10
网页验证 := 官网进入已登录聊天页 → 新对话发送“早” → 收到正常回复；保存账号无回写
回复后对照 := 已恢复10项仍与保存值相同；两来源浏览器Cookie总数33
紧接Node复测 := 同一保存账号经本机Chat2API Responses单次发送“早” → doubao_risk_control/403且无正文；不能仅凭网页成功推断Node动态环境哪项导致403
同首轮协议对照 := 官网新对话“早”与Node构造“早”均POST /chat/completion且need_create_conversation=true；官网HTTP200，Node HTTP403
查询参数差异 := 官网比Node多a_bogus/msToken/tz_name；不读取或持久化这些动态值
请求头与Cookie差异 := 官网约29条Cookie及x-flow-trace/sec-*等浏览器头；Node保存账号发送5项Cookie及独立CSRF头
正文差异 := 官网含user_context/model_config、实际create_time_ms；Node含chat_ability、create_time_ms=0、answer_with_suggest=true、块is_finish/patch_type
结论边界 := 只记录字段差异和状态码，尚未确定触发403的单一条件；不自动复制浏览器请求或绕过上游验证
待验证线索 := 固定“请只回复测试”指令可能影响上游风控；现有样本混有时间与会话状态差异，不视为已确认规则
后续实测 := 优先使用自然对话；同时记录新会话或续接、请求时间、成功或错误码
同会话实测 := 从recent_conv确认最新“早”会话及15分钟内创建 → 构造同账号ready Node状态 → 仅发送“早”
续接结果 := SSE ACK与原conversationId一致 → 4个流分块 → “早安～今天也要顺顺利利✨” → finish=stop
追加Node实测 := 同账号全新会话输入“早” → 4个流分块 → 正文“早呀☀️” → finish=stop
结果边界 := 前次测试指令短句403、此次单字问候成功；不据此确定具体风控触发条件
本机删除重导 := 预检浏览器Cookie和原nodeProfile → OAuth开始 → DELETE原豆包账号 → 确认豆包账号数0 → OAuth完成时复用原accountId
重导结果 := 豆包账号数恢复为1，其他账号总数不变；浏览器Cookie已保存，nodeProfile保留，只读验证verified
重导复测 := Node全新短句 → doubao_risk_control/403，正文分块0；控制端历史未删除
本机操作验证 := Vivaldi读取受支持Cookie → 保留原账号nodeProfile → POST /oauth/start(doubaochat) → POST /oauth/complete(原accountId)
保存结果 := 原账号ID和数量不变；Cookie与保存前相同；只读登录验证为verified
Node复测 := 新会话短句 → doubao_risk_control/403；正文分块0
实现边界 := 上述操作走既有OAuth账号保存路径；Android已保存账号的外部网页“完成”仍未回存Cookie
已有声明 := 账号外部网页恢复会话 → Android隔离WebView；完成按钮只关闭窗口；新增登录捕获只保存六项Cookie与nodeProfile
现场证据 := Vivaldi移入旧凭据 → 图片拖动验证；人工完成后同一网页会话收到回复分块与结束事件
现场证据 := Node用旧六项、刷新后的六项、当前浏览器完整Cookie分别请求 → 均为doubao_risk_control/403
现场证据 := 浏览器实际/chat/completion请求含额外Cookie、a_bogus、user_context与浏览器请求头；一次后续网页请求仍出现STREAM_ERROR，稳定性待验收
新增定义 := DoubaoWebCookies { wwwCookie, accountsCookie, capturedAt }；只接受固定官方来源和受限长度、数量的Cookie字段
操作流程 := 已保存账号打开外部网页 → 人工完成登录/安全验证 → 点击完成 → 从固定www及accounts URL读取当前适用Cookie → 与同批nodeProfile绑定
操作流程 := 原生结果携带原账号和一次性外部网页会话标识 → 控制端调用受限账号凭据刷新 → 服务端校验身份、来源、Cookie格式、大小及账号版本 → 原子更新原账号
操作流程 := 保留既有六项规范Cookie供身份校验；另保存原来源的完整请求Cookie快照 → 网页恢复按来源设置，Node文字发送可使用www请求Cookie
操作流程 := 捕获或保存失败 → 保留旧账号与外部网页，不用不完整快照覆盖；日志、错误和页面不显示Cookie值
验证 := Android捕获/完成/取消与重复提交、双来源Cookie、同名不同作用域、大小上限、账号冲突、网页恢复、Node请求头、历史账号兼容
验收边界 := Cookie快照只解决资料保留；动态a_bogus/浏览器环境等差异仍可能导致Node 403，需单独现场验收
状态 := 上方首轮实现已落地；本段为实施前调查记录，续聊和动态请求字段仍待后续核对
```

## 当前TTS上游并发（2026-10-16，源码完成）

```text
在线聊天/Agent/手动回复 → 分句全部提交 → orderOnly保序交付
应用controller → 默认语音与内置代理runtime factory → 资料根目录/账号共享上游槽位
配置 := 主config.tts.upstreamConcurrency.doubao-chat → 默认3，范围1至8 → WS保存与广播/重连
上游完成 → 幂等释放槽位；本地两个Worker加256项/64MiB有界等待 → 三路同时完成均可返回WAV
解码等待容量满 → busy + speechQueueFailure → 不惩罚账号、不重试
当前状态 := 已实现，未实网三路合成、未出包发布；历史单路章节不作为当前源码声明
```

## 当前音色实现（2026-10-15）

```text
当前目录 := 共享doubao-chat-voices.json → 女32/男62 → Provider/HTTP/WS同源只读
当前speaker := 缺省温柔桃子；显式style_id须在94项allowlist中
当前实现 := doubao-chat-voice-selection.md伪代码；下方单音色及目录未接入为历史记录
```

当前约束以2026-10-15文首伪代码为准；注明历史的旧网页运行协议已删除，不属于当前实现。

## 官网声音目录核查伪代码（2026-10-15，调研结果，未接入项目）

```text
目录接口 := POST https://www.doubao.com/alice/user_voice/recommend
推荐参数 := {page_index: 1, page_size: 30, recommend_type: 1}
分类参数 := {page_index: 1, page_size: 30, recommend_type: 10,
             tab_key: female | male | characters | accent}
读取结果 := response.data.ugc_voice_list 与 response.data.has_more
下一页规则 := has_more为真时递增page_index；追加调研已实测五分类全部分页
列表映射 := 保留字符串id、name、style_id、icon、preview、tag_list
官网显示过滤 := 排除style_id以BV开头的条目
合成标识 := currentVoice.style_id -> speaker；未发现独立ttsid字段
官网本地保存 := IndexedDB(samantha-web).store[default-chat-voice-store].state.currentVoice
保存字段 := id、name、style_id、pitch、speechRate，另有头像与预览信息
当前样本 := 可爱女生 / id=18592378481410 / style_id=ICL_49240bb7f5ac
目录验证 := 浏览器分类请求200/code0/30项/has_more真
独立验证 := 当前会话Cookie仅内存用于Node裸URL请求，不带签名查询参数
独立结果 := 200/code0/30项/has_more真；不推断长期或无登录有效
本轮边界 := 不点击音色确认，不保存凭据，不发聊天或合成请求
项目当前行为 := 固定DOUBAO_SPEECH_VOICE；目录/动态选择尚未实现
追加抓取 := 顺序遍历五分类，每页30项，直到每类has_more=false；遇HTTP或业务错误停止
分页完整性 := 页码连续；非空重复页、空页却has_more真、同id异style_id视为异常
合并规则 := 以字符串id为键，合并分类；不同id共用style_id仍保留原条目
实际分页 := 推荐13/女声5/男声7/角色4/口音2，共31页均200/code0
分类项数 := 推荐385/女声142/男声182/角色108/口音45，各类均取到末页
合并结果 := 385个id，373个style_id；官网可见316项，BV隐藏69项
导出字段 := id/name/style_id/tags/categories/visible_in_web_selector
导出位置 := docs/ref/doubao-voice-catalog-20261015.md及同名json
导出元数据 := 时间、接口、范围、分类统计、分页计数与has_more；不保留凭据或签名资源URL
核验 := 重读JSON统计、分类页码/末页、字符串ID唯一性、style_id计数、Markdown行数
上一轮候选导出 := 全部分页中只保留visible_in_web_selector真且style_id不以BV开头的条目；不等于当前DOM实显
限定结果 := 316个id/304个style_id；推荐316/女声113/男声147/角色97/口音39
限定文件 := docs/ref/doubao-web-visible-voices-20261015.md及同名json
展示方式 := Markdown按五分类分别列出；JSON按id去重并保留categories；不发新请求
限定核验 := 不含BV，id唯一，分类计数吻合，Markdown数据行数等于五分类条目数之和
本轮实际需求 := 女声分类，和网页当前实际加载卡片相同，最后为桂乡甜妞
根因证据 := 分页监听内部speaker-list，但其clientHeight=scrollHeight=1971且overflow=visible
外层滚动 := overflow=auto，clientHeight=257、scrollHeight=2047；内层无滚动区
相同范围请求 := {page_index:1,page_size:30,recommend_type:10,tab_key:female}，不追后续has_more
实际数量 := 首批30减3项BV=27；此前113为全5页过滤后的候选，不是网页实际加载数
实际列表来源 := 当前Chrome女声DOM卡片React speaker字段，保持顺序
实际列表文件 := docs/ref/doubao-web-female-current-20261015.md及同名json
实际核验 := 27项、ID唯一、无BV、最后桂乡甜妞、JSON往返一致、Markdown27行
最终范围 := 五分类均按网页当前实际加载列表，不追加接口后续分页
最终采集 := 逐一点击推荐/女声/男声/角色/口音，等待分类生效和卡片载入，读取DOM顺序及speaker字段
五类数量 := 推荐30/女声27/男声29/角色26/口音25；合并94个id和94个style_id
五类末项 := 青涩沐阳/桂乡甜妞/暖阳阿晨/清朗公子/虎子的声音
最终文件 := docs/ref/doubao-web-ui-voices-20261015.md及同名json
最终结构 := categories逐类保留原顺序voices；总voices按id合并所属categories
最终核验 := 每类不超过30且ID唯一/无BV，女声逐字段等于已验27项，JSON往返和137条分类表格数据行一致
页面收尾 := 恢复原分类，不确认音色、不试听、不发合成
获取方式文档 := docs/ref/doubao-web-voice-fetch.md，入口docs/ref.md
推荐覆盖核验 := 推荐30项按id与style_id均属于后四类并集，后四类合并仍94项
文档要求 := 记录CDP卡片读取、接口正文/分类、只取第一页、BV过滤、字段保存及复核；不保存秘密
用户整理要求 := 角色/口音按原始tags中唯一的男/女并入两个性别组，按id去重
整理顺序 := 原女声/男声列表在前，随后角色、口音按原序追加；推荐不额外增加条目
整理字段 := gender=female/male，保留id/name/style_id/tags/source_categories/recommended
整理结果 := 女32（原27加5）、男62（原29加33），总94；无性别缺失或冲突
整理校验 := 输出id集合等于原94项，id/style_id唯一；原男女列表顺序为输出前缀；JSON往返/表格94行一致
整理文件 := docs/ref/doubao-web-gender-voices-20261015.md及同名json；不覆盖原五类快照
```

## 外部网页认证子域恢复（2026-10-15，已完成）

```text
修复前证据 := www有host-only sessionid；accounts无sessionid；IM读取0，认证心跳401/账号信息13
临时对照 := 同账号现有白名单Cookie仅补到accounts -> 心跳0/信息success/toast消失
豆包允许来源 := 固定HTTPS www.doubao.com、accounts.doubao.com
豆包CookieBundle目标 := 显式origins为上述两项；六Cookie名称白名单保持
集合恢复目标 := bundle.origins若存在则使用，否则使用loginUrl来源
有效目标 := 去重目标与profile.allowedOrigins精确交集
恢复映射 := 同账号已保存Cookie白名单项 × 有效目标 -> 原生既有host-only恢复数组
其他Provider := 未声明origins仍单来源；Qwen原单Cookie多来源规则保持
保持 := 账号库秘密、Node聊天协议、设备资料采集及WAV流程；不补未知Cookie或父域
验收 := 定向映射与隔离边界 + npm check:chat2api + ADB正常恢复/旧会话/认证心跳/toast
残余 := 安全SDK部分2035不在当前成功声明内，不将全部非零监控errno判作业务失败
本地验证 := 来源/白名单/隔离等定向10/10，Chat2API257/257
正式入口 := min56原生热更新code95/deps10，pendingHealth=false；未重建APK
首次恢复 := accounts sessionid存在，心跳0/0、信息success，原会话IM0/0及4消息正常，无错误toast/新聊天/临时注入
刷新 := 心跳0、信息success，4消息保持，无错误toast
发布 := LAN/WAN code95，其他组件保持；完整摘要/签名通过，精确清理0错误，servicePackage=false
```

## 2026-10-15 重登后的纯Node真实验收

```text
手机现有账号 := 启用豆包1个，nodeProfile存在且既有凭据规范化校验通过
主服务器现有账号 := 启用豆包1个，Cookie-only；未发LLM、未复制手机资料
账号来源 := 各自原有账号库；不覆盖模型映射，不导出Cookie/设备标识
会话隔离 := 正式ResponseSessionStore使用临时内存后端，只保存本次测试两轮
第一轮 := 正式Runtime ResponsesService，doubao/stream=true，告知水果偏好 -> 好的。/completed
第二轮 := previous_response_id续接 -> 荔枝/completed，同一会话，记忆断言通过
上游观测 := 两次Node HTTP；首次创建、第二次conversation存在且need_create_conversation=false
TTS := 正式SpeechService doubao-chat自动选同账号 -> 253112bytes/48kHz/非静音，2409ms
验收边界 := 首组口令第二轮内容拒答，不是流式失败；普通水果场景上下文通过
保持 := 生产代码、配置、发布状态和code92/min56/deps10；无播放，无think/expert或长期验收
```

## 豆包TTS跨批次账号队列（2026-10-15，已完成）

```text
已有声明：豆包适配器实例、generate输入、accountId、signal、原deadline、WS合成与WAV解码
新增定义：实例账号槽Map、活动执行权、FIFO等待项、等待容量16/账号及256/实例
入队前：校验账号、凭据、取消状态、原deadline
账号空闲 -> 占用执行权；账号活动 -> 容量检查 -> 加入该账号FIFO
等待项取消/截止 -> 移除等待项 -> 清理计时器与监听 -> 返回本地排队失败
取得执行权 -> 再检查取消/截止 -> 原WS生成 -> 完整TTSEnded音频到达且WS清理 -> 立即归还执行权 -> 原解码与WAV校验
生成失败/取消 -> 幂等归还执行权；解码结束/失败/取消 -> 再次归还无副作用
归还执行权 -> 交给首个有效等待项 -> 空槽删除；解码可与下一项上游请求并行
SpeechService错误分类 -> 排队本地失败不计账号上游失败；原上游失败规则保持
不同accountId -> 独立执行权；同一实例跨批次 -> 共享账号FIFO
现有批次内豆包并发1、有序交付、Qwen/API行为 -> 保持
验收 -> FIFO/账号隔离/完整音频立即交接/解码成功失败取消不影响下一项/截止/容量/资源清理
错误内部标记 := speechQueueFailure=true，仅服务内区分排队错误；对外仍固定错误码和文案
首项执行权 := 同步归还释放函数；等待执行权 := Promise解析释放函数
释放函数 := 每项独立、幂等；归还时跳过已取消/到期项，清理计时器与监听
实现验证 -> Chat2API254/254、音频36/36、分句20/20
发布验证 -> code92/min56/deps10，主服务健康重启；Android原生热更新code92，pendingHealth=false
真实三批 -> 主服务器5272ms/Android2187ms；同账号最大上游连接1，均48kHz非静音WAV，无播放
产物状态 -> code92已覆盖最新代码，servicePackage=false；APK/依赖未重建
```

## 2026-10-15 临时降低豆包分句并发（历史决策，账号边界已由上方队列替换）

```text
证据 := 本地doubao适配器busy Set拒绝同账号重叠；不是本次官方返回的并发错误
用户选择 := 暂时只降低分句并发；暂不增加账号级排队
批次入口 := createTtsGenerationScheduler(displayId,ttsOptions)
有效Provider := 现有ttsProviderService.resolve(批次businessType/templateTts) → 权威选择
豆包网页TTS := 有效Provider=doubao-chat → 当前分句批次concurrency=1
其它Provider := 保持既有server单路/display槽位1–2路；生成并行可用时仍按句序释放播放
上下文同步 := 普通Chat/手动回复播放/Agent/修复模式向调度器传入与生成相同的businessType和templateTts
取消/超时 := 既有批次代次和Provider超时逻辑保持；不启动额外账号队列或重试
边界 := 不同请求批次仍可同时调用同账号；这种情况保留busy拒绝，账号排队另记用户暂缓
验证 := 实际入口VM加载+真实OrderedScheduler→豆包最大活动1/Qwen及原生槽位2保持/来源选取一致
发布 := 仅服务代码，继续code90/min56/deps10；主服务器脚本重启；实际多短句WAV
```

## 2026-10-15 豆包纯Node文字与语音自动账号（用户已授权）

```text
文字 := 固定豆包别名→doubaochat；账号明确绑定不可退选，未绑定优先Node池
文字凭据 := normalizeCookie/profile → profile缺失则422/doubao_node_profile_required → 不发推理
唯一文字传输 := Node HTTP + 既有query/body/SSE/Responses原生会话；不读取网页配置/不创建Chrome桥
删旧分支 := 专用browser-bridge/web-config/web-ws及控制端settings、WS消息路由/广播/初始化与旧自测
旧配置 := 已保存doubaoWebRuntime不再读取、不会恢复网页兼容；不改无关用户配置
语音 := doubao-chat→内置doubaochat绑定；不要求自定义映射/指定账号
语音选择 := 现有strategy + 当前启用/有效/有凭据/未限额同Provider账号；只在发送前选择一次
配额兼容 := dailyLimit优先，缺失使用旧豆包todayLimit；Store允许两个公开字段，发送前及秘密读取后复核
显式语音账号 := requiredAccountId严格限制，缺失/停用报错，不退选或重发
语音登录资料 := Cookie即可；不要求文字Node资料；无可用账号提示登录/恢复
产物 := 仅新增服务代码变化→servicePackage=true；已完成min56采集代码保持；依赖集合不变
验收 := 自动单/多账号/排除停用限额无秘密/更新凭据/无账号/严格映射/失败无重试；控制端无网页设置
主服务器 := 192.168.1.39:8081通过现有restart:server脚本加载最新代码，再验证入口/健康
```

## 2026-10-14 已确认实施：Android登录保存Node资料及TTS成功状态

```text
授权 := 用户选择“同时修复Node资料采集与TTS”；先更新本节再修改生产代码
LoginProfile.doubaochat := 固定官网来源 + nodeProfile='doubao' + requiredFields=[cookie,nodeProfile]
Android捕获 := 已有隔离登录WebView；只读两项官网localStorage及navigator.userAgent
固定存储键 := samantha_web_web_id / __tea_cache_tokens_497858
资料组装 := 前者web_id→deviceId；后者web_id→webId；已筛Cookie.s_v_web_id→fp；同页UA→userAgent
合法资料 := 有限长度JSON/数字ID/合法fp和UA；缺失或非法不生成profile，不编造身份
采集快照 := 同官方来源有效回调 + Cookie/profile同批合并；新的Cookie不得沿用旧profile
完成条件 := Cookie与profile全部有效 → 单次返回；未齐全→提示Node资料未就绪/可等待或取消
回调载荷 := 内部Map.nodeProfile是JSON串 → Activity转换为嵌套JSONObject → 既有登录API
服务保存 := 已有normalizeDoubaoCredentials验证嵌套profile/fp → 私有账号存储；公共摘要继续脱敏
旧账号文字 := 无profile → 422/doubao_node_profile_required/提示重新登录补全
已有profile := 既有Node协议 → 不访问网页运行配置；网页兼容模式已删除
TTS状态 := 0或20000000允许继续；401/403/429映射原固定错误，其他非零拒绝
TTS生命周期 := 原Task/Session/句子/结束状态机、身份/容量/超时/取消/解码与无重试保持
Offline解码 := 代码与依赖分目录，worker内裸ESM import不使用NODE_PATH → 模拟分目录复现
解码依赖入口 := 用既有CommonJS require.resolve定位ogg-opus-decoder → pathToFileURL → import绝对入口
解码验收 := 同分离目录/同NODE_PATH真实WASM回归；不新增依赖或放宽音频容器校验
产物 := 服务代码变化→servicePackage=true；Android采集变化→minApk=true；依赖集合不变
验收 := 正式账号保存profile/摘要脱敏/缺字段不完成 + Node不调用浏览器 + 实际状态全链路WAV + 真机短句
```

## Offline修复前真实定位（2026-10-14，历史记录）

```text
实际环境 := min55/code87/deps10 + 保存Cookie-only账号 + 正式Core/SpeechService
LLM当前 := 无nodeProfile + doubaoWebRuntime.enabled=false → 503/doubao_browser_disabled → 不发官方推理
用户纠正 := 文字使用Node直连；不需要网页聊天
直连诊断 := 同账号 + 当前适配器 + 不注入browserTransport → Android Node HTTP请求
直连结果 := HTTP200/text-event-stream → SSE业务风险 → doubao_risk_control/403；耗时448ms，无有效正文
风险后 := 不自动重试；不打开官网网页；不等同HTTP403或Node协议不可用
候选账号采集 := 正常登录同上下文deviceId/webId/fp/UA → 校验 → credentials.nodeProfile → 已有Node协议
候选缺资料 := 明确提示补全；不伪造设备身份，不以网页聊天回退
TTS当前 := 官方WS open → TaskStarted/status=20000000 → 非零状态被当错误 → 502/关闭 → 无StartSession/无音频
夹具断点 := 模拟事件未写status字段 → decoder默认0 → 未覆盖实际20000000
候选成功状态 := 0或20000000；其他状态 := 沿用固定错误/风险/鉴权处理
候选测试 := 完整Task/Session/句子/结束使用20000000 + 0兼容 + 真错误拒绝 + 超时/取消/迟到清理
候选验收 := 明确确认后改source/测试 → 新签名code包 → Android同账号生成完整非静音WAV
测试约束 := 临时绑定仅内存/凭据留APK UID/不读无关聊天/不改长期业务配置
状态 := 真实测试完成；TTS修复与LLM初始化待确认
```


```text
2026-10-13 纯Node会话复用（已实现，普通模式）
  两轮真实协议验证通过：第一轮随机标记/OK，第二轮纯增量准确回忆；ACK会话ID一致，无历史重放
  本轮两次请求已用完；正式实现继续离线验证，不擅自增加真实请求
已有声明：
  LLM.buildResponsesPayload、saveResponseReference、getResponsesFingerprint
  Responses.resolveConversation、hasNativeContinuation、persist、createResponseStream
  ResponseSessionStore.get、findByResponseId、save、withLock
  Core.forwardChatCompletion固定Provider/account；Doubao.buildRequest、consumeStream、NodeProtocol
新增定义：
  DoubaoSessionState { version: 1, transport: node-http, status: ready|uncertain,
    conversationId, accountId, mode: 0, identityFingerprint }
  identityFingerprint = SHA256(所选账号ID及sessionid/deviceId/webId/fp的规范身份串) // 不保存原始凭据；不把动态msToken/CSRF变化当换账号
  PendingDoubaoState = 每次请求隔离的临时ACK/消息状态；只有完整结束后提交
  DoubaoSessionFlow = first|continue|legacyReplay|reject；旧observed字段不是ready状态
操作流程：
  先用两轮纯Node短文本诊断验证最小conversation_id续接字段和第二轮记忆 // 所选账号资料仅内存，断CDP后发送，不使用原有私人会话
  参考browser_client仅作为候选：continue时local_conversation_id=''、need_create_conversation=false、sub_conv_firstmet_type='0'
  已验证continue固定last_section_id=''和last_message_index=null；不猜测local_permissions // ACK为section_id并非旧last_section_id，首版不传回未验证section
  NodeProtocol只为first设置last_message_index=0，不再覆写continue已选择的状态
  Responses通过previous_response_id/conversation读取私有会话；仅version1+node-http+ready的豆包状态允许原生续接
  首轮和legacyReplay沿现有完整文字输入；continue只传新增input，保留必要本轮instructions及工具转文字契约
  adapter收到状态后校验账号/身份/模式；冲突在发送前拒绝，不换号/新建或重放
  ACK仅更新PendingDoubaoState；重复ACK不得换conversation_id，continue ACK必须与已存会话一致
  SSE_REPLY_END带msg_finish_attr/answer_finish_attr的是已观察的中间结束通知，不提交状态；等待最终无该属性的结束事件
  正文非空、最终SSE_REPLY_END及取消检查通过后输出ready状态 // HTTP200/ACK本身不是成功；缺ACK首轮不能获得原生复用状态
  Responses完成持久化后才能释放豆包会话锁，保存历史和nativeState到已有私有存储 // 无新增配置接口，无Cookie/token/profile落库
  ResponseSessionStore.save对整个JSON集合的读改写串行；不同会话生成仍并行，防止并发保存丢失nativeState
  ResponseSessionStore.acquireLock提供可释放租约，复用同一locks链；等待接受signal/时限，单会话最多16/总256个新租约
  Responses从进入请求时建立内部非枚举doubaoDeadlineAt；Node控制器及HTTP握手使用剩余预算，排队不重置120秒
  豆包Node流式锁覆盖握手、读取、持久化；取消、超时、提前return和未消费都关闭上游并幂等释放；生命周期按原120秒界限
  同会话取消排队的租约仍在旧任务链后释放，不能越过正在执行任务；其它Provider保持原有流式行为和请求协议
  continue发送后失败/取消且上游位置不确定：原会话status=uncertain，已完成历史不变，下次明确拒绝并提示新建 // 不静默重发或使用旧父状态
  只有实际原生continue才标记uncertain；Pi snapshot发起的新上游失败不误伤旧会话
  uncertain写入失败时当前实例以有界禁用集合阻断续接，容量满则保守阻断豆包原生continue；固定存储错误不泄露路径
  外层Pi snapshot明确重建上游状态，delta续接；新模板/模型/系统提示沿现有LLM指纹开新外层会话
  未传会话引用的chat/completions继续无状态；Cookie-only文字拒绝并提示补齐，不从Node复用能力推定可用
验收边界：
  新增20项模拟自测通过；Chat2API201/204，同3项既有Windows chmod；普通LLM/Core/Responses24/24、旧TTS19/19
  独立审查无Important/Critical；过时注释修正，排队后重置时限先RED再GREEN修复 // 无新真实请求、无主服务操作
  模拟覆盖首次/续接/旧观测、缺ACK、状态字段错误、账号模式冲突、403/EOF/断连、并发流与未消费释放、重建Store恢复、Pi和Qwen回归
  真实普通模式两轮验证同上游ID与第二轮记忆，正文/秘密/原始帧不保存 // 主服务器不启动、停止或重启
  优先npm run check:chat2api；现有llm-service-responses及TTS定向回归 // 正式部署/设备/长期验证另列，不等同模拟数量
```

```text
2026-10-13 初次独立Node协议接入记录（后续会话复用以文首实现为准）
  实现验收：正式Provider工厂与CoreAdapter在CDP断开后，Node自行构造的新会话流式/非流式均实际回复OK并正常结束
  模拟验收：新增8项，Chat2API181/184（同3项既有Windows chmod），Ogg/WASM21/21，旧TTS19/19
  整块profile脱敏与混合账号池两项独立审查问题先RED再GREEN；不重启服务、不保存真实凭据、不出包
  审查修正：Secret.sanitizeSecrets剔除整个nodeProfile及msToken，所有预览/列表/配置导出均不得泄露身份资料
  DataStore.listDoubaoNodeAccountIds只在内部读取账号集合，返回启用且active的Node账号ID // 不新增秘密HTTP接口
  Core无显式账号映射时优先Node账号候选池；LoadBalancer.allowedAccountIds在调度前筛选，仍保留Provider/额度检查
  显式账号映射则使用requiredAccountId，不在不可用时退选；无Node资料则提示重新登录补齐 // 无发送后重试/换传输
  Credentials { cookie, nodeProfile?: { deviceId, webId, fp, userAgent, pcVersion?: '3.41.0', msToken?: string } }
  nodeProfile存在表示该账号显式使用node-http；不存在拒绝文字并提示补齐 // 不自动换传输或账号
  normalizeNodeProfile只接受规定字段、十进制设备ID、安全fp/UA/version/token；返回规范副本
  normalizeCredentials仍校验原六类Cookie，nodeProfile.fp必须等于同账号s_v_web_id // Cookie-only旧包不扩展权限
  NodeProtocol使用固定https://www.doubao.com/chat/completion及官方网页profile aid=497858
  查询包含设备ID、web/tea ID、fp、随机web_tab_id、公开版本/platform字段；真实msToken可选，不生成假token
  不使用a_bogus，不连接CDP、不执行页面fetch/签名；UA来自账号profile，CSRF来自其Cookie
  请求body采用已验证的新会话字段：last_message_index=0、text block is_finish/patch_type、create_time_ms=0
  设置support_chunk_delta=true、chat_ability={}、ext.fp与use_submit_pipeline=1；tts_switch=false
  文字历史继续由调用方重放，mode=0/1/3仍沿原别名；原生续聊与think/expert真实能力不扩大声明
  适配器只使用Node；无profile不发送；Node失败不fallback、不自动重试
  最终URL必须严格等于本次构造URL，禁止跳转或Provider覆写，保留120秒/8MiB/取消/固定脱敏错误
  Core先读取初选账号的秘密；nodeProfile账号走Node且显式账号映射必须一致，缺profile账号提示补齐，不读取网页开关
  模拟测试覆盖profile导入校验、传输隔离、错误/跳转/取消、模式与现有Provider/网页/TTS回归
  当前诊断只读所选页Cookie/storage后断CDP，Node自行构造新会话：流式及非流式均实际回复OK且正常结束
  正式实现后再用同一内存资料验证正式适配器；本轮不保存真实凭据或改真实服务配置
```

```text
2026-10-13 扩大授权后的纯Node协议诊断（进行中，尚未修改生产运行代码）
  用户授权继续使用当前所选Chrome会话，参考其它网页Provider，持续排查纯Node收发
  所选官方target仅用于一次性取得当前账号凭据及协议元信息；全部仅在进程内存处理
  拦截并终止官网生成的短消息请求；断开CDP后由Node直接发送，排除页面fetch承载网络
  已观察完整官网请求由Node发送时HTTP200及正常SSE结束，无业务错误 // 网页生成签名仍不算独立Node
  接着验证删除a_bogus后的请求，再验证Node自行构造的新会话请求与参考SDK协议
  每个候选对应明确差异，限制请求时限/响应容量，不盲目自动重发，不处理验证码
  只输出状态、事件种类和数字业务码；不记录Cookie、设备ID、签名URL、原始响应
  只有获得自行构造请求的有效正文和结束事件，才设计账号绑定的Node协议profile
  预计运行影响：doubao-chat-adapter及协议模块、credentials验证、CoreAdapter/Runtime调度与模拟测试
  新生产实现须另先说明最终文件方案并同步本spec；旧Provider与既有网页模式保留
```

```text
2026-10-13 新增授权：沿用刚才成功的原标签会话做一次纯Node发送（仅诊断）
  仅连接已选定原Chrome官方target，提取当前/chat/<id>会话标识及白名单Cookie到内存 // 不读旧消息正文
  取得页面UserAgent后断开CDP；不调用页面fetch、frontierSign或其它签名函数 // 本次网络请求由Node Axios发送
  在诊断wrapper中修改现有body：conversation_id=当前会话、local_conversation_id=''、need_create_conversation=false、sub_conv_firstmet_type='0'
  Node仅发送“请只回复：OK”一次，使用同会话Cookie/CSRF、当前浏览器UA和官方Referer // 不复制/重放历史，不伪造参数，不重试
  仍固定官方/chat/completion，不重放已过期a_bogus或签名URL // 缺网页/桌面profile仍须单独注明，不把此诊断当完整协议复现
  按既有SSE解析器验证完整回复，旁路只提取事件名/数字业务码及状态 // 不打印保存Cookie、会话ID、原始帧/正文
  失败停止，清理请求/内存；原Chrome和标签保持，不改生产代码/配置或主服务器
  实际结果 {attempts:1,boundExistingConversation:true,cdpDisconnectedBeforeSend:true,newConversation:false,httpStatus:200,responseType:sse,businessCodes:[718013001],completeReply:false,code:doubao_upstream_failed,errorStatus:502,elapsedMs:529}
  本地/参考源码无该数字专门映射，含义未确认；它不同于710022004 // 不把业务失败等同HTTP502或已知验证码
  这次没有网页签名/query profile完整复现，只验证现有Node路径增加当前会话等字段 // 授权一次已用完，不重试
```

```text
2026-10-13 用户新增明确授权：用当前正在使用的原Chrome豆包标签测试
  只选择已核对的唯一官方target，不新建页、不导航、不关闭原页 // 允许在用户当前会话追加一次短测试
  发送前重新检查输入框为空，防止覆盖用户草稿；只发“请只回复：OK”一次
  仅观察包含该测试文本的官方chat POST；阻断同一测试的重复提交及tts_switch=true // 不影响其它文字或标签
  记录path/query字段名/body字段结构/HTTP和业务状态/本次生成的回复摘要，不读旧聊天正文或Cookie
  finally恢复临时请求观察/拦截状态、移除监听、仅断CDP，保持原标签与Chrome // 风控即停止不重试
  实际结果 {attempts:1,path:'/chat/completion',mode:0,newConversation:false,ttsEnabled:false,httpStatus:200,responseType:sse,businessCodes:[],completeReply:true}
  正常结束含SSE_ACK/STREAM_MSG_NOTIFY/STREAM_CHUNK/SSE_REPLY_END // 未保存/输出回复正文或登录凭据，文档只记录端点与字段名
  同样脚本输入在原标签成功，临时页新会话失败；此差异不是已证明的单一原因 // 官网UI成功与本项目bridge/纯Node验收分别记录
```

```text
2026-10-13 新增一次真实浏览器收发及路径观察授权：
  在当前Chrome唯一官方豆包page的browserContext创建自有临时测试页，原标签不导航 // 不读取Cookie或旧聊天正文
  仅通过官网输入控件发送“请只回复：OK”一次，遇验证码/风控停止、不重试
  只观察此测试页的固定官方聊天POST，记录pathname、query字段名、非秘密body结构及本次回复 // 不输出签名URL或字段值
  回复仅属于新建测试会话；不读取其它页面响应或用户历史 // 临时原始流只在内存处理，不保存
  finally关闭自建临时页并断调试连接，不关闭原标签或Chrome // 不改配置/运行代码，不操作主服务器
  本次实际结果 {attempts:1,path:'/chat/completion',mode:0,newConversation:true,ttsEnabled:false,httpStatus:200,responseType:sse,businessCode:710022004,completeReply:false}
  实际query包含a_bogus/msToken及设备/版本/平台/时区字段，body另含user_context // 只记字段名，不保存值或完整URL
  用户随后报告手动浏览器消息成功，此为用户证据；尚未观察该成功请求 // 自动化临时页失败不能推定账号/整个浏览器失效
  待明确成功请求来自原标签或新标签，再比较手动成功路径 // 不自动重发，不默认增加真实请求授权
```

```text
2026-10-13 纯Node候选协议（待确认）：
  DoubaoDesktopProfile {deviceId,webId,fp} // 账号级元信息，经独立授权取得与所选Cookie一致的来源，不用SDK硬编码/随机身份
  buildDoubaoDesktopRequest(input,accountCookie,profile) → 固定官方URL/桌面参数/有界body/CSRF头
  desktopParams按client.py._security_params公开协议复核aid/版本/client_platform等 // 不把网页aid和桌面profile混用
  NodeHTTP→现有SSE/结束校验→completion；403业务错误/验证码/过期即停止 // 不自动打开浏览器或重试
  msToken仅取真实Cookie中已验证字段，缺失与过期不伪造 // SDK未提供已证实的完整刷新链路
  第一阶段新增独立协议模块和假凭据mock，不访问真实Chrome/账户，不发请求；真实验收需另获授权
  真实完整回复验证后，第二阶段明确desktop-http transport及所选账号，不要求target/context // 不隐式从browser-fetch回退
  第二阶段须先批准文件/账号元信息schema/WS配置方案，再改运行代码 // 此处仅方案伪代码，不代表已实施
```

```text
2026-10-13 参考项目调用链核对（源码事实，未运行）：
  doubao2api.__main__ → unified_server.run_server → lifespan → BrowserClient.start
  BrowserClient自行launch_persistent_context或launch/context/page，官网登录后提取页面参数并设置桥接 // 不是默认连接用户Chrome9222
  /v1/chat/completions → _collect_chat_response或_stream_chat → BrowserClient.chat_completion
  chat_completion._build_query_params → '/chat/completion?' + query → _browser_fetch_stream → page.evaluate(fetch)
  页面credentials:include + 页面CSRF + 官网fetch封装 → reader → __doubaoStreamChunk → Python Queue → OpenAI响应
  独立DoubaoChatClient SDK → aiohttp.session.post + _security_params桌面端profile // 与服务BrowserClient不是同一传输
  当前项目桥接只有固定'/chat/completion'，未补query profile与fetch hook readiness // 后续评估先更新方案，不能未经确认改运行代码
  不把参考注释/默认字段/自动验证码处理分支视作当前真实可用证据，不启用自动重试或验证码绕过
```

```text
2026-10-13 新增一次真实Node文字验证授权（仅诊断，不改运行代码）：
  用户明确允许使用Chrome凭据，执行一次doubao普通模式极短文字请求 // 不包含TTS、网页fetch测试或自动重试
  只连接127.0.0.1:9222，要求唯一官方豆包page；多个候选时停止选择 // 不访问其它标签正文
  从所选page的CDP读取固定官方/chat/completion来源Cookie，筛选既有6个白名单字段，仅内存使用
  当前createDoubaoChatAdapter不传browserTransport，直接Node POST到固定官方来源 // 验证Node路径而非页面fetch
  input为“请只回复：OK”，model=doubao，60秒总超时，上游request计数最多1
  输出仅HTTP状态、固定错误码、是否完整回复、回复字符数及OK匹配 // 不输出Cookie、原始错误、SSE帧或签名URL
  403/验证码/失效即停止；finally销毁当前请求、清空临时引用、仅断调试连接 // 不关闭用户Chrome，不操作主服务器
  未实际发请求的前置失败与真实POST失败分别记录；不由一次正例宣称所有账号/模式可用
  本次实际结果 {attempts:1,officialPageCount:1,httpStatus:200,responseType:sse,completeReply:false,code:doubao_risk_control,errorStatus:403,elapsedMs:502}
  HTTP状态200与适配器业务风控映射403分别记录 // 没有保存原始上游码或SSE正文，不猜测其数值
  新增一次授权已使用完；停止请求，不自动切换网页fetch或TTS继续验证
```

> 历史状态（2026-10-12，纯Node现状以文首2026-10-13验收为准）：文字适配器及HTTP断连取消已实现，Node文字直连403，不能宣称可用。用户已批准B方案，完整Ogg校验、worker解码及Frontier/speech/TTS模拟接线均已实现；豆包网页朗读默认禁用、标为实验性，真实运行未重新验收。受控Chrome网页fetch已获独立实施确认并完成离线接线，默认关闭；真实账号/官网运行仍待另授权验收。后续最小只读授权仅用于核对公开模块协议，未读取Cookie/聊天内容，也没有新聊天或合成。

> B实施完成：固定ogg-opus-decoder@1.7.5；speech、缓存及下载保持WAV/.wav/audio/wav，A不实施。执行记录见 `docs/task/20261012_豆包网页WAV解码实施计划.md`。最终Chat2API159/162通过，3项仍为既有Windows chmod断言失败；TTS/解码/配置/浏览器回归95/95，既有播报与并发回归19/19。独立审查的总时长和权威音色回填两项问题均先RED再修复。

> 后续只读授权：用户允许对唯一既有豆包标签只读核对最小参数。已从加载的公开模块T57/VgE及语音SDK核对普通网页账号业务标识、TEXT_TTS=5、默认音色与protobuf；未读取/保存Cookie、聊天正文或发送新聊天/合成。此前协议资料门槛已补齐，按批准计划继续模拟接线；真实运行仍未重新验收，Chrome网页fetch模式仍未获实施确认。

```text
任务3/4新增定义与落实流程：
  DoubaoSpeechProtocol { 固定Frontier来源, 普通网页公开appkey, VoiceGenie, TEXT_TTS:5, 24kHz, ogg_opus }
  DoubaoSpeechRequest { voice:zh_female_wenroutaozi_uranus_bigtts, speed:1, volume:100, format:wav }
  DoubaoSpeechState { taskId, sessionId, phase, currentSentence, sentences, totalAudioBytes, eventCount }
  按公开protobuf字段编码请求/解码响应，严格UTF-8、wire类型、字段长度/重复及1MiB帧上限 // 不复制SDK日志/重连代码
  普通网页业务appkey固定来自公开代码；飞书/企业账号暂不支持，不换appkey重试 // Cookie仍由所选Chat2API账号提供，不从Chrome导出
  Session使用空conversation/message及新建文本会话；固定普通助手botId，默认音色和1倍速 // 不借原网页聊天回复
  音色是公开默认值，未重新实测；业务Provider默认禁用并标实验性 // 不把静态配置核对视为登录或真实成功
  Chat2API模型映射中为doubao-chat显式指定doubaochat与preferredAccountId // 复用已有映射业务入口，TTS配置不保存账号
  LoadBalancer新增可选requiredAccountId，严格限制对应账号且检查健康/启停/额度/秘密 // 找不到不按偏好回退；旧调用保持
  normalizeSpeechRequest先按模型描述校验：豆包1–1000字符/UTF-8≤4000字节、固定voice/1倍/100音量、只wav // 无效请求不读账号
  generate共享60秒deadline与当前HTTP的AbortSignal；同账号上游生成有界FIFO // 当前队列见文首，取代旧busy立即拒绝
  WS打开发送StartTask；TaskStarted核对taskId并发送StartSession；SessionStarted发送一次BidirectionalTTS与EndTTS
  按TTSSentenceStart→TTSResponse→TTSSentenceEnd收集每句Ogg；最多64句/10000事件，总压缩音频≤16MiB // WS帧不等于Ogg页
  TTSEnded要求处于句间且至少有完整句子，关闭当前WS后才逐句调用decodeOggOpusToWav // 不拼接多个Ogg逻辑流
  各句WAV必须同采样率、单声道16位PCM；累计PCM含WAV头≤16MiB且累计样本数/采样率≤120秒，wrapPcm包装一次 // 每句独立校验EOS/pre-skip/gain，不能用分句绕过总时长
  固定官方WSS与Origin，Cookie只在当前连接内存；响应401/403/429映射固定错误，清理握手/WS // 零自动重连/重试
  定时Ping/Pong只维持当前任务；取消、超时、错任务/会话/顺序、协议错误时终止连接并释放监听/timer
  Proxy speech在读取请求体后复用withResponseCancellation，仍validateWav/audio/wav // 不新增HTTP配置接口
  新doubao-chat TTS薄层返回WAV Buffer；业务仅AI/Agent及模板，默认禁用，端点/模型/音色/速度/音量固定
  setTtsProviderConfig仍规范化持久化/权威广播/重连补发；网页UI无Cookie/账号输入及无效滑条 // 查询音色及自测均不合成
  权威配置回填先更新来源控件状态，再写服务端音色；用户离开豆包固定音色时才清空旧值 // 防止广播或重连清空其它来源已保存音色
  全部测试使用假Cookie与fakeWS/临时账号库，本轮不调用真实上游 // 实际账号、音色与播放端验收继续单列
```

```text
已有声明：
  Chat2API.ProviderRegistry、DataStore、ModelMapper、LoadBalancer、CoreAdapter、ResponsesService
  Chat2API.CredentialValidators、ManualAccountService、ProviderAdapters、SpeechService、Runtime
  TTS.ProviderPolicy、ProviderSettings、ProviderRegistry、ProviderService、ttsProviderConfig
  normalizeSpeechRequest、validateWav、既有 Bearer 鉴权和播放缓存

新增定义：
  DoubaoChatProvider { id: doubaochat, allowedOrigin, credentialCookie, modelModes }
  DoubaoTextRequest { latestText, mode, conversationId, sessionState }
  DoubaoStreamState { answer, thinking, conversationId, sectionId, finished }
  DoubaoSpeechProfile { model: doubao-chat, voice?, speed?, volume?, audioFormat }
  DoubaoFixedError { statusCode, code, safeMessage }

操作流程：账号与文字 Provider
  从官方豆包页面只读确认当前请求版本和来源，不打印登录凭证 // 参考项目版本可能滞后
  ProviderRegistry登记doubaochat与doubao/doubao-think/doubao-expert别名 // 模型是网页思考模式，不冒充独立上游权重
  DataStore把doubaochat加入内置集合，账号凭据只用已脱敏的credentials.cookie // 支持现有秘钥判断和账号导入
  ManualAccountService校验Cookie长度、名称及字符 → 允许新增并保存credentialVerification=format-only // 会话列表校验仅记录，不把格式合法当真实身份验证
  DataStore允许既有账号凭证包经预览及明确确认导入有效格式的Cookie // 导入只验证结构，不能宣称登录态或签名可用
  CredentialValidators仅在证实固定官方HTTPS只读身份校验协议后允许手动入库 // 未验的生产功能保持阻断
  CoreAdapter选择豆包账号和独立文字适配器 // 保留原鉴权、负载均衡和其他Provider
  如果入站含图像、音频、视频或网页不能原生完成的工具，明确返回能力错误 // 只接纯文字
  将doubao映射快速、doubao-think映射思考、doubao-expert映射专家 // 提交网页已证实的模式枚举
  对系统指令、用户文本和可选历史制定确定性拼接边界 // 不把老历史在原生续聊时再次发送
  当前每轮独立创建网页会话并重放调用方文字历史，ACK仅保存 observedConversationId // 现场只见首轮，不能启用Responses原生续接
  保留已验证原生续接后才切换增量模式的扩展位置 // 避免错误叠加本地历史和上游会话
  生成有界请求体并在官方来源发送，保留Cookie/CSRF但不发送Bearer ticket // 不混用其他Provider鉴权
  按UTF-8增量解析SSE_ACK、CHUNK_DELTA、内容块、错误与结束事件 // 不能把心跳/思考误作正文
  ProxyService在读取POST请求体后为当前HTTP响应创建AbortController // 只绑定对应HTTP请求，不能全局中断其他账号
  响应close且尚未正常完成时AbortController.abort，finally解绑监听 // 避免客户端断线后继续消耗豆包网络与配额
  CoreAdapter把可选signal传到context；ResponsesService仅透传来自自身HTTP请求的signal // 兼容现有Provider接口
  流模式逐段产出OpenAI delta；非流模式等待完整结束并聚合成completion // 保持旧HTTP接口语义
  验证空回复、异常中断、非SSE、超时、验证码、登录失效和风控码 // 不误报200空正文成功
  把上游原始错误转换为固定中文错误，销毁中止的上游请求 // 不泄露CSRF、Cookie、msToken和签名URL

操作流程：网页语音前置验证
  一次授权短对话已确认 POST /chat/completion 返回SSE_REPLY_END // 现场是文本网页接口，不是TTS
  对唯一回复的一次授权朗读已确认新建 voicegenie WebSocket 并交换二进制帧 // 只能证明网页朗读通道，不能宣称格式或任意文本
  额外授权的一次Node HTTP /chat/completion返回403风控，停止直接重试 // 纯Node网页文字当前未验收
  额外授权的Frontier独立文字测试返回TaskStarted→SessionStarted→TTSResponse→TTSEnded // 没有原对话ID，证实一例短文独立合成
  官方protobuf TTSResponse.data为Ogg Opus，实测包含OggS起始标记 // 不是PCM或WAV
  用户选择B后仅新doubao-chat内部收集完整Ogg并解码为WAV；旧模型、缓存、MIME和播放器契约保持 // 不提供Ogg响应分支
  待用户确认browser_client方式：仅受控本机Chrome、匹配被选豆包账号、网页内fetch，不绕过验证码 // 离线Android不能隐式依赖浏览器
  如果不能合成外部传入的任意文本，标记doubao-chat为未支持并停止业务接入 // 不能用开放API或播放已有回答冒充TTS
  如果音频不能通过用户选定格式的完整性校验，停止语音接入并记录错误 // Ogg不能标记为WAV，不从OggS魔数推断完整性

操作流程：已实现的B方案WAV接入（模拟验收，真实运行未验收）
  SpeechService通过显式model映射选择qwen或doubaochat账号与对应适配器 // 千问旧默认完全不变
  语音请求先校验长度、voice、speed、volume、wav格式与60秒总时限 // 非法请求不触碰账号
  选取启用且有有效Cookie的网页豆包账号，重读权威Provider和当前凭据 // 不复制Cookie到TTS配置
  DoubaoSpeechAdapter按实测网页协议合成有界完整音频 // 禁止使用doubao-api密钥和seed-tts-2.0
  如果返回可验证PCM，依据实际采样率包装WAV；其他格式须有确证的解码方案 // WAV校验不能放宽
  validateWav验证成功后返回audio/wav；失败固定错误并记录账户健康 // 不切换system或doubao-api
  TTS薄适配器传指定文本与固定参数；音色列表只有公开默认ID并标available=false、待真实验收 // 查询不合成，不承诺其它音色
  TTS Provider只开放ai_reply与agent_reply，模板和AI默认可选 // 文本阅读/系统播报沿用原服务
  setTtsProviderConfig规范化持久化、广播权威值、连接补发；无凭证字段 // 防止浏览器配置泄漏账号

定向自测：
  Provider模型列表、账号导入/脱敏、手动登录成功失败、异常Cookie与Provider禁用
  流式分片、非流式结束、思考/正文分离、原生续接/重放、取消/超时/风控/无工具能力
  已验证的音频编码、WAV截断与容量、旧qwen-chat模型/默认音色、doubao-api隔离
  TTS AI/Agent模板、跨Provider音色、权威配置和浏览器选择、失败不静默回退
  优先 npm run check:chat2api；其余使用既有TTS定向测试脚本 // 不自动重启用户服务器
```

## 历史：受控网页文字模式（2026-10-15已删除）与旧音频方案比较

> 用户已确认实施文字网页fetch；以下新增实现约束先于运行代码更新。本轮仅离线验证，真实绑定/聊天和凭据读取仍未授权。

```text
实现接口：
  normalizeDoubaoWebConfig(raw) → {enabled:false,port:9222,accountId:'',targetId:'',contextId:'',allowSessionCheck:false}
  enabled=true必须提供账号/target及allowSessionCheck=true // 勾选仅授权运行时选定页面sessionid内存比较，开发不执行
  createDoubaoBrowserBridge({getConfig,dataStore,connect}) → {request,listTargets,cancel}
  request({data,accountId,signal,limits}) → {status,headers,data:Readable} // 接口供现有文字解析器消费
  本机/json/version不接受重定向；有界JSON且CDP websocket必须127.0.0.1同端口 // 不连接远端浏览器
  根据targetId只选择一个页面并严格核对https://www.doubao.com及contextId // 不访问其它页面正文或凭据
  在allowSessionCheck门槛内通过所选页面CDP仅取官方来源sessionid内存比较账号库 // 不保存Cookie、不复制至fetch、不返回身份值
  页面固定fetch('/chat/completion')用credentials:include及页面内CSRF，redirect:error // 不重试、不读取错误正文
  页面按requestId保存临时reader/controller；服务端按消费速率每次拉取≤64KiB原始响应片段 // 单个上游块≤512KiB、总8MiB
  浏览器字节经既有SSE UTF-8/模式/完整结束解析，不在页面先解析JSON // 不丢失分片或吞协议错误
  120秒共享期限覆盖连接/身份检查/页面fetch/流消费；迟到连接立即断开 // 不关闭用户浏览器或标签
  每500ms核对配置/账号启停/凭据指纹；主frame导航、target销毁、CDP断线和HTTP取消撤销任务
  Core只对豆包网页传入requiredAccountId且拒绝映射/续聊账号冲突 // 其它Provider保持原调度，网页禁用不回退Node
  固定doubao/think/expert别名在运行模式中不得映射至其它Provider；默认Provider限定doubaochat // 防同名自定义模型绕过绑定
  runtime注入bridge及权威配置；WS模块规范化config.set('doubaoWebRuntime')、广播及初始化补发 // 保存不连接Chrome
  listTargets只在控制端明确点击时查询本机公开CDP target元数据，只回官方origin/targetId/contextId // 不读Cookie/页面正文
  控制端新独立JS面板继承Chat2API账户管理入口，WS保存默认禁用配置；自测仅检查配置 // 不新增HTTP配置接口
  隔离Chromium测试用虚构sessionid，拦截所有网页请求并本地回mock官网HTML/SSE // 真实CDP/page.fetch接线验证不向豆包发送网络
  连接前开始权威配置/账号指纹监控；读取页面Cookie和执行fetch前重新核对授权 // 撤销不等待首个监控周期
  页面fetch函数自身检查location.origin，注册主frame监听后再核对当前页面origin // 防target.page等待间导航竞态
  CDP创建/send/detach都参与同一取消/截止竞速，metadata目录全流程≤5秒 // finally不能使任务无限pending
```

```text
普通LLM接入（已批准并完成离线接线）：
  项目普通LLM配置.apiUrl指向所部署Chat2API的/v1/chat/completions，model选择doubao // 地址/端口由用户部署决定，不修改真实配置
  普通LLM→现有Chat2API鉴权与CoreAdapter→doubaochat文字适配器→已明确绑定页面内fetch
  新浏览器bridge只负责当前固定同源请求及有界原始响应分片；复用现有SSE解析和模式枚举 // 不新增普通聊天业务服务
  通过现有WS/config.set保存非秘密运行配置，默认disabled；运行时限定所选账号及target/context // 不新增配置HTTP接口
  真正建立绑定前须可靠核对账号一致性，无法核对即拒绝 // 不猜测身份，不将本轮询问当凭据或真实聊天授权
  首轮开发使用本地模拟页面/transport，验收流式与非流式、取消、导航撤销、403及无换号/重试 // 真实官网请求另授权
```

```text
已有声明：
  DoubaoChatAdapter.buildDoubaoRequest、consumeDoubaoStream、createRequestControl
  CoreAdapter.forwardChatCompletion、LoadBalancer.selectAccount、Runtime
  SpeechService.generate、ProxyService.withResponseCancellation
  TTS.ProviderService.generate、AudioCache.storeAudio、AudioHTTP.serveTtsAudio
  Config.get、Config.set、控制端身份检查、WebSocket权威广播与连接初始化
  浏览器Audio播放队列、DisplayLipSyncAudio、旧WAV播放端

新增定义（网页模式已实现，方案A对象仅比较）：
  DoubaoWebRuntimeConfig { enabled: false, port: 9222, accountId: '', targetId: '', contextId: '', allowSessionCheck: false }
  DoubaoBrowserBinding { accountId, targetId, browserContextId, generation, authorized }
  DoubaoBrowserBridge { binding, requestId, controller, reader, boundedQueue, deadline }
  DoubaoSpeechProfile { model: doubao-chat, voice: 唯一已验音色, speed: 1, volume: 100, sourceFormat: ogg_opus }
  ValidatedSpeechAudio { audio, format, contentType, extension, codec }
  OggStreamState { serial, pageSequence, pendingPacket, headers, granule, eos, totalBytes }

操作流程：非秘密运行配置与严格账号绑定
  控制端通过带type的setDoubaoWebRuntimeConfig提交显式启用及账号选择 // 不新增HTTP配置接口
  服务端规范化配置并经config.set保存；广播doubaoWebRuntimeConfig权威值，连接初始化补发
  未收到配置、配置禁用或Android离线服务没有受控Chrome时使用disabled默认值 // 不启动Chrome、不尝试Node回退
  只连接本机127.0.0.1指定端口；校验CDP返回的WebSocket仍为同一本机端口 // 不接受远端CDP或重定向
  用户明确选择并授权唯一豆包target及其browserContext，形成内存绑定 // 不扫描私人页面、Cookie或聊天历史
  真实绑定校验需要额外授权；显式allowSessionCheck授权后，所选页面CDP官方来源Cookie中的sessionid仅在内存与所选账号比较 // 本轮开发不读取真实凭据，不导出/打印/保存Cookie
  未能可靠核对同一会话时绑定失败，不能仅凭豆包网址或已登录头像宣称账号匹配
  调度先限定doubaochat和绑定accountId，再检查Provider启用、账号健康及额度 // preferredAccountId原有偏好回退不满足此约束
  显式模型映射到其他账号时返回绑定冲突，不换号；旧Provider保留原调度契约
  target关闭、导航、context变化、凭据更新、配置禁用或CDP断开时撤销绑定并取消进行中请求
  同一绑定只允许一个上游任务，忙时明确拒绝 // 不建立无限队列、不与其他请求共享控制器

操作流程：登录网页内fetch
  复用文字验证、模式枚举及请求body；网页传输不构造Node Cookie头 // Cookie及CSRF留在被授权页面内
  对绑定页面执行固定同源POST /chat/completion，credentials为include // 使用官网已有fetch，不手算签名、不注入stealth
  页面内AbortController按requestId登记；桥接仅返回状态、MIME及有界响应分片 // 无Cookie、签名URL、原始错误正文
  每次分片等待服务端接收确认，保留现有UTF-8和SSE完整解析 // 不照搬参考项目忽略非法JSON的行为
  文字总时限120秒，请求256KiB，流8MiB，事件512KiB，正文2MiB // 复用既有更细事件/块上限
  只接受200及text/event-stream；按固定错误映射处理403、401、429、协议错误 // 风控立即停止，无自动重试
  复用正文/思考分离、SSE_REPLY_END及历史重放；不新增未经证实的原生续接
  HTTP断连、迭代return、超时或绑定撤销时取消对应页面fetch及reader，清理桥接监听与队列
  释放CDP时只断开调试连接；不关闭浏览器、target或其他用户页面

操作流程：Frontier独立短文语音与Ogg完整性
  按模型契约先检查input、voice、speed、volume及response_format，再选账号 // 旧模型限制保持不变
  新模型本地首版限制为1至1000字符且UTF-8不超过4000字节 // 项目保护策略，不宣称已验证上游长度上限
  新模型只接受唯一已验音色及speed=1、volume=100；缺失值使用明确默认 // 未验参数拒绝，业务速度0对应1倍
  音色标识及协议字段从可复核的公开协议补齐；未能补齐时保持Provider不可用 // 不发新真实请求推测参数
  独立TEXT_TTS任务不创建聊天、不复用已有回复 // 已有一例Node Frontier成功，不推定网页fetch能发送WebSocket
  Frontier首版采用已获一次正例的Node WebSocket路径，固定官方来源及显式选定的doubaochat账号 // 网页fetch不承载WebSocket，Cookie只在Chat2API运行内部使用
  实现前核对可复核的会话鉴权字段和protobuf；字段不足则阻断，不猜测或改用页面WebSocket // 额外真实请求和凭据访问仍需另授权
  文字与语音都严格使用配置选定账号；语音不借用其它Chrome标签，不因文字403自动触发合成 // 不在两种语音transport之间回退
  按任务/会话状态表处理TaskStarted、SessionStarted、音频事件、TTSEnded // 拒绝错会话、错误顺序及提前关闭
  只提取TTSResponse中的音频载荷，按实际容器结构逐页组装 // WebSocket帧边界不等于Ogg页面/包边界
  验证Ogg版本、页长度、lacing、CRC、serial和页序号、continued标志、OpusHead/OpusTags及受支持声道映射
  验证Opus包结构、48kHz单位granule和pre-skip、一致的BOS/EOS及无尾随垃圾 // 请求24kHz不改变Ogg granule单位
  必须同时收到TTSEnded与完整EOS；无EOS或片段结构不明则失败 // 不补写EOS、不把多段未知流盲目拼接
  限制总时限60秒、压缩音频16MiB、帧/事件/页/包容量和音频时长 // 超限在复制/解码前拒绝
  取消、403或鉴权失效后关闭当前任务连接，输出固定错误且不换号、不切其他Provider

操作流程：方案A，完整Ogg原样返回（比较记录，用户未选择，不实施）
  只有model=doubao-chat且response_format显式为ogg才进入该模型 // 缺失或wav均在触碰账号前拒绝
  输出ValidatedSpeechAudio { format: ogg, contentType: audio/ogg, extension: ogg, codec: opus }
  新TTS薄层传回该对象；旧Provider的Buffer按原WAV契约处理 // 不统一改写全部适配器返回值
  ProviderService按白名单格式验证并缓存；AudioCache显式新增ogg元数据和tts_mem_UUID.ogg
  storeAudio旧调用及storeBase64Audio默认WAV；TTL、容量、过期和历史WAV清理保持原规则
  ProxyService按校验结果发送正确Content-Type；AudioHTTP按缓存元数据处理GET/HEAD/Range/416/404
  浏览器播放前检查audio/ogg与opus能力；播放错误按既有队列结束语义释放 // 不静默回退Provider
  Android WebView及MMD音频进度需本地样本真机回归；Node Windows/Linux、C#和Go显示端不列入首版支持

操作流程：方案B，Ogg解码为WAV（已模拟接线、默认禁用、真实运行待验收）
  validateOggOpus先校验完整单一容器，返回channels/preSkip/sampleCount48k/durationMs/pageEnds // 固定上限并允许测试收紧，不放宽
  createOpusWavDecoder在容器校验后启动隔离worker，使用已安装ogg-opus-decoder固定版本1.7.5 // 无本机ffmpeg依赖
  首版只接受单声道Opus，音频时长不超过120秒，累计Float32样本不超过32MiB // 项目保护界限，不宣称上游能力保证
  使用Node worker_threads加载普通解码器，不嵌套浏览器WebWorker，不启用机器学习增强
  解码器最多同时运行2个worker，超出立即返回忙错误，不排无限队列 // 内存界限不能只依赖单请求上限
  Ogg验证首版只接单一serial、从0开始的音频granule和mapping family 0；链式流及非零初始偏移明确拒绝
  OggS/OpusHead/OpusTags以完整字节比较，不能用会清除高位的ascii解码 // 审查复现CRC合法的伪标签
  worker收集已验证的完整Opus包，重建一包一页、最小Tags的解码布局 // 固定codec-parser不能直接支持跨页Tags/continued
  完整音频包限定65024字节，超大padding拒绝；标签包保持512KiB上限 // 规范化的一包一页必须满足255段lacing上限
  保留原pre-skip及EOS样本数，解码布局头部gain归0；转PCM时按原Q8增益乘10^(gain/(20*256))再裁剪 // 不丢增益也不重复应用
  每段解码若errors非空立即拒绝；即使库返回了部分PCM也不能视为成功 // 官方库会继续越过错误，调用方必须收紧
  decoder.decode逐页接收音频，decoder.flush收尾；头部暂不产出PCM的零声道/零样本允许 // 空结果必须无错误且采样率合法
  校验解码错误、实际声道/采样率、有限PCM、pre-skip及末尾裁剪；以实际解码参数封装WAV // 不直接使用请求24kHz写头
  只把合法单声道Float32转为16位PCM并复用wrapPcm与validateWav // 不修改旧WAV函数和所有Provider返回类型
  对解码时限、PCM内存和WAV16MiB单独设界限；取消或超限终止worker
  terminate结束后再次检查signal/deadline，才交付WAV；worker完成/错误/退出均清理监听并释放容量 // 取消不能被异步释放阶段吞掉
  父线程再次validateWav并比对实际声道/采样率/样本数与Ogg granule // 不信任迟到或错误worker消息
  仅新模型增加wav输出；缺失response_format沿用wav，ogg或其它格式在账号读取前拒绝
  旧speech、缓存后缀/MIME和播放器保持现有WAV流程；不新增tts-speech-audio或Ogg缓存公开契约
  package/锁文件已安装精确版本；dependenciesPackage已置true，servicePackage保持true，minApk保持既有true // 需要打包不等于已出包
  在出包机验证Android Node的WASM/worker可用性；本轮不构建APK
  转WAV只解决音频播放格式；Android离线服务仍不会因此获得本机Chrome能力
  公开SDK由调用方注入参数，后续最小只读授权已核对公开T57/VgE定义并完成模拟接线 // 普通网页静态参数不等于真实登录成功，动态身份元数据与账号验收仍待确认

验收流程：
  全部账号/浏览器/Frontier测试使用虚构凭据及本地模拟transport // 不连接9222、不读真实配置或账号库
  覆盖默认禁用、非本机CDP、账号不匹配/换号、绑定撤销、严格调度、忙时拒绝、取消与无重试
  覆盖分片UTF-8/SSE、错误正文脱敏、慢消费者、EOF缺结束与所有容量界限
  覆盖Ogg跨帧分页、CRC损坏、页序/serial错、无头/无EOS、TTSEnded缺失、尾随垃圾与格式冒充
  用公开许可或本地生成的合成音频检验浏览器实际解码/ended/停止/下一句/Range；不保留真实用户音频
  本地Opus夹具经真实worker转换WAV、存现有缓存，以隔离HTTP验证GET/HEAD/Range/416 // 不启动主服务
  隔离Chromium用Audio播放并加载现有DisplayLipSyncAudio；核对ended清理、暂停/停止清理与下一句来源 // 无账号音频、无用户浏览器上下文，不代替Android真机
  方案B额外验证解码失败、WAV真实参数、PCM上限和worker终止；旧Provider行为与音色不变
  优先npm run check:chat2api与npm run test:mmd-production:tts；没有对应script的单测用node --test定向执行
  自测面板只核对能力和配置，不能自动触发聊天或语音 // 真实验收次数、文本、账号及凭据访问必须另获明确授权
  模拟通过仅说明实现契约；真实网页模式、当前账号及显示端兼容性分别标记未验收
```

```text
最终验收结果：
  当前实现对应任务20261012_豆包普通LLM网页fetch实施.md，所有运行实现与离线验证步骤已完成
  npm run check:chat2api → 173/176，失败为同3项既有Windows chmod // 不宣布全仓全绿
  TTS/解码/权威配置/隔离浏览器 → 97/97；npm run test:mmd-production:tts → 19/19
  三项独立审查分别新增失败测试后修复；隔离Chromium真实CDP/page.fetch接线通过 // 请求全部本地拦截
  生产JS语法及本任务diff检查；servicePackage=true，dependenciesPackage及minApk原值保持true
  真实账号/官网/当前用户Chrome不访问；think/expert及设备仍需独立验收 // 实现批准不扩大为真实请求授权
```

## Android完成保存与会话列表校验（2026-10-14，已确认实施L4）

```text
已有声明：
  Android RESULT_OK -> MainActivity.deliverChat2ApiLoginResult -> Chat2APIControl.completeNativeLogin
  /oauth/complete -> OAuthService -> credentialAdapters.validate -> DataStore.saveAccount
  ManualAccountService -> 相同凭据校验；账号列表读取公开accountInfo
  normalizeDoubaoCredentials/assertDoubaoProvider -> 固定来源、Cookie/CSRF白名单
新增定义：
  NativeLoginResult与SavedLoginResult -> 不同变量，禁止同名遮蔽
  DoubaoConversationVerifier -> 所选账号的一次只读验证，固定请求/解析/有界失败
  VerificationMeta -> method/status/checkedAt/errorCode，不保存会话内容
  元数据字段 -> credentialVerification/credentialVerificationStatus/credentialVerificationCheckedAt/credentialVerificationError
  同根目录账号写入队列 -> 保存/更新/删除/导入/验证结果比较并写入全部串行
  凭据版本 -> 规范化凭据的内部摘要，验证开始时取值，写入锁内比较；公开响应不含摘要
  内部credentialRevision -> 保存/更换凭据/导入时生成UUID，防止删除重建或相同凭据重新导入时误接旧结果；公开列表/导出剔除
  验证结果 -> format-only或conversation-list，不占用active/disabled调度状态
操作流程：原生保存
  接收原生回调 -> 验证success/state/provider与等待会话匹配
  nativeResult.credentials -> /oauth/complete一次 -> savedResult.account
  保存成功 -> 清理对应loginSession -> 刷新列表 -> 显示保存和验证状态
  保存失败 -> 明确错误，保留session供重试；不误清空或显示登录成功
操作流程：远端只读验证
  本地凭据非法 -> 原格式失败，不请求上游/不保存
  本地格式成功 -> 固定HTTPS POST /im/chain/recent_conv
  请求 -> cmd=3200/channel=2/version=1/sequence_id，pull_recent_conv_chain_uplink_body
  列表游标=首次/limit=1/not_need_message=true -> 不翻页、不读取或保存正文
  账号已有合规nodeProfile -> 仅允许已确认同源查询参数；缺失不伪造身份数据
  HTTP状态 + 已确认业务成功及列表结构 -> 解析验证结论
  首版成功契约 -> HTTP200 + status_code严格为0 + cmd严格为3200 + downlink_body及cells数组
  明确匿名标记或未知封装 -> 拒绝，真实接口响应结构仍待独立验收
  下行pull_recent_conv_chain_downlink_body.cells -> 空数组允许；不返回标题或详情
  HTML/重定向/业务拒绝/未知结构/匿名结果 -> 未通过，固定脱敏错误
  15秒/512KiB/取消 -> 及时失败，无重试、聊天、合成或验证码处理
  验证成功 -> accountInfo conversation-list与时间，页面显示会话列表已验证
  验证失败 -> 保存format-only及失败状态，不因网络问题丢失新增账号
操作流程：已有账号复验
  账号列表验证按钮 -> 现有管理鉴权 -> 指定accountId验证业务端点
  服务从账号库取得所选账号 -> 同一验证器 -> 元数据更新
  账号凭据版本改变/删除/Provider不匹配 -> 不写迟到结果
  失败复验 -> 撤销旧成功标记；导入/换凭据 -> 未验证，不继承来源状态
  公开返回 -> 脱敏账号和固定验证结果，不包含Cookie/请求URL/响应原文
验收：
  原生回调真实模块执行，虚构凭据保存请求1次/列表刷新1次
  失败/取消/会话不匹配/保存错误不串状态；其它网页登录Provider回归
  会话列表正常/空/登录失效/403/HTML/结构异常/超限/超时与版本改变
  登录保存失败不清session，远端校验失败仍可见未验证账号
  仅模拟/本地HTTP；真实已登录会话请求另需明确授权，不访问用户Chrome
```

## Android捕获保存与验证待办（2026-10-14，历史首版）

```text
Android登录候选 := 豆包官方来源 + 白名单Cookie集合
保存前检查 := 现有严格Cookie规范化，包括sessionid/CSRF与字符长度边界
豆包校验结果 := 允许保存 + accountInfo.credentialVerification=format-only
普通手动入口 := 同样允许格式校验后保存未验证账号
历史远端验证 := 首版仅记录；现由上方已确认L4接入，继续保留未验证可添加
禁止混淆 := 格式校验和Native捕获完成不等于远端登录验证
```

min41/code76为历史发布；本次新增代码未出包。真实账号捕获保存与只读会话列表契约仍待独立验收。

```text
本次离线验收：
  check:chat2api -> 243项/240通过，3项与修改前同为Windows chmod断言
  隔离Chromium -> 原生完成后账号可见/复验按钮与提示/原API映射流程2项通过
  本地HTTP端到端 -> 正式JS/OAuth/验证器/存储/列表：403仍保存，复验空列表通过
  非回环本机HTTP -> 无Key拒绝，已有Key通过，只取路径accountId，忽略请求体凭据
  同根目录并发账号写入 -> 不丢账号；导入/换凭据/删除重建 -> 迟到结果409
  独立只读审查 -> 无Important/Critical问题；真实官网/用户Chrome/Android真机未访问
  发布状态 -> 仅servicePackage=true，minApk/dependenciesPackage保持false；未构建/发布/重启
```

## 豆包长句多Ogg流接收（2026-10-15，已实现）

```text
已有声明 := validateOggOpus、OGG_LIMITS、decodeOggOpusToWav、豆包complete句缓冲与PCM合并
新增定义 := splitOggOpusStreams
按页长度扫描完整分句缓冲 → EOS边界划分 → 每段单流校验BOS/EOS/序号/CRC
累计子流数<=64、页数<=原上限、编码时长<=120秒、总压缩字节<=16MiB
按分句/子流顺序解码 → 各自应用pre-skip/EOS → 校验单声道PCM16与相同采样率 → 原累计限额/拼接WAV
缺完整流、损坏CRC、交错serial、重复BOS、尾部截断或超限 → 原audio/limit错误，不补页或播放部分音频
实测证据 := 同一句59027字节包含两个有效流，37100/21927字节；独立解码各成功，旧单流验证拒绝组合
验证计划 := 单/双流、CRC/序号/截断/交错/限额与取消；原句实网合成及整段播放待确认后复验
```

```text
已实现 := splitOggOpusStreams扫描页/EOS并逐流调用validateOggOpus；累加页数/packetCount/时长/压缩大小，最多64流
豆包接收 := 收齐原分句 → 合并压缩缓冲 → 全部流先严格验证 → 每流真实解码 → 单声道/采样率/PCM累计校验 → WAV
回归 := 音频35/35，Chat2API266/266；损坏第二流时解码次数为0，不返回部分音频
实网 := 原长句两流合并1051832字节、48kHz、10956.125ms；原文8段非静音、queued=8、末句喵～、errors=[]
边界 := 未推送设备播放；账号/配置不变，诊断原音频仅.cache，不提交Git
```
