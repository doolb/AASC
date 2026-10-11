# TTS Provider 与播报配置实现

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
  ProviderSettings { enabled?, endpoint, model, credential?, defaultVoice?, defaultSpeed, defaultVolume, resourceId }
  system无enabled/defaultVoice；qwen-chat无credential/chat2apiAccountId；API Provider保存credential
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
  非AI业务 -> 拒绝qwen-chat
  system音色 -> 新选择voice=null -> 旧生成接口/原生音色
  其他Provider音色 -> 显式音色 -> 相同Provider的业务默认音色 -> 最终Provider自身默认
  参数 -> 规范化有限数字 -> Provider默认速度/音量
  控制端setTtsProviderConfig -> 校验完整候选配置 -> 保存用户Provider参数与config业务选择
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
  textMedia独立选择、非AI拒绝qwen-chat、Agent来源模板与群聊默认
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
  手动播放与自动回复一致、模板继承/显式system、qwen-chat仅AI业务
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
