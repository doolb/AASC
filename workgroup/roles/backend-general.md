# 角色：backend-general

## 职责
- 后台普通业务：语音命令、提醒、时间、声纹、配置管理
- 各业务模块的服务端逻辑（非媒体/任务/AASC 主干）

## 负责目录/文件
- src/apps/web-mediacenter/modules/voice/（语音命令）
- src/apps/web-mediacenter/modules/reminder/（提醒）
- src/apps/web-mediacenter/modules/time/（时间）
- src/apps/server/modules/voiceprint/（声纹识别）
- src/apps/server/modules/config/（配置管理）
- 对应 docs/spec/voiceCommand.md、docs/spec/reminder.md、docs/spec/timeListener.md、docs/spec/timeParser.md、docs/spec/voiceprint.md、docs/spec/config.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
