# 全局播放时暂停录音实现伪代码

## 配置模型

```text
voiceprint.pauseRecordingDuringPlayback = true
voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint = false
```

## 服务端配置接口

```text
GET /api/voiceprint/config:
    返回 pauseRecordingDuringPlayback
    缺失或非法值按 true 返回
    返回 acceptVoiceInputDuringTtsWithoutVoiceprint
    缺失或非法值按 false 返回

POST /api/voiceprint/config:
    读取 pauseRecordingDuringPlayback
    读取 acceptVoiceInputDuringTtsWithoutVoiceprint
    如果字段存在且不是布尔值:
        返回 400
    如果字段存在:
        保存 voiceprint.pauseRecordingDuringPlayback
    如果字段存在且不是布尔值:
        返回 400
    如果字段存在:
        保存 voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint
    保存全局配置
    对每个在线显示端发送 voiceprintConfig:
        pauseRecordingDuringPlayback = 当前全局值
    返回成功

显示端连接:
    发送 voiceprintConfig:
        pauseRecordingDuringPlayback = 当前全局值
```

## 控制端声纹面板

```text
初始化:
    请求 /api/voiceprint/config
    checkbox.checked = response.pauseRecordingDuringPlayback !== false

checkbox change:
    body.pauseRecordingDuringPlayback = checkbox.checked
    POST /api/voiceprint/config

初始化无声纹 TTS 输入复选框:
    checkbox.checked = response.acceptVoiceInputDuringTtsWithoutVoiceprint === true

无声纹 TTS 输入复选框 change:
    body.acceptVoiceInputDuringTtsWithoutVoiceprint = checkbox.checked
    POST /api/voiceprint/config
```

## 显示端 TTS/ASR 协调

```text
pauseRecordingDuringPlayback = true

收到 voiceprintConfig:
    pauseRecordingDuringPlayback = data.pauseRecordingDuringPlayback !== false

pauseVoiceRecordingForTts():
    如果当前采集用途不是 asr:
        返回
    如果 pauseRecordingDuringPlayback == false:
        返回
    如果当前普通 ASR 正在监听:
        保存原监听状态
        暂停 PCM/VAD

服务端处理 ASR 结果:
    如果声纹关闭 且 TTS 播放中
        且 acceptVoiceInputDuringTtsWithoutVoiceprint != true:
            忽略语音输入
    否则:
        继续显示端语音会话和命令门控
    如果 pauseRecordingDuringPlayback == true:
        显示端仍暂停采集，服务端开关不改变本地录音策略

resumeVoiceRecordingAfterTts():
    只有此前由播放事件暂停且当前仍允许监听时恢复 PCM/VAD
```

## 验证

```text
默认配置缺失 -> 控制端勾选且显示端按暂停处理
配置 false -> POST 校验通过、广播 false、显示端播放时不调用暂停
配置 true -> 广播 true、显示端播放时调用暂停并在结束后恢复
非布尔配置 -> 返回 400 且不修改已有配置
单次/实时录音 -> 不受播放暂停开关影响
新开关缺失 -> 按 false 处理，维持无声纹 TTS 播放期间丢弃语音
新开关 true 且声纹关闭 -> 服务端不因 TTS 播放状态丢弃语音结果
新开关 true 且声纹开启、speaker=null -> 仍按未匹配声纹规则拒绝命令处理
播放时暂停录音 true -> 显示端在 TTS 期间仍暂停采集，新开关不改变此行为
```
