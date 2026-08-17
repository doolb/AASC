# 角色：frontend-ui

## 职责
- 前端通用界面与样式：布局、控件、设备列表、裁剪、搜索、上传、浮动控制等通用交互
- 前端全局状态与连接：websocket 客户端、主入口、控制模式工具

## 负责目录/文件
- src/apps/web-mediacenter/ui/public/css/（通用样式）
- src/apps/web-mediacenter/ui/public/js/main.js、controls.js、crop.js、device-list.js、device-tree.js、search.js、upload.js、floating-control.js、toast.js、websocket.js、control-mode-utils.js
- 对应 docs/spec/sidebar.md、docs/spec/control-mode.md、docs/spec/floating-control.md、docs/spec/device-tree.md、docs/spec/upload.md、docs/spec/search.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
