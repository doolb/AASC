# 角色：backend-media

## 职责
- 后台媒体库管理：媒体库提供者、播放列表、文件操作
- 媒体库相关的服务端逻辑

## 负责目录/文件
- src/apps/web-mediacenter/modules/media/
- 对应 docs/spec/media-library.md、docs/spec/batch-playlist.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
