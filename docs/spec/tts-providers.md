# TTS Provider 与播报配置实现

```text
已有声明:
  config.get/set、用户配置 DataSnapshot、normalizeChatTemplate、chat.getTemplateByName
  generateTtsWithFallback、ttsAudioCache.storeAudio、createAgentTtsStream
  textMediaTtsService、报时/提醒生成回调、控制端初始化与broadcastToControls

新增定义:
  TtsBusiness { aiReply, agentReply, textMedia, systemBroadcast }
  TtsSelection { provider, voice }
  ProviderSettings { enabled, endpoint, model, credential, defaultVoice, defaultSpeed, defaultVolume, resourceId }
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
  音色 -> 显式音色 -> 相同Provider的业务默认音色 -> 最终Provider自身默认
  参数 -> 规范化有限数字 -> Provider默认速度/音量
  控制端setTtsProviderConfig -> 校验完整候选配置 -> 保存用户Provider参数与config业务选择
  保存失败 -> 恢复旧内存值 -> 回传旧脱敏配置和错误
  保存成功 -> 向所有控制端广播脱敏权威值 -> 初始化/重连补发
  凭证空输入 -> 保留；明确clearCredential -> 清除；广播仅credentialConfigured
  云端/网页默认关闭；未收到配置 -> system本地默认
  目录请求 -> system旧音色接口或Provider目录 -> 返回id/name/available
  目录失败 -> 保留已有选择；缺失已选ID -> 标注待校验而不清除
  system生成 -> 现有显示端/服务器路由 -> 原缓存引用
  qwen-api -> Bearer凭证 -> model/input.text/voice -> output.audio.url -> 无凭证下载完整WAV
  doubao-api -> API Key/resourceId/requestId -> req_params与PCM音频参数
    NDJSON/SSE事件 -> 校验业务code与完成事件 -> 限长收集base64 PCM -> 包装WAV
  qwen-chat -> 国内网页Cookie/登录ticket -> 临时无头浏览器加载www.qianwen.com
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
