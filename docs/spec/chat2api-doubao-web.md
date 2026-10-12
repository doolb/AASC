# 豆包网页文字 Chat2API 与朗读 TTS 实现伪代码

> 2026-10-12：文字适配器与 HTTP 断连取消已实现；Node 直连实测 403，不能宣称可用。以下网页运行模式及音频扩展是待确认伪代码，不代表已经实现。真实请求及凭据访问授权已用完，本轮仅更新文档。

> 后续确认：用户已选择B并确认实施。Ogg验证及隔离WAV解码已实现；方案A不实施。受控Chrome网页fetch及真实账号/凭据访问未获新增授权。Frontier生产鉴权/音色资料未补齐，speech/TTS接线保持阻断，不能宣称网页TTS可用。执行记录见 `docs/task/20261012_豆包网页WAV解码实施计划.md`。

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
  ManualAccountService校验Cookie长度、名称及字符；尚无安全只读身份端点时固定拒绝手动新增 // 绝不把非空Cookie或首页200当真实登录成功
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
  待用户确认扩大语音接口格式：仅新doubao-chat模型显式Ogg响应并同步缓存/MIME及播放器回归，旧模型保持WAV // 不提前改运行逻辑
  待用户确认browser_client方式：仅受控本机Chrome、匹配被选豆包账号、网页内fetch，不绕过验证码 // 离线Android不能隐式依赖浏览器
  如果不能合成外部传入的任意文本，标记doubao-chat为未支持并停止业务接入 // 不能用开放API或播放已有回答冒充TTS
  如果音频不能通过用户选定格式的完整性校验，停止语音接入并记录错误 // Ogg不能标记为WAV，不从OggS魔数推断完整性

操作流程：原WAV接入草案，尚未实现；仅选择方案B后落实
  SpeechService通过显式model映射选择qwen或doubaochat账号与对应适配器 // 千问旧默认完全不变
  语音请求先校验长度、voice、speed、volume、wav格式与60秒总时限 // 非法请求不触碰账号
  选取启用且有有效Cookie的网页豆包账号，重读权威Provider和当前凭据 // 不复制Cookie到TTS配置
  DoubaoSpeechAdapter按实测网页协议合成有界完整音频 // 禁止使用doubao-api密钥和seed-tts-2.0
  如果返回可验证PCM，依据实际采样率包装WAV；其他格式须有确证的解码方案 // WAV校验不能放宽
  validateWav验证成功后返回audio/wav；失败固定错误并记录账户健康 // 不切换system或doubao-api
  TTS薄适配器从业务选项传入指定文本与可验证参数，音色列表仅含已验收项 // 不承诺网页没有的音色
  TTS Provider只开放ai_reply与agent_reply，模板和AI默认可选 // 文本阅读/系统播报沿用原服务
  setTtsProviderConfig规范化持久化、广播权威值、连接补发；无凭证字段 // 防止浏览器配置泄漏账号

定向自测：
  Provider模型列表、账号导入/脱敏、手动登录成功失败、异常Cookie与Provider禁用
  流式分片、非流式结束、思考/正文分离、原生续接/重放、取消/超时/风控/无工具能力
  已验证的音频编码、WAV截断与容量、旧qwen-chat模型/默认音色、doubao-api隔离
  TTS AI/Agent模板、跨Provider音色、权威配置和浏览器选择、失败不静默回退
  优先 npm run check:chat2api；其余使用既有TTS定向测试脚本 // 不自动重启用户服务器
```

## 受控网页文字运行模式与音频方案（待用户选择）

```text
已有声明：
  DoubaoChatAdapter.buildDoubaoRequest、consumeDoubaoStream、createRequestControl
  CoreAdapter.forwardChatCompletion、LoadBalancer.selectAccount、Runtime
  SpeechService.generate、ProxyService.withResponseCancellation
  TTS.ProviderService.generate、AudioCache.storeAudio、AudioHTTP.serveTtsAudio
  Config.get、Config.set、控制端身份检查、WebSocket权威广播与连接初始化
  浏览器Audio播放队列、DisplayLipSyncAudio、旧WAV播放端

新增定义（待实现）：
  DoubaoWebRuntimeConfig { enabled: false, transport: disabled, port: 9222, accountId }
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
  真实绑定校验需要额外授权；最小会话标识只在内存比较所选账号与所选context // 本轮不读取凭据；不导出、打印或保存Cookie
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

操作流程：方案B，Ogg解码为WAV（校验/解码已实现，上游接线未开放）
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
  公开SDK的appkey和会话参数由调用方注入，默认音色/生产鉴权未能可靠补齐 // 按任务3前置门槛停止上游接线，不新增假可用模型或业务选项

验收流程：
  全部账号/浏览器/Frontier测试使用虚构凭据及本地模拟transport // 不连接9222、不读真实配置或账号库
  覆盖默认禁用、非本机CDP、账号不匹配/换号、绑定撤销、严格调度、忙时拒绝、取消与无重试
  覆盖分片UTF-8/SSE、错误正文脱敏、慢消费者、EOF缺结束与所有容量界限
  覆盖Ogg跨帧分页、CRC损坏、页序/serial错、无头/无EOS、TTSEnded缺失、尾随垃圾与格式冒充
  用公开许可或本地生成的合成音频检验浏览器实际解码/ended/停止/下一句/Range；不保留真实用户音频
  方案B额外验证解码失败、WAV真实参数、PCM上限和worker终止；旧Provider行为与音色不变
  优先npm run check:chat2api与npm run test:mmd-production:tts；没有对应script的单测用node --test定向执行
  自测面板只核对能力和配置，不能自动触发聊天或语音 // 真实验收次数、文本、账号及凭据访问必须另获明确授权
  模拟通过仅说明实现契约；真实网页模式、当前账号及显示端兼容性分别标记未验收
```
