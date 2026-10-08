# MMD-AR Blender 角色与骨骼编辑集成

## 任务描述

用户要求打开 `.blend` 后将其中角色替换到 MMD-AR 当前角色视口，并支持编辑、预览；补充要求 Blender 对象和骨骼都可编辑，且需要支持骨架结构修改。

## 设计与规格

- 设计：`docs/design/mmd-ar-blender-workbench.md`
- 伪代码：`docs/spec/mmd-ar-blender-workbench.md`
- `.blend` 工程复用 MMD-AR 主场景、相机和 renderer，不显示独立全屏 Blender viewport。
- 打开时隐藏当前 MMD 角色并暂存其可见性/相机；挂载 Blender Presenter root 并按模型包围盒取景。关闭后卸载 Blender root 并恢复状态。
- Blender 专属编辑器支持对象 location/rotation/scale、骨骼 pose 变换、Edit Bone head/tail/roll/parent 修改；通过 Blender Runtime Python API 执行，刷新 Blender 帧后更新主视口。
- PMX 刚体/关节工具仅对 PMX 模型可用。当前 Blender WASM runtime 不提供完整网格雕刻/权重绘制 UI。
- 保留目录权限、原生 `.blend` 保存、Cycles PNG 和按需下载流程。

## 受影响功能与代码

- `3rd/mmd-ar-test/web-editor-ui.mjs`：模式路由、当前角色/Blender 模式切换和 Blender 编辑控件。
- `3rd/mmd-ar-test/web-editor-bridge.mjs`：安全挂载/卸载 Blender root、隐藏/恢复当前角色与相机、主视口取景。
- `3rd/mmd-ar-test/blender-engine/workbench.mjs`：移除独立全屏 renderer，加入对象/Armature/骨骼层级和 Blender Runtime 属性编辑。
- 可能修改 `3rd/mmd-ar-test/web-editor-build.js`，按需增加 DisplayMmd bridge 能力。
- `docs/design/mmd-ar-blender-workbench.md`、`docs/spec/mmd-ar-blender-workbench.md`、本 task、`docs/todo.md`、`changelog.md`。

## 自测用例

- 加载 `.blend` 后工程角色在原 MMD-AR 主视口显示，原角色暂时隐藏；关闭 Blender 工作区后原角色、相机和 PMX 编辑功能恢复。
- 对象位置、旋转、缩放及 Armature pose bone 变换能即时反映到同一视口并保存到 `.blend`。
- 骨骼头/尾、Roll、父级修改更新骨架层级/姿态；保存并重新打开后结果保留。
- Blender 编辑与预览切换不重复创建 viewport、不丢失编辑状态；Cycles PNG 对应当前 `.blend` 状态。
- 未选中 Blender 工程时，原 PMX 编辑/物理/角色切换流程不变；Blender 首屏资源仍按需加载。
- 运行构建与静态检查；桌面 Chromium 能用时，对 `/mnt/mmd/blender/西施原皮.blend` 做实际打开、编辑、保存回读验收。

## 兼容性、性能与风险

- 桌面 Chromium HTTPS/localhost、File System Access API、Service Worker、COOP/COEP 与可用 WebGL 为必要条件。
- 不新增第二个常驻 WebGL renderer，避免额外 GPU context 与画面不同步。
- Blender Runtime 调用会重建模型帧；快速连续的数值输入需要合并/节流，避免重复发送完整工程数据。
- Python 对象名必须安全转义；骨架结构修改必须在 Blender Edit Mode 执行并在异常时恢复原模式，确保保存/渲染可继续。
- 任意 `.blend` 可能包含多个角色/Armature；编辑面板需明确当前选择，不能默认改动所有骨架。
- 当前自动化 Chromium 环境曾在导航前报 `ERR_INSUFFICIENT_RESOURCES`，无法据此完成网页视觉验收；需要继续保留此限制说明。

## 预计工作

编辑桥接、工作区交互、构建检查与文档更新约 1～2 小时；实际浏览器验收视 Chromium 环境而定。本轮不发布外网。

## 实施记录

- Blender 工作区已改为嵌入 MMD-AR 的编辑面板；Blender Presenter root 通过 editor bridge 挂到现有场景，复用主相机、灯光、renderer 与渲染循环。打开时暂停当前动作/物理并隐藏当前 MMD 角色；返回时还原角色可见状态、相机、物理、动作和 PMX 工作区模式。
- 页面“编辑／预览／渲染”模式会路由到 Blender 工作区。编辑面板提供对象位置/旋转/缩放、骨骼 Pose 变换，以及 EditBone 头/尾、Roll、父级结构修改。Blender 变更交给 Runtime 写入 `.blend` 并刷新主视口。
- 已运行 `npm run build:web:mmd-ar-test`，本地 `web-dist` 构建完成；构建产物的 Blender 子目录 URL 与工作区入口检查通过。
- `node --check` 检查 UI、editor bridge 和 Blender workbench 通过，`git diff --check` 通过。未运行测试套件。
- 浏览器视觉验收未完成：当前自动化 Chromium 在导航前报 `ERR_INSUFFICIENT_RESOURCES`，包括本机临时页面；因此 `/mnt/mmd/blender/西施原皮.blend` 在新主视口内的实际显示、骨骼编辑、Cycles 和保存回读仍待桌面 Chromium 验收。
