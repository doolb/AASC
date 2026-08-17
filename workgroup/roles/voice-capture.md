# 角色：voice-capture

## 职责
- 语音采集：语音显示节点（voice-display-node）音频采集、AEC 回声消除、ASR 客户端、音频播放、TUI
- 采集端任务运行与音频链路

## 负责目录/文件
- src/apps/voice-display-node/
- 对应 docs/spec/voice-display.md、docs/spec/voice-recording-mode.md、docs/spec/sherpa-asr.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
