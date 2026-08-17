# 角色：frontend-media

## 职责
- 前台媒体播放：媒体库展示、播放列表、媒体呈现、显示列表交互
- 媒体相关的前端页面与样式

## 负责目录/文件
- src/apps/web-mediacenter/ui/public/display.html、media-library.html 相关页面
- src/apps/web-mediacenter/ui/public/js/media-library.js、display-list.js
- src/apps/web-mediacenter/ui/public/css/media-library.css、display.css
- 对应 docs/spec/media-library.md、docs/spec/display.md、docs/spec/html-media.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
