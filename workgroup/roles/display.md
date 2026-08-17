# 角色：display

## 职责
- Web 显示端：display.html 页面、画面适配、旋转裁剪、选择模式
- render-display 渲染任务（横条化、内嵌文字、GPU/显存展示）

## 负责目录/文件
- src/apps/web-mediacenter/ui/public/display.html
- res/tasks/render-display/
- 对应 docs/spec/display.md、docs/spec/display-selection.md、docs/spec/display-ui-rotation.md、docs/spec/display-sleep-mode.md、docs/spec/render-display-inline-text.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
