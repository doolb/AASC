# 角色：tts

## 职责
- 语音合成：外部 TTS 调用超时、流式写盘、失败清理与内存保护
- TTS 服务端逻辑与前端播放配合

## 负责目录/文件
- src/external/tts/
- res/uploads/tts/
- 对应 docs/design/tts.md、docs/spec/tts.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
