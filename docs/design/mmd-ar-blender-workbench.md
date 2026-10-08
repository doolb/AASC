# MMD-AR Blender 工程工作区

## 目标

让独立 MMD-AR 网页可以直接使用 Blender `.blend` 工程。网页初次加载和普通 PMX 编辑不下载 Blender；用户点击“Blender 工程”后立即打开目录选择器，再按需加载工作区模块和 Blender WebAssembly。工程以原生 `.blend` 文件读写，不经过网页 PMX 导入器或 MMD Tools 转换脚本。

目录选择使用浏览器 File System Access API，读取同一目录中的 `.blend`、贴图和引用资源，并将保存后的 `.blend` 写回该目录。目录句柄只保存在当前浏览器 origin 的 IndexedDB；浏览器撤销权限后提示重新授权。首期面向 HTTPS 桌面 Chromium；不支持目录读写的浏览器显示明确兼容性提示。

## 运行方式

- 工作区 JS、Blender WASM、Blender data 与 Essentials 独立于首屏，只有启动 Blender 工程时请求；浏览器缓存可供后续复用。
- 固定 `@volter/blender-engine@0.1.136` 版本并保留 GPL-3.0-or-later 与第三方依赖声明。
- 该库依赖跨域隔离、WASM 资源、工程目录索引/读取及工程保存接口。静态页用最小 Service Worker 适配这些同源接口，不向服务端上传工程。
- 页面部署需要 HTTPS/localhost、`Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: credentialless`；页面和模块按同源相对路径工作。
- 目录选择发生在用户点击的同步调用栈里；确认选中目录后才加载工作区模块。用户取消选择时不下载工作区模块。Blender 实例只在用户选择 `.blend` 并按“打开”后创建。
- 工程读取复用目录树相对路径；引擎保存的 `.blend` 写回已授权目录。关闭工作区前排空并保存；写回失败保留会话并提示原因。
- Blender 工作区与现有 PMX 编辑器是并列入口，不改变默认预览、MMD 物理、角色切换或普通网页首屏资源。

## 首期边界

首期提供选目录、选 `.blend`、Blender 原生预览、Cycles 图片渲染、保存与退出。界面先采用简化工作区；对象树和通用 RNA 属性编辑可随后逐步接入。原工程未修改前不自动保存；编辑后由 Blender 会话负责文档保存。工程路径和资产保持用户选择目录的相对结构。

主要限制为桌面 Chromium 的目录读写能力和 Blender WASM 的内存/启动成本。iOS/Safari、Firefox 或不允许 Service Worker 的环境不启用 Blender 工程入口。Blender 自定义插件若不包含在编译引擎中，工程会提示缺失插件，不运行 MMD Tools。

## 完成标准

- 普通首屏 Network 不请求工作区模块、Blender glue、WASM、data 或 Essentials。
- 点击入口立即显示目录选择器；仅选择工程后才下载并启动 Blender。
- 带相对贴图的 `.blend` 在工作区显示；编辑并保存后同一目录的 `.blend` 更新，刷新后可再次打开。
- 渲染导出为 PNG；退出后销毁 worker/WebGL 资源。
- 测试 APK 不加载 Blender 工作区资源。
