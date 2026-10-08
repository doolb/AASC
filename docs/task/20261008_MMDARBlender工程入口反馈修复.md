# MMD-AR Blender 工程入口反馈修复

## 任务描述

用户反馈点击“Blender工程”没有反应。检查发现 `edStatus` 位于默认折叠的 `edPanel` 中；当浏览器不支持 `showDirectoryPicker` 或加载工作区失败时，错误虽已写入状态区，但用户看不到。

## 设计与规格

- 设计：`docs/design/mmd-ar-blender-workbench.md`
- 伪代码：`docs/spec/mmd-ar-blender-workbench.md`
- 点击入口后立即展开工作区并显示目录选择提示；状态/错误区域放在折叠面板外。
- 浏览器能力不足或加载失败时显示可见错误并保持入口可重试；用户取消目录选择时清除提示并恢复入口。
- 点击仍需在同步用户手势调用栈内执行 File System Access API，目录选择成功后才动态加载 Blender 模块。

## 受影响功能与代码

- `3rd/mmd-ar-test/web-editor-ui.mjs`：常驻状态区位置、点击进度、错误可见性、取消恢复。
- `docs/design/mmd-ar-blender-workbench.md`、`docs/spec/mmd-ar-blender-workbench.md`、本 task、`docs/todo.md`、`changelog.md`。
- 重新生成 `3rd/mmd-ar-test/web-dist`。

## 自测用例

- 点击入口时，工作区面板展开且目录选择提示立即可见。
- 不支持 `showDirectoryPicker` 时，明确显示桌面 Chromium/目录权限提示。
- 取消系统目录选择后，提示消失且按钮恢复可用，不加载工作区模块。
- 选择目录后显示工作区加载状态；动态导入或挂载失败时错误可见且入口恢复。
- `npm run build:web:mmd-ar-test` 成功，产物内入口脚本包含常驻状态区和对应流程。

## 兼容性、性能与风险

- 继续要求 HTTPS/localhost 桌面 Chromium、File System Access API 与 Service Worker；不支持的浏览器会明确告知。
- 状态区是轻量 DOM 提示，不引入新依赖或持续运行逻辑。
- 目录选择仍直接响应用户点击，避免因异步预处理丢失浏览器用户激活。
- 当前无可用自动化 Chromium 视觉环境，实际目录对话框与 `.blend` 全流程仍待桌面浏览器验收。

## 预计工作

约 15 分钟，不含桌面浏览器人工验收。

## 实施记录

- 已把状态/错误区域放在折叠面板之外；点击入口后先显示可见提示，选择目录后显示加载状态，取消时清除提示并恢复按钮。
- `node --check 3rd/mmd-ar-test/web-editor-ui.mjs`、`git diff --check` 通过；`npm run build:web:mmd-ar-test` 成功，生成 `3rd/mmd-ar-test/web-dist`。产物含入口状态区和新点击流程；Vite 仅提示 Blender 静态资源分块超过 500 kB，不影响构建。
- 未运行测试套件或真实桌面 Chromium；目录选择、取消及真实 `.blend` 打开仍待桌面浏览器验收。本轮未发布外网。
