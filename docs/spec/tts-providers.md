# TTS Provider 与播报配置实现

## 仅使用 Chat2API 账号（2026-10-11 已实现）

```text
已有声明:
  Chat2API数据存储.listAccounts/getAccount、Provider注册表.getProvider
  TTS配置规范化/脱敏、setTtsProviderConfig、qwen-chat签名及WebSocket生成

新增定义:
  QwenCredentialReference { chat2apiAccountId }
  PublicAccountChoice { accountId, label, available }
  AccountChoiceMessage { type, requestId, accounts, success, message }

操作流程:
  qwen-chat -> 只支持Chat2API账号；不定义来源切换或手动凭证输入
  账号ID -> 仅接受限长无换行字符串；非法 -> 回传旧权威配置
  旧qwen-chat手动凭证 -> 忽略且下次保存移除，不自动导入账号库
  未选择账号 -> 提示选择Chat2API国内千问账号，不自动选取账号
  非qwen-chat -> 保持原凭证规则，不使用Chat2API引用
  保存所选账号ID与合成参数 -> 不把账号凭证复制到配置
  控制端账号查询 -> 验证控制端身份 -> 共用账号存储的脱敏列表
    仅国内qwen账号 -> ID/显示名称/可用状态 -> requestId对应回包
    查询失败或所选账号消失 -> 保留原ID并提示，不自动选择其他账号
  保存 -> 原规范化/config持久化/脱敏广播 -> 初始化及重连恢复账号ID
  qwen-chat合成 -> 读取所选Chat2API账号当前数据及国内qwen Provider
    账号不存在/停用、Provider停用、错Provider、缺少ticket/Cookie -> 脱敏错误
    合并已确认Cookie字段与credentials.ticket -> 本次请求内存凭证
    账号读取计入总超时 -> 超时固定错误且不再继续签名
    本次内存凭证 -> 原Chrome签名 -> 原WebSocket -> 完整WAV缓存
    不广播/记录原始凭证，不修改Chat2API账号，不切换账号

自测流程:
  旧手动值不会用于生成/回包、其他Provider兼容、账号ID规范化、保存失败权威回退、重连恢复
  国内/国际账号区分、禁用/删除/无凭证账号、Provider停用
  ticket与完整Cookie读取、账号凭证更新后下次生成采用新值
  前端账号选择/查询失败/失效选择保留、所有回包及日志无原始凭证
  无运行中代理仍可读取共享账号库，签名/合成失败不自动换账号
  回归现有Provider配置、生成、模板选择、业务路由与控制端自测
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
  ProviderSettings { enabled, endpoint, model, credential, chat2apiAccountId, defaultVoice, defaultSpeed, defaultVolume, resourceId }
  qwen-chat仅保存chat2apiAccountId，其他Provider仅保存credential
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
  API凭证空输入 -> 保留；明确clearCredential -> 清除；API广播仅credentialConfigured
  qwen-chat -> 不读/写手动credential；广播账号引用
  云端/网页默认关闭；未收到配置 -> system本地默认
  目录请求 -> system旧音色接口或Provider目录 -> 返回id/name/available
  目录失败 -> 保留已有选择；缺失已选ID -> 标注待校验而不清除
  system生成 -> 现有显示端/服务器路由 -> 原缓存引用
  qwen-api -> Bearer凭证 -> model/input.text/voice -> output.audio.url -> 无凭证下载完整WAV
  doubao-api -> API Key/resourceId/requestId -> req_params与PCM音频参数
    NDJSON/SSE事件 -> 校验业务code与完成事件 -> 限长收集base64 PCM -> 包装WAV
  qwen-chat -> 所选Chat2API国内账号最新Cookie/登录ticket -> 临时无头浏览器加载www.qianwen.com
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
