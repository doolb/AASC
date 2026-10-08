# MMD-AR Blender 工程工作区

## 目标

让独立 MMD-AR 网页可以直接使用 Blender `.blend` 工程。网页初次加载和普通 PMX 编辑不下载 Blender；用户点击“Blender 工程”后立即打开目录选择器，再按需加载工作区模块和 Blender WebAssembly。打开工程后，Blender 角色接管 MMD-AR 当前视口中的角色位置，进入同一页面的编辑、预览和渲染流程。工程以原生 `.blend` 文件读写，不经过网页 PMX 导入器或 MMD Tools 转换脚本。

目录选择使用浏览器 File System Access API，读取同一目录中的 `.blend`、贴图和引用资源，并将保存后的 `.blend` 写回该目录。目录句柄只保存在当前浏览器 origin 的 IndexedDB；浏览器撤销权限后提示重新授权。首期面向 HTTPS 桌面 Chromium；不支持目录读写的浏览器显示明确兼容性提示。

## 运行方式

- 工作区 JS、Blender WASM、Blender data 与 Essentials 独立于首屏，只有启动 Blender 工程时请求；浏览器缓存可供后续复用。
- 固定 `@volter/blender-engine@0.1.136` 版本并保留 GPL-3.0-or-later 与第三方依赖声明。
- Vite 入口由 UI 动态导入，构建必须保留 `mountBlenderWorkbench` 的公开导出签名；构建后检查生成模块包含该导出，缺失时终止网页构建。
- 该库依赖跨域隔离、WASM 资源、工程目录索引/读取及工程保存接口。静态页用最小 Service Worker 适配这些同源接口，不向服务端上传工程。
- 页面部署需要 HTTPS/localhost、`Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: credentialless`；页面和模块按同源相对路径工作。
- 独立网页部署在 `/mnt/mmd-ar/` 这类子目录时，Vite 生成的 worker/分块 URL 与引擎 API URL 都必须留在当前应用路径内；Service Worker 的 API 路由由其注册 scope 计算，避免访问域名根路径。
- 启动 Blender 前先请求 Service Worker 更新，并等待本次注册的 active worker 接管页面，避免已有旧版本控制器继续处理新 API 路由。
- 目录选择发生在用户点击的同步调用栈里；确认选中目录后才加载工作区模块。用户取消选择时不下载工作区模块。Blender 实例只在用户选择 `.blend` 并按“打开”后创建。
- 工程读取复用目录树相对路径；引擎保存的 `.blend` 写回已授权目录。关闭工作区前排空并保存；写回失败保留会话并提示原因。
- Blender 预览复用 `DisplayMmd` 的场景、相机和 renderer；工作区加载时暂时隐藏当前角色模型，关闭时恢复其原可见状态与相机。Blender 工程角色通过受控编辑桥接接入，不另建全屏 Three.js viewport。
- Blender 工程的编辑面板显示对象层级、对象位置/旋转/缩放，以及 Armature 的骨骼层级、姿态变换和骨架结构（头、尾、Roll、父级）。属性修改通过 `BlenderRuntime.execute` 写入当前 `.blend`，随后请求新帧更新主视口。
- Blender 工程激活时使用 Blender 专属编辑面板；PMX 刚体/关节和物理编辑只在 PMX 角色模式显示。Blender 编辑覆盖对象与骨架，不承诺网格顶点雕刻、权重绘制等完整 Blender GUI 功能。
- 预览继续显示主视口中的 Blender 角色；Cycles PNG 渲染、目录授权、保存和按需加载沿用现有流程。普通首屏资源、默认 PMX 预览、MMD 物理和 APK 不加载 Blender。
- `BlenderRuntime` 的分阶段帧协议必须连接到 `BlenderRuntimeView.stageFrame`；首帧最终到达 `present` 前，先暂存网格/图像分片，再由完整帧提交显示。漏掉 `stage` 回调会使打开工程失败。

## 首期边界

首期提供选目录、选 `.blend`、在 MMD-AR 主视口中替换当前角色、对象与骨架编辑、预览、Cycles 图片渲染、保存与退出。原工程未修改前不自动保存；编辑后由 Blender 会话负责文档保存。工程路径和资产保持用户选择目录的相对结构。

主要限制为桌面 Chromium 的目录读写能力和 Blender WASM 的内存/启动成本。iOS/Safari、Firefox 或不允许 Service Worker 的环境不启用 Blender 工程入口。Blender 自定义插件若不包含在编译引擎中，工程会提示缺失插件，不运行 MMD Tools。

## 完成标准

- 普通首屏 Network 不请求工作区模块、Blender glue、WASM、data 或 Essentials。
- 点击入口立即显示目录选择器；仅选择工程后才下载并启动 Blender。
- 带相对贴图的 `.blend` 角色进入 MMD-AR 主视口并暂时替换当前角色；关闭后当前角色与相机状态恢复。
- 对象变换、骨骼姿态以及骨架头尾、Roll、父级修改能更新视口并保存回原 `.blend`；刷新后可再次打开。
- Blender 预览和 Cycles PNG 使用同一工程状态；PMX 刚体/关节编辑不会误用于 Blender 工程。
- 渲染导出为 PNG；退出后销毁 worker/WebGL 资源。
- 测试 APK 不加载 Blender 工作区资源。
