# 显示端语音交互实现伪代码

```text
已有声明 = PCM/VAD/ASR、handleTTS、DisplayStage.bus、DisplayChat、persistDisplayState
新增定义 = VoiceInteraction { continuous=true, configReady=false, manual=false, epoch, recognizingCount, chatRequests }

连接：服务端读取 displayId 的 voiceContinuousEnabled，缺失时 true
    下发 displayVoiceListeningConfig；能力和 ASR 就绪后启动持续采集
切换：发送 setDisplayVoiceListeningConfig { displayId, enabled, requestId }
    服务端验证为对应显示端或控制端；规范化并持久化
    显示端与控制端接收权威值；失败回传原值；重连补发
    显示端停止旧采集、增加 epoch，按新模式启动；不改变能力权限
圆钮点击：立即本地普通 TTS stop，发送同款 WebSocket stop
    持续模式 -> 保持/恢复持续采集
    手动录音中 -> 结束并提交识别
    否则能力、全局暂停及录音用途允许 -> 单次采集，最长 60 秒
语音结束：持续模式提取 WAV、复用 PCM、保留原服务端门控
    手动模式提取 WAV、释放麦克风，不自动续录
    manualVoiceInput 标记使公共 ASR 只返回结果，不进入唤醒/命令链路
    epoch 未变且权限/连接允许 -> 过滤无效及 speaker=null 分段
    合并文字，通过当前 DisplayChat 发送一次
状态：实际本端播放 -> 说话中；有效 ASR -> 识别中；聊天未完成 -> 思考
    单次录音或持续语音活动 -> 监听中；持续采集待机 -> 空闲；其他 -> 已停止
    仅状态改变刷新 DOM，不增加动画帧循环
异常：断线/全局暂停/能力关闭/模式切换作废手动会话与超时
    旧异步采集返回立即停止轨道，不覆盖新链路
    TTS 恢复仅允许持续模式或仍未结束的手动录音
    开启持续模式时如果策略要求播报期间暂停且已有播报，则等播报结束再采集
    远端播放标识随播放开始/结束更新，不随录音开关清空；断线时单独清理
```

## 状态按钮点击修复（2026-10-09，已实现并发布code50）

```text
已有声明: handleTTS负责正式普通播报命令，activateVoiceInteraction负责状态按钮业务
新增定义: 实际处理函数引用、实际按钮流程浏览器夹具、打断/启动操作记录
操作流程:
  圆钮点击进入实际activateVoiceInteraction，调用大小写一致的handleTTS传入stop
  本地停止后发送WebSocket stop；实时模式保持或恢复采集
  非实时模式通过既有权限及就绪检查后开启单次录音，状态显示监听中
  再次点击或静音结束沿用既有单次提交和资源释放
  单元夹具加载真实handleTTS，不为不存在的handleTts提供模拟实现
  浏览器执行实际按钮业务及播报处理函数，验证实时打断和单次开始/结束
  保留断线、录音权限、全局暂停、模式切换和60秒取消规则
```

## 状态文字显示助手名（2026-10-09，已实现并发布code50）

```text
DisplayChat.getVoiceStatusName:
    当前mode为private且目标非空 -> 返回privateTarget
    当前mode为role且角色非空 -> 返回roleTarget
    否则返回assistantName，默认“助手”
DisplayChat.renderHeader:
    按现有流程渲染选择器
    bus发布chat.status-name，不依赖visible
DisplayVoiceControls.render:
    assistantName = DisplayChat只读名字接口返回值，未就绪时“助手”
    statusLabel = assistantName + “ · ” + 六状态文本
    status.textContent = statusLabel
    圆钮aria-label包含同样的名字与状态，再拼接当前操作
订阅chat.status-name -> 复用render
    接收配置/角色列表/会话快照及手动切换时立即更新，不增加轮询
```

2026-10-09 本轮修复已提交origion/master并发布code50至LAN/WAN，50项定向自测通过；签名、所有组件HTTP大小/SHA-256及精确清理通过。Android实际录音与重开验收待设备验证。

## ASR结果、实时VAD与手动强制识别（2026-10-09，已确认，点击结束规则待澄清）

ASR/VAD数据流已实现；以下完整手动PCM/forceSubmit部分为初始确认方案，因最新静音等待表述待澄清，尚未实施。当前点击仍调用已有finishManualVoiceRecording并受hasSpeech限制。

```text
已有声明:
    PcmAudioCapture / NativePcmAudioCapture的segmentMode、takeWav
    handleVoiceVadRms、finishManualVoiceRecording、sendAudioForRecognition
    DisplayStage消息总线、DisplayVoiceControls六状态和助手名
新增定义:
    voice.vad只更新数值节点，不反复改写aria-live状态文字
    VoiceFeedback { asrText, vadRms, manualStartedAt }
    displayVoiceAsrResult位于displayVoiceActionStatus上方
    finishManualVoiceRecording输入forceSubmit，默认false
操作流程:
    手动开始 -> segmentMode=false完整缓存；记录实际采集开始时间
    持续开始 -> 保持segmentMode=true和300ms前置缓冲
    手动再次点击 -> forceSubmit=true
        有采集器且(forceSubmit或hasSpeech) -> 提取本轮WAV
        timing起点优先speechStartTime，否则manualStartedAt
        停止录音并清除单次定时器 -> 有音频则提交公共ASR
        无音频不创建识别请求
    静音自动完成/60秒超时 -> 默认forceSubmit=false，保留有效语音条件
    RMS回调 -> 验证有限非负值、记录当前RMS、按两位小数变化发布voice.vad通知控件
        实际采集中显示VAD，两位小数；停止或暂停采集时隐藏
        不改变VAD阈值、最短语音或静音判定
    本端公共ASR返回 -> 先验证epoch、权限、连接、页面有效性
        将本端ASR结果发布voice.asr-result -> 底部结果区textContent更新
        保留已有声纹分段显示格式；未匹配内容只回显，不进入聊天
        声纹过滤及聊天发送沿用现有规则
        其他端的原生ASR提供任务只回传结果，不更新本端反馈区
    结果区 -> 新结果替换旧结果，长文本换行，不与播报字幕共享清理定时器
    断线/模式切换等取消 -> 作废迟到结果并清理录音/VAD显示
```
