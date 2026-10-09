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

## ASR结果、实时VAD与手动结束（2026-10-09，最终规则已确认）

用户最终明确：只有满足前面的有效语音和静音等待才识别，条件未满足时再次点击直接中断。本轮不采用完整PCM/forceSubmit方案，继续复用既有分段采集。

```text
新增定义 VoiceFeedback { currentVoiceVadRms, lastVoiceAsrText }
新增判断 isVoiceSegmentReadyForRecognition(now):
    hasSpeech 且 speechStartTime/silenceStartTime 非空
    且 currentVoiceVadRms < vadThreshold
    且 now - silenceStartTime > vadSilenceDurationMs
    且 now - speechStartTime >= vadMinSpeechDurationMs
结束手动录音 finishManualVoiceRecording:
    非手动状态 -> 返回
    保存当前时间、epoch、manualVoiceInput
    满足共用判断且存在PCM -> 提取本轮WAV；否则不提取
    无论条件是否满足 -> 立即停止采集并清除单次定时器
    有WAV -> 提交公共ASR；否则丢弃本次录音
再次点击 / 静音自动完成 / 60秒超时 -> 同一结束路径
RMS回调:
    验证有限非负值，记录当前值，两位小数变化时发布voice.vad
    >=阈值 -> 保留beginSegment和hasSpeech更新，清空静音起点
    <阈值且有语音 -> 记录静音起点，共用判断满足后自动完成
控件:
    实际采集中显示两位小数VAD，停止或暂停时隐藏
    本端ASR结果经epoch/权限/连接/页面门控 -> voice.asr-result
    独立底部节点textContent显示，长文本换行限制高度，保留至新结果替换
    声纹未匹配可回显，不进入聊天；其他端原生ASR任务不混入
取消:
    停止采集、隐藏VAD、作废迟到结果
```

实施与发布：code51包含本节最终规则，41项定向通过；LAN/WAN签名、组件HTTP大小/SHA-256及精确清理通过。

## 状态文字末尾合并VAD数字（2026-10-09，已确认）

```text
displayVoiceActionStatus = 共用背景的状态容器
    displayVoiceActionStatusText = 助手名 + " · " + 六状态文本，保留polite状态通知
    displayVoiceVadValue = 同一容器内的纯数字，不另加背景或VAD字样，aria-live=off
render -> 仅更新状态文本子节点，避免覆盖数字子节点
RMS通知 -> 实际采集中，将数字子节点textContent设为 " " + rms.toFixed(2)
    未采集或暂停 -> 清空数字并隐藏，状态容器只剩助手名/状态
    两位小数未变化 -> 不重复写DOM
删除独立状态行容器和布局样式；保留一个状态背景
按钮aria-label继续使用助手名/状态及操作，不加入实时数字
ASR结果、PCM/VAD/ASR判定、配置、单次结束规则保持
```

code52已实现数字合并并发布LAN/WAN；21项相关测试、签名/完整组件HTTP大小和SHA-256/精确清理通过。

## 群聊状态与助手选项纠正（2026-10-09，待确认）

```text
初始assistantNames = []，不生成虚构助手项
updateAssistantConfig -> 仅规范化明确配置的有效名字，空配置不插入助手
getVoiceStatusName -> private/role有效目标返回真实名字，否则群聊
语音控件配置未到达fallback -> 群聊
测试 -> 初始/配置空时只群聊；配置小爱后群聊+小爱
    群聊状态名称始终群聊，切到小爱状态名称小爱，面板关闭亦同步
```
