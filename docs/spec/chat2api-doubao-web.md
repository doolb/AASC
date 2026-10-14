# 豆包网页账号Node文字与朗读 TTS 实现伪代码

当前约束以2026-10-15文首伪代码为准；注明历史的旧网页运行协议已删除，不属于当前实现。

## 2026-10-15 用户选择临时降低豆包分句并发

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
  generate共享60秒deadline与当前HTTP的AbortSignal；同账号同时仅1个任务 // 忙时拒绝，不排无限队列
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
