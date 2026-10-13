# Chat2API 四路统一模型与应用分流伪代码（首批已实现）

> 2026-10-13修订。用户已明确模型→Provider→应用顺序；首批现有文字聊天＋四路TTS，用户已批准首批与手动API账号准备方式，首批已实现。本文为与源码同步的非运行伪代码。

## 已有声明

```text
createChat2ApiRuntime -> dataStore/providerRegistry/modelMapper/loadBalancer/coreAdapter/responsesService/speechService
createChat2ApiModelMapper.resolveModel -> 模型映射与preferredProviderId/preferredAccountId
createChat2ApiCoreAdapter.forwardChatCompletion -> 账号、Provider forward、文字流
createChat2ApiResponsesService.createResponse -> 文字/工具/原生续接/锁/取消
assertTextOnly -> 前置媒体/未知类型检查；之后使用原normalizeInput/extractText
createChat2ApiApplicationService.plan -> 模型映射/目录、控制块、应用与参数校验
createChat2ApiSpeechService.generate -> 网页两路与API两路，共用账号/取消/总时限，完整WAV
createChat2ApiQwenSpeechAdapter / createDoubaoSpeechAdapter -> 现有网页语音协议
createApiSpeechAdapters -> qwen-api/doubaapi协议；只接收已选账号和运行上下文
createProviderRegistry -> 四路业务薄层，全部调用speechService，无独立凭据或HTTP生成
createTtsProviderService -> 模板/业务选择、参数、validateWav、storeAudio
createDoubaoAdditions -> seed-tts-2.0且无复刻model时的AI/Agent上一句
normalizeSettings/setTtsProviderSettings -> 现有AASC权威配置
requestLimited -> 总时限、容量、AbortSignal取消和清理
rawTrafficLogger.sanitizeValue -> 不透明二进制/媒体仅类型与字节数，JSON缓冲继续脱敏
```

## 新增定义

```text
SpeechBinding { providerId, speechModel, upstreamModel, voice }
ExtendedModelMapping { model, actualModel, preferredProviderId, preferredAccountId, application?, parameters? }
MappingParameterDefaults { voice?, speed?, volume?, format? }
SpeechModelDescription { id, providerId, application=tts, input_modalities=[text], output_modalities=[audio], stream=false }
TypedInput -> 原input字符串/数组，不重建独立媒体结构；assertTextOnly前置检查类型
SystemControls { application, voice, speed, volume, format }
ApplicationPlan { requestedModel, application, speechBinding?, text?, instructions, parameters?, preferredProviderId, preferredAccountId }
ApplicationContext { provider, account, signal, deadline, legacyReplyContext }
ApplicationResult { textMessage或audioBuffer, format, mimeType, verification }
ProviderDispatch -> speechService按确定Provider选择webSpeech或apiSpeechAdapters
Chat2ApiApplicationService { plan、createAudioResponse }
AudioOutputPart { type=output_audio, format=wav, mime_type=audio/wav, data=Base64 }

模型登记：
  qwen-chat/QUARK_VOICE/MINI_MAX -> 原qwen账号 / tts / 对应网页模型
  doubao-chat -> 原doubaochat账号 / tts / 固定网页语音参数
  doubao/doubao-think/doubao-expert -> doubaochat / chat / 原映射与验证边界
  qwen-api/qwen-audio-3.1-tts-flash -> qwen-api / tts / qwen-audio-3.1-tts-flash
  doubaapi/tts -> doubaapi / tts / 默认resourceId=seed-tts-2.0、upstreamModel为空
  其它API TTS模型 -> 映射显式application=tts及API Provider，校验短模型标识
  自定义端点 -> 账号endpoint，不能按模型前缀透传地址，resource不冒充model
  四个对外Provider名 -> qwen/qwen-api/doubao/doubaapi
  对外doubao -> 兼容原内部doubaochat账号/会话，旧doubao-api业务名 -> doubaapi
  qiaoxiaojiao -> actualModel=qwen-api/qwen-audio-3.1-tts-flash、application=tts
  qiaoxiaojiao参数默认 -> voice=qiaoxiaojiao_v3.1
```

## 操作流程：模型→Provider→应用

```text
鉴权后的Chat2API实例请求 -> 现有HTTP容量限制 -> requestEnvelope
input字符串或message/content数组 -> assertTextOnly保留原输入，前置拒绝媒体/未知类型
TTS角色/结构 -> normalizeTtsInput检查；聊天保留原normalizeInput/工具流程
model -> modelMapper.resolveModel一次 -> getSpeechBinding确切目录或显式API TTS登记
旧qwen3.6flash等映射 -> 原目标及匹配规则保留，不自动填tts字段
扩展映射 -> 单次读取actualModel/application/parameters/Provider与账号偏好
actualModel为限定目录模型 -> 解析Provider应用与真实upstreamModel；保留原Provider/账号偏好
映射Provider与限定目录Provider冲突 -> 400，不偷偷改来源
不递归追逐用户映射链；未知目标按原文字兼容或新应用能力契约明确处理
未登记TTS目标 -> unsupported_application；普通文字模型继续原coreAdapter/负载均衡错误契约
旧纯文字且无新控制块 -> 继续既有映射/调度，旧会话绑定不变
parseSystemControls -> 只解析开头受控instructions
应用 = 控制块application > 映射application > 已登记speech则tts，否则chat
映射application与显式application冲突，或speech目标用于chat -> unsupported_application
确定Provider后执行其参数/协议校验，不偷换另一模型
前置纯文本校验 + 选定chat/tts对应output_modalities -> 组合校验
首批媒体输入/图片视频输出/text+audio联合输出 -> unsupported_modality，零上游请求
chat -> 既有Responses会话和coreAdapter，不创建第二份聊天历史
tts -> 共享应用服务选择账号、调用该Provider的tts适配器 -> audioBuffer
Responses入口先取得应用计划，再进入chat原会话流程或tts执行；执行服务不回调统一入口
chat加载原会话 -> 核对计划与原Provider/模型/账号绑定，只选择一次账号，保持续接锁
tts input字符串 -> 非空待合成文本
tts input数组 -> 恰好一条显式role=user消息且仅非空input_text片段，按换行符连接
tts多消息/其它角色/工具项 -> 400且零上游；合并后检查字符界限，instructions不朗读
```

## 操作流程：系统指令

```text
instructions开头一个<chat2api>JSON</chat2api> -> 最多4096 UTF-8字节控制块
仅接受application/voice/speed/volume/format -> systemControls
重复块/坏JSON/未知字段/参数冲突 -> invalid_system_controls
user/tool/历史中的相同标记 -> 正文，不切换应用
移除控制块后的自然语言 -> naturalInstructions
chat -> 按原协议传自然语言系统指令，控制块不发给LLM
tts不支持自然语言风格且剩余instructions非空 -> unsupported_instruction
省略application -> 已登记speech默认tts，否则默认chat；首批没有多用途模型
voice -> Provider/模型格式与能力校验，目录外合法ID不自动标记已验证
请求显式参数 -> 映射默认parameters -> 内部业务parameterDefaults -> 模型默认
映射parameters仅voice/speed/volume/format -> 校验后合并，禁止任意上游body/端点/秘密
没有instructions且映射application=tts -> 使用目标tts及映射voice；仍执行所有能力/参数限制
旧speech显式参数与控制块同字段 -> 一致才接受；不同不隐式覆盖
outputModalities与所选应用冲突 -> 明确报错
speed=0.25..4倍率；volume=0..100；format首批仅wav
旧业务speed(-10..10) -> 2^(speed/10)，只转换一次
qwen-api -> 保留PCM调整/音高变化；doubao-api -> round((倍率-1)*100)上游speech_rate
网页豆包 -> 固定音色/1倍速/100音量，1000 UTF-16字符且UTF-8≤4000字节
Qwen API -> 每句600 Unicode字符，业务原分句保持
```

## 操作流程：账号、协议与生命周期

```text
能力检查成功 -> 在确定Provider内选账号 -> 从Chat2API账号库读凭证
显式绑定不可用 -> 报错，不换Provider或账号
豆包chat -> 原Node账号池/显式浏览器绑定；不新增Chrome默认依赖
豆包tts -> 原preferredProviderId=doubaochat与requiredAccountId严格绑定
API账号 -> credentials.apiKey；端点/资源在管理配置，不从instructions取
API保存 -> 格式校验，显示未远端验证，不自动合成或聊天
验证元数据独立于active/disabled调度状态，可调度不表示远端鉴权成功
首版账户准备 -> 用户从现有Chat2API管理/导入完成；不自动搬迁真实值
旧TTS私有密钥 -> 原处保留供回滚；切换后的生成不回退读取
缺新账号/映射 -> account_unavailable；部署前准备账户

signal与60秒总截止 -> 账号等待/合成HTTP/下载/Frontier/解码worker
每步只用remainingBudget，不重置总时限；豆包文字仍原120秒会话截止
取消/HTTP断连 -> 销毁请求、下载、worker，拒绝迟到结果
原网页鉴权刷新语义保持；不新增合成重发或跨来源回退
Qwen API -> 原resolveQwenEndpoint/createQwenInput/占位WAV头规范化
音频下载 -> 不带Provider认证，仅受控HTTP(S)，不跟任意重定向或取本机文件
Doubao API -> 有界单向事件流、完成事件、24000Hz PCM -> WAV
legacyReplyContext -> 仅可信AI/Agent业务按原seed-tts-2.0/无复刻model规则提供
公共请求 -> 不读取本机聊天历史，不将提示词当可信业务上下文
Doubao网页 -> 完整Ogg校验/Opus解码/WAV验证，不以改MIME代替解码
audioBuffer -> validateWav、≤16MiB -> applicationResult
full/compact日志 -> 媒体格式/字节数，不存Buffer/Base64/签名URL/密钥
```

## 操作流程：输出、兼容入口与配置

```text
chat -> 原Responses output_text/message/SSE/工具，原会话持久化和错误状态
续接 -> 保留qwen原生ID、豆包ready/uncertain、身份摘要、16/256锁容量
tts有stream=true/tools/previous_response_id/conversation/Pi引用 -> 请求前拒绝
tts -> 非持久化response，message.content含output_audio，output_text为空
audioBuffer -> 只在HTTP JSON边界Base64一次，编码预算24MiB；不生成不可用引用
旧/v1/audio/speech -> 同一应用服务 -> audio/wav二进制
旧chat/completions与completions -> 文字兼容，媒体不支持时明确报错
四路TTS业务 -> 登记模型/参数 -> 同一服务 -> WAV Buffer -> 原storeAudio
qwen-chat过滤emoji后为空 -> 原null跳过；system -> 原生路径
模板/队列/缓存Range/停止/播放回执 -> 原业务流程
代理和主服务业务 -> 相同服务工厂、显式账号根目录；不启动额外HTTP代理或跨rootDir搜索

TTS控制端 -> setTtsProviderConfig(type必填) -> normalize -> config.set -> 权威广播/重连补发
模型映射编辑/保存/列表/导出/导入 -> 保留application/parameters及旧偏好字段
tts别名 -> Responses/speech/TTS业务均可解析；chat/completions使用tts别名则应用错误
既有文字会话续接 -> 核验原Provider/账号/上游模型绑定；映射目标变更不自动转会话
API密钥/端点 -> Chat2API管理；TTS页只保留业务偏好与管理入口/配置状态
断线 -> 明确本地默认；网页豆包仍默认关闭；不新增同配置HTTP保存接口
```

## 验收声明

```text
模型归属/应用表/未知类型/参数冲突/媒体拒绝 -> 零不应发生的上游请求
旧文字别名回归；qiaoxiaojiao保存/再编辑/导出导入/生成 -> 模型及voice不丢
显式voice覆盖默认、显式字段冲突、限定模型Provider冲突、映射变更续接绑定 -> 定向验证
用户正文控制块 -> 不影响路由；控制块不能改变endpoint、账号、密钥
四路WAV、字符限制、上下文不串业务、emoji空句、旧speech/缓存/播放兼容
合成和下载各阶段取消、总预算、超大/截断/缺完成事件 -> 固定脱敏错误
旧文本/流式/工具/Qwen和豆包续接/存储失败阻断 -> 回归通过
API格式入库不冒充登录成功，旧秘密不自动迁移，模型能力与验证状态分开
npm run check:chat2api；npm run test:mmd-production:tts；新增定向API/媒体/UI测试
本轮实现验证：Chat2API 228/231，3项旧Windows chmod断言失败；TTS85/85、旧业务19/19、普通LLM19/19
仅虚构凭据/本地传输；未发真实请求、未操作主服务器或构建发布
```


## 终审后的实际补充

```text
Responses入口时间 -> 规划截止与AbortSignal竞速，最长60秒
规划结束且tts -> 原deadline剩余预算传speechService，不另计完整60秒
规划超时/取消 -> 立即失败，迟到规划不得合成
TTS metadata含aasc_context_owner=pi、aasc_pi_session_id或aasc_pi_context_mode -> 请求前拒绝
API manual可选endpoint/resourceId -> normalizeApiAccount -> accountInfo；apiKey单独credentials
网页qwen新别名 -> mappedModel标记；重载保留，旧无标记错误配置按原默认恢复
TTS业务显式参数 -> 映射默认 -> 业务Provider默认 -> 模型默认，只转换一次倍率
原生system不继承API音色，模板切换Provider不继承另一来源的音色
原生文字会话 -> 私有boundModel核验；豆包模式变化继续原协议错误码
```
