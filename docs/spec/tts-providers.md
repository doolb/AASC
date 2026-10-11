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
  上游语音签名契约 -> 先核验Node执行能力 -> 验证后确定运行依赖
    已核验官方SDK使用DOM/iframe/AWSC指纹及令牌注册 -> 默认适配器仍运行隔离Chrome
    Chrome归Chat2API语音内部依赖；TTS只调用speech服务，不显示安装或账号查询流程
  浏览器代码移入Chat2API -> 不能据此认定已消除Chrome
  对应运行实例部署/重启后 -> 检查控制初始化与统一语音入口版本 -> 实际账号试听

Chat2API服务:
  normalize请求 -> 文本非空且不超16000字符，模型/音色/速度/音量/WAV格式校验
  读取保存的调度策略 -> loadBalancer.selectAccount(model, strategy, qwen, requireSecret=true)
  当前账号与Provider再次检查 -> Cookie/ticket合并 -> qwenAdapter.generate(剩余总时限)
  完整WAV校验 -> 清除账号失败标记 -> 返回audio/contentType
  上游失败 -> 标记账号失败 -> 固定502；无账号503；总超时504
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
  Chat2API默认qwen speech adapter -> 临时无头浏览器加载www.qianwen.com
    Chrome -> 显式环境路径或Puppeteer缓存或系统常用路径；无可用程序 -> 明确错误
    官方公开前端doQwenAuth签名 -> speech-tts.qianwen.com/api/v3/tts的签名WebSocket
    同reqid发送status=1,text,ced与status=2结束包 -> 收集去重PCM -> 完成事件后包装WAV
    所有阶段共享总超时；浏览器finally关闭；并发签名上限2；不读取已有浏览器账户
    签名/账号/浏览器不可用 -> 明确错误；不使用音色克隆采样文本接口
  WAV -> 校验与缓存 -> 原uploads/tts引用 -> 原playAudio/playOnControl/textSentenceTts协议
  错误/鉴权失效/超时/超限/空音频/缺少完成 -> 明确脱敏错误 -> 不自动切换Provider
  打断/取消 -> 原代次检查丢弃迟到结果，队列及回执保持

自测流程:
  模板继承、显式system、Provider切换、同Provider音色默认、空值与非法输入
  textMedia独立选择、非AI拒绝qwen-chat、Agent来源模板与群聊默认
  配置脱敏、空凭证保留、清除、保存失败权威值回退、多端广播及重连
  本地HTTP/WebSocket模拟Provider的成功、鉴权失败、超时、空/超大音频、截断事件
  假浏览器验证Cookie仅传国内页面、签名参数、资源关闭与超时
  验证完整音频引用可读取、PCM转WAV、下载不带Provider凭证
  验证网页保存等待、断线恢复、目录失败保留选择
  验证保存超时/发送异常/等待时断线不显示成功，迟到目录回包不覆盖当前值
  实际system入口执行 -> 显示端生成、原服务端回退、缓存满不回退、速率/音量处理
  回归现有TTS路由、文本媒体、Agent播放与聊天打断
```
