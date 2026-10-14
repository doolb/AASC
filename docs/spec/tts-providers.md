# TTS Provider 与播报配置实现

## 豆包网页账号自动识别与临时分句单路（2026-10-15）

```text
doubao-chat → 内置doubaochat → 当前有效账号；自定义映射优先、指定账号不能退选
Cookie-only允许语音；文字仍需Node资料；真实成功码0/20000000允许，Offline Worker定位独立依赖
createTtsGenerationScheduler(display,options) → 同生成businessType/templateTts → 权威Provider
Provider=doubao-chat → 单批次并发1；其余→既有server1/display回报1–2；所有发送按句序
普通Chat/Agent/手动回复/修复入口 → 同一业务/模板上下文传入调度与生成
跨批次并发 := 本地账号busy保持，账号队列用户暂缓；不增加重试或音色改变
验证 := Chat2API246/246；临时串行20/20及定向15/15；正式发布/主服务短句另记任务
```

## Provider 原生语速与全局音量入口（2026-10-14，需求修正伪代码）

```text
已有声明：
  TtsProviderSettings.init/save/handleConfig、normalizeSettings
  getTtsProviderSettings/setTtsProviderSettings、setTtsProviderConfig/ttsProviderConfig
  createTtsProviderService.generate、adjustWavVolume、SelfTest.tts_provider_config
新增定义：
  TtsProviderCapabilities { supportsSpeed }；每个 Provider 声明上游是否原生接受语速参数
  supportsNativeSpeed(provider, model)；qwen-api 按模型原生能力动态判定，其它 Provider 使用能力声明
  ProviderSettings.defaultSpeed；仅向当前原生支持语速的方式展示并应用，范围 -10..10
  SharedTtsParameters { defaultVolume }；权威快照根级，持久化于 config.tts.sharedParameters，范围 0..100
  Provider固定支持语速：system、qwen-chat、doubao-api；qwen-api按模型能力判定
  Qwen-Audio 3.0/3.1 TTS -> 上游 input.rate 范围 0.5..2；Qwen3-TTS HTTP文档未声明rate -> 隐藏语速、不发送rate
  doubao-chat 上游不接受语速参数 -> supportsSpeed=false；隐藏语速控件并忽略历史语速
  TtsEngine.synthesize(text, speed)；Android Embedded Speech SSML prosody rate原生控制语速
  adjustWavVolume(buffer, volume)；仅调整单声道16位PCM幅值，不调整样本数/时长
操作流程：
  读取旧配置 -> 保留已有每Provider语速；无每Provider值时，以旧共享语速初始化所有支持语速的 Provider
  system 没有旧共享语速 -> 沿用 config.tts.defaultSpeed；缺省语速/音量回退 0/100
  TTS 面板 -> 只渲染一组全局音量；每个 Provider按当前原生模型能力显示独立语速输入
  语速不受支持的 Provider/模型 -> 隐藏语速控件；doubao-chat不保存defaultSpeed，其它同Provider可切换模型时保留已有偏好但不发送
  三类业务选择、模板音色、Provider 模型/音色/启用状态 -> 保持原独立配置
  保存 -> setTtsProviderConfig -> 规范化各 Provider 语速、全局音量与业务/Provider 字段
  config.set(tts.sharedParameters.defaultVolume 与业务选择) -> 持久化共享音量
  userConfig.set(tts.providers) -> 持久化 Provider 服务偏好与每Provider语速
  system defaultSpeed -> 同步原 config.tts.defaultSpeed 兼容旧 system TTS 入口
  任一持久化失败 -> 回滚两侧旧值 -> 返回失败与原权威配置
  保存成功 -> 广播含各Provider语速与全局音量的脱敏 ttsProviderConfig -> 控制端同步/重连回填
  配置输出 -> 只输出支持语速 Provider 的 defaultSpeed；音量不写入 Provider；凭证继续脱敏
  TTS 请求显式 speed -> 覆盖所选Provider默认；缺省 speed -> 使用该 Provider.defaultSpeed
  TTS 请求显式 volume -> 覆盖全局音量；缺省 volume -> 使用 SharedTtsParameters.defaultVolume
  语速转换为倍率时仅转换一次；音量继续使用 0..100
  qwen-api且模型原生支持rate -> 倍率写入上游input.rate -> WAV只按全局音量处理
  doubao-api/qwen-chat/system -> 将语速传入既有上游/原生接口 -> WAV只按全局音量处理
  Android显示端 -> ttsGenerate携带-10..10 -> 新原生桥使用Embedded Speech SSML prosody rate -> WAV只按全局音量处理
  旧APK无带语速桥且speed=0 -> 调用旧原生入口；旧APK无带语速桥且speed!=0 -> 返回不支持，由既有服务器fallback处理
  qwen-api且模型不支持rate -> 隐藏语速控件、不发送input.rate，不做本地变速
  所有音量后处理 -> adjustWavVolume -> 不改变样本数、播放时长或采样率 -> 原WAV校验/缓存/播放
自测流程：
  每Provider语速互不覆盖；全局音量对所有业务/Provider生效
  非原生支持Provider/模型隐藏语速；Qwen-Audio传input.rate且WAV样本数不受本地语速处理影响
  Qwen3-TTS不传rate；doubao-chat隐藏语速；Android SSML映射/转义及旧APK非零语速fallback
  WAV音量调整只改变幅值且样本数不变；边界值、旧共享语速迁移与双存储回滚
  多控制端保存广播、断线重连回填；Provider/业务/模板音色设置保持独立
  显式请求参数分别优先于所选Provider语速和全局音量；任一WAV后处理不得改变语速
```

## 开放qwen-chat非AI业务（2026-10-13，已实现伪代码）

```text
已有声明：
  BUSINESS_TYPES/BUSINESS_KEYS、SYSTEM_BROADCAST_PROVIDERS、validateBusinessProvider
  normalizeSettings -> 业务选择校验；resolveProviderConfig -> 生成前相同校验
  TtsProviderSettings.selectProvider、SelfTest.tts_provider_config
  createQwenChatProvider -> emoji过滤；无正文返回null
  textMediaTtsService -> 当前句/预取/目标路由；textSentenceTtsError -> 播放器跳过
  generateTtsWithFallback -> 统一业务合成；系统/控制端/语音命令 -> 音频路径消费
新增定义：
  非AI可用Provider -> 原system/qwen-api/doubao-api + qwen-chat
  NoSpeechResult -> 既有null，不制造空音频、临时文件或新播放命令
操作流程：
  保存或生成的text_media/system_broadcast选择qwen-chat -> 策略允许
  ai_reply/agent_reply -> 原模板与AI默认规则
  页面三类业务选择 -> 均显示qwen-chat；不替换现有保存值
  self-test -> 三类选择可为qwen-chat，只读、不发送合成
  同Provider音色继承/模型映射/速度音量 -> 原统一规划，不跨来源继承
  qwen正文 -> Chat2API当前账号合成 -> 完整WAV -> 原缓存/播放
  qwen过滤后无正文 -> null -> 消费端识别后跳过，不调用basename或下发空URL
  文本阅读null -> 清理预取状态、发送原可定位跳过通知、继续下一句
  系统/自定义/语音命令null -> 按已有响应/批次契约完成跳过，不记录生成失败
  语音命令批次所选systemBroadcast为qwen-chat -> 先按既有过滤器去除不能朗读片段
  可朗读句子 -> 编号/标记最后一句 -> 原串行发送；全空 -> 不创建播放批次
  其它Provider批次 -> 原文与原分句；不共用qwen专属筛选
  语音命令批次 -> resolve捕获规范化configuration与selection；过滤和生成共用同一快照
  playbackOptions.ttsConfiguration -> generateTtsWithFallback内部选项 -> service.generate第二参数configuration
  service.resolve(request,configuration=getSettings()) -> 同快照的业务选择/参数；账号与映射仍由Chat2API实时读取
  批次内权威配置变化 -> 不改当前批次Provider/音色；下一批读取新配置
  该快照不是公共请求字段，不接受控制端指定Provider或凭据
  自定义/api/tts/generate无正文 -> HTTP200，status=skipped/skipped=true/audioUrl=null
  原显示端只在status=success时启动音频 -> skipped沿用原结束当前项分支，释放队列/批次
  不返回success加空URL，避免旧显示端陷入无法触发ended的播放状态
  非null错误 -> 原失败提示，不回退system或其它来源
验收：
  四种业务解析成功，未知业务/Provider仍拒绝；豆包网页原限制仍有效
  textMedia/systemBroadcast保存、权威广播与重连保留qwen-chat/音色
  隔离浏览器选项和只读自测；本地模拟生成及emoji空句跳过/队列推进
  无账号/停用/上游失败原错误；旧AI/Agent、其它Provider、WAV缓存播放回归
```

## 四路统一实现（2026-10-13，当前伪代码）

```text
createTtsProviderService -> 捕获settings/config快照、业务/模板选择
显式voice/speed/volume -> parameterOverrides；Provider音色/模型偏好、各Provider语速与全局音量 -> parameterDefaults
system -> 原生生成；不继承API音色，不读云端账号
qwen-chat -> emoji入口过滤、已登记网页模型或映射别名、expectedProviderId=qwen
qwen-api -> 已知原模型转换限定别名，用户映射别名保持 -> expectedProviderId=qwen-api
doubao-api -> 默认doubaapi/tts或用户映射别名 -> expectedProviderId=doubaapi
doubao-chat -> 原严格账号映射、固定网页音色与上游参数 -> expectedProviderId=doubaochat -> 本地adjustWavVolume(全局音量)
四路薄层 -> Chat2API speech.generate；不读取旧密钥或构造HTTP
speech -> application.plan -> 显式参数 > 映射默认 > 业务默认 > 模型默认
能力校验 -> 在归属Provider中调度账号 -> 当前credentials.apiKey或网页凭据
API endpoint/resourceId -> accountInfo优先Provider默认，与密钥分离
apiSpeechAdapters -> 原Qwen接口与完整下载 / 豆包V3完成事件PCM封装
trusted legacyReplyContext -> 仅原AI/Agent豆包兼容资源/无复刻模型传上一句
60秒deadline + signal -> 规划/账号/合成/下载/解码；迟到结果拒绝
validateWav -> 原缓存URL/Range/播放回执；不回退另一来源
TTS页 -> 只保存偏好，原setTtsProviderConfig/权威广播/重连
Chat2API API账号表单 -> 格式校验并记录format-only，不做远端验证
网页qwen新映射别名保存mappedModel -> 重载保留；旧无标记非法值恢复默认
独立终审 -> 规划预算/取消 + Pi metadata拒绝修复，定向8/8
本地模拟回归 -> TTS85/85、旧业务19/19；无真实凭据/远端请求/主服务操作
```

```text
历史API凭证保存路径核查（2026-10-12，运行时已改用Chat2API账号）：
  普通模式 -> 服务器用户主目录/.config/aasc-user/userconfig.json
  release模式 -> 运行项目目录/release/userconfig/userconfig.json
  qwen-api Key -> tts.providers["qwen-api"].credential
  doubao-api Key -> tts.providers["doubao-api"].credential
  保存 -> userConfig.set(tts.providers)；回传 -> redact，仅credentialConfigured
  路径说明核查 -> 不读取、不打印凭证原文；不改变配置规则
```

## Qwen-Audio 3.1与豆包上一句上下文（2026-10-11，已完成）

```text
保存AI回复 -> 持久化replyToMessageId=本轮用户消息id
历史手动播放 -> 先按replyToMessageId查对应用户输入
  有引用但用户消息不存在 -> 不传context_texts
  旧记录无引用 -> 在同mode/target/sessionId/profileName内向前查用户输入
Agent配对历史 -> 直接读取同一记录的user字段
控制端只读自测 -> 私聊引用对应原用户、Agent配对输入、缺失引用不取其他轮
```

```text
已有声明：
  normalizeSettings、PROVIDER_DEFAULTS、resolveProviderConfig、createProviderRegistry
  requestJson、requestLimited、wrapPcm、adjustWavVolume、validateWav
  generateTtsWithFallback、普通AI/Agent/语音聊天入口、resolveChatReplyTtsOptions
  Chat.playMessage、Chat.getReplyTtsContext、历史消息与流式回复按钮
新增定义：
  QwenApiModelContract { 模型系列, 标准接口路径, 请求字段, 默认音色目录 }
  QwenAudioDefault { qwen-audio-3.1-tts-flash, qiaoxiaojiao_v3.1 }
  QwenKnownWavPlaceholder { RIFF 0x7fffffbf, data 0x7fffff9b }
  ReplyUserTextSnapshot { 同一回复回合对应的上一句用户文本, 最多2000 Unicode字符 }
  DoubaoReplyContext { context_texts单元素数组, additions序列化字符串 }
操作流程：
  用户已确认具体方案 -> 先同步伪代码 -> 修改实现与自测
  三个云端/网页Provider无明确enabled配置 -> 默认开启；已保存enabled -> 保留
  Qwen API缺少明确配置 -> 使用新模型与乔小娇；已保存其他明确模型/音色 -> 保留
  Qwen-TTS模型 -> 原标准路径与language_type=Auto
  Qwen-Audio-TTS模型 -> SpeechSynthesizer标准路径、input.format=wav/sample_rate=24000
  官方标准端点路径 -> 按模型规范化；自定义端点 -> 保留明确用户选择
  Qwen音频完整下载 -> 识别已知配对占位头与合法单声道16位PCM
  已知占位头且真实PCM完整对齐 -> 按实际PCM长度重包装 -> 原严格WAV校验
  普通WAV -> 原校验；非占位长度错误/断开/空音频/超限/不合法格式 -> 拒绝
  自动AI/Agent/语音回复 -> 入口捕获当前用户原文 -> 回复分句共用快照
  手动历史AI回复 -> 同会话、目标、回合中找到此前用户文本 -> 受限上下文
  流式完成按钮/新消息入口 -> 携带对应输入，后续会话切换不覆盖
  generateTtsWithFallback -> Provider服务 -> 仅向兼容豆包AI/Agent适配器提供受限用户文本
  豆包seed-tts-2.0、无复刻model、用户文本非空 -> additions JSON中的context_texts=[用户文本]
  空上下文/非AI业务/不兼容资源或复刻model -> 不发送context_texts
  现有AASC配置保存与权威广播、缓存引用、队列、播放回执与打断 -> 继续现有流程
验证：
  154项相关回归通过，20个生产JS语法检查通过
  实际当前Qwen31/乔小娇/speed=1 -> 上游115244字节 -> 生产有效WAV
  npm重启 -> 3个静态HTTP200 -> /control权威配置脱敏、三个enabled=true
  新默认组合、旧Qwen3显式配置、自定义端点、目录与WS权威值 -> 正确
  对比旧契约InvalidParameter与正确契约实际WAV，合法PCM不改变
  已知占位长度修复；普通截断、恶意长度、空PCM、未对齐、格式异常 -> 拒绝
  豆包真实HTTP请求捕获additions/context_texts -> 上一句原文单元素数组
  普通AI、Agent、语音、私聊、群聊、临时及历史按钮 -> 正确回合
  会话切换、并发与迟到回复 -> 不串上下文；长文本 -> 明确有界
  其他Provider及非AI业务 -> 不发送用户上下文
```


## Qwen API与豆包API错误原因打印（2026-10-11，已实现）

```text
已有声明：
  requestLimited、requestJson、createProviderRegistry、现有句子生成失败日志
  adjustWavVolume、validateWav维持当前严格校验
新增定义：
  ProviderKnownErrors { Provider标识, 白名单错误码, 固定中文提示 }
  ProviderHttpErrorSummary { HTTP状态, 白名单上游错误码, 固定提示 }
  ErrorReadBudget { 最多16KiB, 原请求总时限 }
  DoubaoKnownReasonMarkers { 白名单码, 官方固定错误标记, 固定中文原因 }
操作流程：
  用户要求其他错误也相应打印 -> 已确认实施，覆盖Qwen API与豆包API
  Qwen合成JSON请求与豆包合成HTTP请求 -> 显式传入错误映射回调
  非成功HTTP -> 原总时限内按16KiB读取错误体，不调用成功音频onChunk
  完整小错误体 -> 尝试JSON解析 -> 白名单code对应固定原因
  豆包共用码 -> 仅检查官方固定标记，区分并发、请求过大、音色资源不匹配与下游超时
  已知错误码 -> 固定中文原因加HTTP状态与白名单错误码 -> 现有失败日志
  未知码、非JSON、超限或错误体中断 -> 根据HTTP状态固定提示，不回显原文
  原总时限耗尽 -> 仍返回原超时错误
  Qwen成功HTTP中的业务码失败 -> 同一错误映射；无音频URL -> 原固定合成错误
  豆包成功HTTP中的流业务码失败 -> 同一错误映射，不缓存、不继续播放
  成功音频onChunk、容量与中断处理 -> 原流程；下载无Provider凭证
  原始message前4096字符仅参与固定标记判断，不保留在错误对象、日志或广播
  未知字符串码不输出；凭证、响应原文、签名音频URL不输出
验证：
  Qwen欠费/凭证/权限/参数/配额/限流/模型/内部错误 -> 对应白名单中文提示
  豆包参数/音色/可读文本/并发/请求过大/资源匹配/超时/内部错误 -> 固定中文提示
  HTTP失败与成功HTTP业务失败 -> 提示一致，无缓存或Provider回退
  未知/带密钥错误体/非JSON/超限/中断/保持连接 -> 固定提示、受限读取、原超时
  正常WAV、豆包分片UTF8和PCM、下载无Authorization -> 保持
当前证据与未实现能力：
  本机qwen3-tts-flash/Maia -> HTTP 400/Arrearage -> 无音频下载
  标准WAV通过；未知data长度与真实截断均触发原WAV块不完整，根因未定
  豆包context_texts -> 当前无配置或请求字段，尚未接入
  官方单向HTTP -> req_params.additions序列化JSON中的context_texts，仅合成2.0音色支持
```

## qwen3-tts-flash与Maia网页接口实测（2026-10-11）

```text
已有声明:
  Chat2API国内账号读取/调度、getQwenCredential、createChat2ApiQwenSpeechAdapter、validateWav
诊断流程:
  用户要求试调用 -> 读取当前可用国内账号，凭证只在内存
  独立诊断直接调用低层适配器 -> 绕过normalizeSpeechRequest和配置模型白名单
  保持既有网页签名/接口/stream协议，文本固定“你好，这是语音接口测试。”、速度1、PCM 24000Hz
  默认模型与默认音色对照 -> 上游2000000，有效WAV 97484字节
  qwen3-tts-flash + Maia -> 连接建立且发送原模型/音色，上游4000002，音频0字节
  默认模型与默认音色复查 -> 上游2000000，有效WAV 98924字节
  QUARK_VOICE + Maia -> 上游5000005，音频0字节
  qwen3-tts-flash + 网页默认音色 -> 上游4000002，音频0字节
  仅保存脱敏数字错误码、连接/发送状态与音频字节数；不保存凭证、签名URL或上游消息原文
  结论 -> 当前国内网页接口不能成功生成指定组合，不外推其他接口
  生产配置、模型白名单、音色目录与发布状态 -> 不变；不播放设备声音
```

## 网页语音模型保存校验（2026-10-11，已实现）

```text
已有声明:
  normalizeSettings、getTtsProviderSettings、setTtsProviderSettings、ttsProviderConfig广播

新增定义:
  QwenChatModels = QUARK_VOICE、MINI_MAX
  ReadStoredTtsOptions { recoverLegacyModel }

操作流程:
  qwen-chat模型别名qwen-chat -> 规范化为QUARK_VOICE
  新保存模型不在QwenChatModels -> 固定错误提示，不修改现有配置；WS回传权威配置
  读取历史已保存不兼容模型 -> 回退QUARK_VOICE，保持账号、音色及其他参数；下次保存持久化
  控制端qwen-chat模型 -> 下拉框仅提供上述两项，提示百炼模型需使用Qwen API
  qwen-api与其他Provider模型 -> 保持既有规则
  只读SelfTest -> 检查qwen-chat模型属于QwenChatModels
```

## 国内千问音色目录现状核查（2026-10-11）

```text
已有声明:
  qwen-chat.voices、normalizeSpeechRequest

操作流程:
  查询qwen-chat音色 -> 输出已预置默认女声zh_female_quarkF531S0_ptts
  用户查询QUARK_VOICE音色总数 -> 说明仅确认一个可用音色，模型完整音色总数未确定
  显式填写其他voice -> 校验字符串格式 -> 原voice转交Chat2API上游
  未填写voice -> 使用默认女声
  未取得国内目录或真实合成证据 -> 不宣称其他音色可用，不借用国际版或API列表
  qwen-chat模型为qwen3-tts-flash或QUARK_VOCIE -> normalizeSpeechRequest本地拒绝，不读取账号、不连接语音
  qwen-chat正确网页默认模型 -> QUARK_VOICE
  qwen-api模型qwen3-tts-flash -> 百炼HTTP端点、API Key及对应音色
```

## qwen-chat emoji筛选（2026-10-11，已实现）

```text
已有声明:
  createQwenChatProvider.generate、createTtsProviderService.generate
  手动tts/play、普通AI回调、Agent有序TTS队列与完整WAV校验

新增定义:
  QwenChatSpeechText { originalText, filteredText, skipAudio }
  QwenChatSkippedAudio = null

操作流程:
  qwen-chat请求 -> 先校验Provider启用状态 -> 按Unicode字素簇拆分原文
  emoji字素簇含图形表情、默认表情、国旗或键帽 -> 移除整个字素簇
  中文、英文、普通数字、标点、换行与正文内空格 -> 原样保留
  筛选结果去首尾空白 -> 若没有文字或数字，输出null，不读取Chat2API账号、不请求上游
  有可朗读正文 -> Chat2API使用筛选文本及原音色、速度、音量合成
  qwen-chat返回null -> Provider服务返回null，不校验WAV、不缓存音频
  手动及自动AI/Agent调用收到null -> 不构造音频URL、不播放、不记录失败，继续队列
  其他Provider -> 沿用原文、WAV校验和缓存规则
  非空文字上游真实失败 -> 沿用失败报告，不吞掉错误
```

## 纯表情空音频诊断与原候选草案（2026-10-11，历史方案未采用）

```text
已有声明:
  stripMarkdown、chat.splitIntoSentences、isPunctuationOnly、控制端tts/play有序队列
  collectQwenAudio、wrapPcm、Chat2ApiSpeechService.generate

当前操作流程:
  原文 -> Markdown清理 -> 12个分句 -> 仅标点过滤 -> 12次生成
  其中4个纯表情 -> 千问成功完成、无音频 -> wrapPcm拒绝空PCM
  空PCM异常 -> speech_upstream_error固定通用提示 -> 句子生成失败日志
  其余文字分句 -> 有效WAV -> 原播放目标，独立于失败分句

待确认新增定义:
  TtsDecorationOnly { text, hasReadableContent }
  QwenSpeechEmptyAudio { code, fixedMessage }

待确认操作流程:
  手动播放清理后的分句 -> TTS专用纯表情与装饰判断 -> 仅可朗读片段入原有队列
  正文带表情 -> 保留正文及分句顺序；聊天展示原文不变
  千问完成事件 -> 已收集音频字节数
  音频字节数为零 -> 固定空音频错误码 -> 固定无可朗读音频提示
  鉴权、连接、超时错误 -> 保持对应失败；不输出凭证或签名URL
```

## 系统原生与 Chat2API 统一语音（2026-10-11 已实现）

```text
已有声明:
  tts.device、tts.serverEnabled、tts.defaultVoice、generateTtsWithFallback
  Provider选择/模板继承、权威配置与初始化、完整WAV缓存
  Chat2API runtime/coreAdapter/loadBalancer/dataStore/providerRegistry/proxy

新增定义:
  Chat2ApiSpeechRequest { input, voice, model, speed, volume, timeoutMs }
  Chat2ApiSpeechResult { audio, contentType }
  Chat2API业务入口 POST /v1/audio/speech
    model=qwen-chat/QUARK_VOICE/MINI_MAX，input，voice，speed=0.25..4倍，volume=0..100
    response_format仅wav；返回audio/wav二进制，不返回账号或签名数据

操作流程:
  system配置 -> 不读写Provider级enabled/defaultVoice
  最终Provider=system -> 新界面不提供音色ID/查询 -> 现有生成路径及原音色
  旧system Provider开关/音色ID -> 忽略且后续保存移除
  原tts.device/serverEnabled/defaultVoice设置 -> 沿用原职责
  qwen-chat界面 -> 无账号ID/列表查询/刷新/查询计时器
  qwen-chat请求 -> Chat2API统一语音服务 -> 国内qwen Provider及既有可用账号调度
  调度账号当前凭证 -> Chat2API内部语音适配器 -> 完整音频 -> 原TTS WAV缓存
  旧TTS chat2apiAccountId -> 不再参与生成并后续保存移除
  Chat2API语音入口 -> 复用既有业务鉴权，不提供凭证回包或独立HTTP配置接口
  无可用账号/Provider停用/签名失败/超时 -> Chat2API脱敏错误 -> 不静默切换TTS Provider
  上游语音签名契约 -> Node校时与qwen_web关联语音令牌注册/刷新 -> HMAC签名
    默认适配器不启动Chrome/DOM/AWSC，不使用临时目录
    TTS只调用speech服务，不显示安装或账号查询流程
  对应运行实例部署/重启后 -> 检查控制初始化与统一语音入口版本 -> 实际账号试听

Chat2API服务:
  normalize请求 -> 文本非空且不超16000字符，模型/音色/速度/音量/WAV格式校验
  读取保存的调度策略 -> loadBalancer.selectAccount(model, strategy, qwen, requireSecret=true)
  当前账号与Provider再次检查 -> Cookie/ticket合并 -> qwenAdapter.generate(剩余总时限)
  完整WAV校验 -> 清除账号失败标记 -> 返回audio/contentType
  上游失败 -> 标记账号失败 -> 固定502；无账号/鉴权忙503；总超时/鉴权超时504
  校时/注册/刷新阶段码 -> 白名单固定提示，不采纳上游原文
  总超时发生 -> 标记expired -> 迟到配置/账号/音频不启动后续处理
  HTTP入口 -> 既有authorize/readJson -> speech.generate -> audio/wav及Cache-Control=no-store
  内部TTS入口 -> 将-10..10语速转为2^(speed/10)倍率 -> speech.generate -> 原缓存
  本机运行更新 -> npm run restart:server -> wss初始化确认无旧system/qwen账号字段

自测流程:
  system无新增开关/音色ID与查询，旧enabled=false不阻断原路径
  显示端生成、原服务端开关/回退、缓存满、既有音色与API Provider兼容
  TTS不发送账号查询且无账号字段，Chat2API实际调度及原始凭证不出模块
  Chat2API语音成功/无账号/停用/鉴权失败/超时/完整音频与异常契约
  真实控制WebSocket初始化、界面与后端版本一致，既有qwen聊天不受影响
```

## 当前已实现流程

```text
已有声明:
  config.get/set、用户配置 DataSnapshot、normalizeChatTemplate、chat.getTemplateByName
  generateTtsWithFallback、ttsAudioCache.storeAudio、createAgentTtsStream
  textMediaTtsService、报时/提醒生成回调、控制端初始化与broadcastToControls

新增定义:
  TtsBusiness { aiReply, agentReply, textMedia, systemBroadcast }
  TtsSelection { provider, voice }
  ProviderSettings { enabled?, endpoint, model, credential?, defaultVoice?, defaultSpeed?, resourceId }
  SharedTtsParameters { defaultVolume }；位于 TTS 权威快照根级，持久化于 config.tts.sharedParameters
  system无enabled/defaultVoice；支持语速的Provider持久化defaultSpeed；qwen-chat无credential/chat2apiAccountId；API Provider保存credential
  TtsConfigMessage { type, requestId, config, success, message }
  VoiceEntry { id, name, available }
  AudioRequest { text, provider, voice, speed, volume, businessType, templateTts, preferredDisplayId }

操作流程:
  模板输入 -> 保留省略Provider的继承含义 -> 规范化voice -> 仅保存provider/voice
  非字符串Provider/voice -> 拒绝，不能把false/0当继承
  旧客户端未提交tts -> 更新模板其他字段并保留原tts；明确空tts -> 恢复继承
  AI/Agent来源模板 -> 模板Provider或AI默认Provider -> 最终Provider
  无模板群聊 -> AI默认Provider；临时角色 -> 当前模板
  文本媒体 -> textMedia；报时/状态/任务/自定义 -> systemBroadcast
  非AI业务 -> 允许qwen-chat，豆包网页仍按原实验范围拒绝
  system音色 -> 新选择voice=null -> 旧生成接口/原生音色
  其他Provider音色 -> 显式音色 -> 相同Provider的业务默认音色 -> 最终Provider自身默认
  参数 -> 显式请求值优先，否则读取所选Provider默认语速与全局音量 -> 规范化有限数字
  控制端setTtsProviderConfig -> 校验完整候选配置 -> config.set保存tts.sharedParameters.defaultVolume与业务选择
    -> userConfig保存Provider服务偏好及支持语速Provider的defaultSpeed；保存失败时回滚另一侧
  旧共享语速迁移 -> 已有Provider语速优先 -> 缺失值的支持语速Provider读取旧共享语速
    -> system再回退config.tts.defaultSpeed，音量读取旧共享值或旧Provider值；最终默认0/100
  Provider配置输出 -> 仅支持语速Provider包含defaultSpeed；所有Provider均不含defaultVolume；凭证脱敏保持原规则
  system defaultSpeed -> 同步旧config.tts.defaultSpeed以兼容原生入口
  doubao-chat固定参数上游结果 -> adjustWavVolume(全局音量) -> 原WAV校验/缓存/播放
  保存失败 -> 恢复旧内存值 -> 回传旧脱敏配置和错误
  保存成功 -> 向所有控制端广播脱敏权威值 -> 初始化/重连补发
  API凭证空输入 -> 保留；明确clearCredential -> 清除；API广播仅credentialConfigured
  qwen-chat -> 不读/写credential或账号ID；广播仅合成参数
  云端/网页默认关闭；未收到配置 -> system本地默认
  目录请求 -> system直接返回空列表，不调用旧接口；其他Provider目录 -> 返回id/name/available
  目录失败 -> 保留已有选择；缺失已选ID -> 标注待校验而不清除
  system生成 -> 现有显示端/服务器路由 -> 原缓存引用
  qwen-api -> Bearer凭证 -> model/input.text/voice -> output.audio.url -> 无凭证下载完整WAV
  doubao-api -> API Key/resourceId/requestId -> req_params与PCM音频参数
    NDJSON/SSE事件 -> 校验业务code与完成事件 -> 限长收集base64 PCM -> 包装WAV
  qwen-chat -> 转交Chat2API统一speech服务 -> 调度国内qwen账号当前Cookie/ticket
  Chat2API默认qwen speech adapter -> Node校时 -> qwen_web注册/刷新关联qwen_audio_asr令牌
    当前账号Cookie -> 会话内校时Cookie关联 -> 令牌池 -> HMAC签名官方语音WebSocket
    同reqid发送status=1,text,ced与status=2结束包 -> 收集去重PCM -> 完成事件后包装WAV
    所有阶段共享总超时；同账号串行鉴权分配、跨账号并发；最多16个闲置30分钟会话
    签名/账号/上游不可用 -> 固定脱敏阶段错误；不使用音色克隆采样文本接口
  WAV -> 校验与缓存 -> 原uploads/tts引用 -> 原playAudio/playOnControl/textSentenceTts协议
  错误/鉴权失效/超时/超限/空音频/缺少完成 -> 明确脱敏错误 -> 不自动切换Provider
  打断/取消 -> 原代次检查丢弃迟到结果，队列及回执保持

自测流程:
  模板继承、显式system、Provider切换、同Provider音色默认、空值与非法输入
  textMedia独立选择、非AI允许qwen-chat且豆包网页限制保留、Agent来源模板与群聊默认
  配置脱敏、空凭证保留、清除、保存失败权威值回退、多端广播及重连
  本地HTTP/WebSocket模拟Provider的成功、鉴权失败、超时、空/超大音频、截断事件
  本地HTTP验证校时Cookie、注册/刷新、签名参数、令牌隔离与超时
  验证完整音频引用可读取、PCM转WAV、下载不带Provider凭证
  验证网页保存等待、断线恢复、目录失败保留选择
  验证保存超时/发送异常/等待时断线不显示成功，迟到目录回包不覆盖当前值
  实际system入口执行 -> 显示端生成、原服务端回退、缓存满不回退、速率/音量处理
  回归现有TTS路由、文本媒体、Agent播放与聊天打断
```

## 控制端聊天手动播放（2026-10-11 已实现）

```text
已有声明:
  Chat.playMessage/playText、history/roleHistories、temporaryConversation/temporaryHistoryGroups
  消息role/mode/target/templateId、临时历史组roleName、控制端tts/play与显示目标
  chat.getTemplateByName、BUSINESS_TYPES、generateTtsWithFallback、既有Provider选择与WAV缓存
新增定义:
  ChatReplyTtsContext { businessType, templateName }
  TtsPlayMessage { type=tts, action=play, text, 原播放目标, chatReplyContext? }
操作流程:
  历史点击 -> 原当前可见消息数组及索引 -> 当前消息来源上下文
  助手回复 -> ai_reply；Agent回复 -> agent_reply；普通用户消息 -> 保留旧播报
  私聊 -> 消息templateId/target；Agent -> 来源角色；临时 -> 被查看历史组或当前会话roleName
  群聊显式来源templateId -> 该模板；无唯一模板/旧消息来源缺失 -> AI默认，不猜显示名
  对象入口/流式完成按钮 -> 捕获回复所属上下文，不在点击时套用已切换的会话
  speech优先于content -> 原playText -> tts/play携带来源，凭证/服务参数不入消息
  服务端控制端tts/play -> resolveChatReplyTtsOptions校验仅ai_reply/agent_reply
  模板名限长512字符且无控制字符 -> 读取当前权威tts配置 -> 浅复制快照，不采用客户端Provider/凭证
  模板不存在 -> AI默认；未带聊天上下文的普通tts/play -> systemBroadcast旧行为
  请求开始时解析并捕获businessType/templateTts -> 每句generateTtsWithFallback传入相同配置
  手动tts/play -> 控制端单独播放或displayIds多端，不要求存在单一主显示端
  原Markdown/分句/调度/控制端及显示端目标 -> 原缓存及播放消息
自测流程:
  私聊/Agent/临时当前与旧历史组/群聊/旧记录，切换角色后不串音色
  手动播放与自动回复一致、模板继承/显式system、qwen-chat全部既有业务
  speech优先、控制端/显示端/多选目标兼容、无上下文的自定义播报不变
  本地HTTP/WSS与浏览器或正式Chat模块验证，无真实账号凭证输出
```

## 国内千问纯Node接口鉴权（2026-10-11 已实现）

```text
已有声明:
  Chat2API账号调度、getQwenCredential、createChat2ApiQwenSpeechAdapter
  collectQwenAudio、validateWav、官方SDK校时/register/refresh/HMAC算法
新增定义:
  QwenSpeechAuthSession { 凭证标识, 校时偏移, 接口Cookie, 设备标识, 场景令牌, 签名令牌池, 有效期 }
  QwenSpeechStageError { 固定阶段码, 固定脱敏提示 }
操作流程:
  用户回复是确认 -> 纯Node原型已生成252044字节WAV、2182ms -> 接入默认生产路径
  当前Chat2API账号 -> 内存Cookie关联 -> 官方校时携带设备fingerprint
  注册基础businessScene=qwen_web、unifyRelateGenerate=[qwen_audio_asr,voice_command]
  timezoneOffset使用时区字符串，chid使用官方时间加随机串格式 -> 校验基础及语音子场景令牌
  不直接注册qwen_audio_asr基础场景，该场景无UMID时D1001；通用场景注册实际通过
  注册失败或缺令牌 -> 固定阶段错误，不连接语音，不打印响应原文
  请求chid/nonce/timestamp -> 固定顺序串联值 -> 基础设备ID+版本+账号hashCookie+参数值
  子场景一次性令牌+校时毫秒为HMAC密钥 -> SHA256/base64 -> 语音子场景actkn签名WSS
  令牌不足或临近过期 -> 刷新 -> 同账号串行分配，避免重复消费
  凭证更新 -> 新凭证键不复用旧会话，旧会话按闲置/容量驱逐；令牌/签名/凭证不写TTS配置或日志
  所有阶段共享总超时 -> 收集完整PCM -> 校验WAV -> 真实账号验证
  最大16个账号会话，闲置30分钟清理，活跃会话不驱逐 -> 防止无界缓存及并发重复初始化
  刷新失败或令牌非法 -> 废弃会话；总超时及迟到注册不继续连接语音
  纯Node真实验证通过 -> 替换默认鉴权模块 -> 移除语音Chrome依赖，无临时目录
  原手动/自动AI来源与Chat2API调度 -> 原缓存/播放/取消流程
自测流程:
  校时Cookie、注册/刷新、签名顺序与HMAC向量、凭证更新、并发令牌分配
  非法/空响应、过期、超时及错误脱敏；无Chrome/受限tmp不启动浏览器
  npm run check:chat2api及TTS/手动播放定向回归；真实WAV成功才确认可用
```
