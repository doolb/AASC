# 显示端语音交互实现伪代码

```text
已有声明 = PCM/VAD/ASR、handleTts、DisplayStage.bus、DisplayChat、persistDisplayState
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
