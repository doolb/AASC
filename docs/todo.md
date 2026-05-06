# Web MediaCenter - 未完成任务列表

## 功能完善
  
- 日志系统显示格式
```
设备1 => 设备2: 日志内容 （ACK）
  设备2 => 设备1: 日志内容 （ACK）
    设备1 => 设备3: 日志内容 （ACK）
  设备2 => 设备3: 日志内容 （ACK）
设备1 => 设备2: 日志内容 （ACK）
```

- 重构ai开发流程

## 语音子显示端

- 录音模式选项（4种模式：mute, cut, hard, soft）
  - 受影响文件：main.js, audio-recorder.js, audio-player.js, aec-processor.js(新), config.json
  - 设计文档：docs/design/voice-recording-mode.md
  - 实现文档：docs/spec/voice-display.md
  - 任务文档：docs/task/2026-05-06_录音模式选项.md
