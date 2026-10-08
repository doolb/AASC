# MMD-AR Blender 工程按需加载

## 任务

接入 `@volter/blender-engine`，用户点击 Blender 工程入口并选择目录/`.blend` 后才下载和启动 WebAssembly。支持原生 Blender 工程预览、Cycles PNG 渲染及回写保存；不经过 PMX 网页导入流程和 MMD Tools 脚本。默认 MMD-AR 首屏、PMX 编辑器与 APK 不加载 Blender 资源。

## 设计与实现方案

- 设计：`docs/design/mmd-ar-blender-workbench.md`
- 伪代码：`docs/spec/mmd-ar-blender-workbench.md`
- 当前 MMD-AR 工作区：在原 PMX 编辑器旁新增 Blender 工程入口；目录选择立即触发，用户确认目录后加载工作区模块，选择 `.blend` 后才下载 WASM 并启动。
- `@volter/blender-engine@0.1.136` 的 npm 包自身依赖 `/__editor/blender-wasm/*`、工程目录索引/读取/分块保存接口及跨域隔离。独立静态站点用同源 Service Worker 和 Brotli 静态资源适配；项目文件只从用户授权目录读写。
- 复用包的 Blender 5.2 WASM、Three Presenter、worker 和 session；精确 pin npm 版本并保留 GPL 与依赖 licenses。

## 受影响范围

- `3rd/mmd-ar-test/web-editor-ui.mjs`、独立工作区/Service Worker 模块、构建脚本与生成入口。
- 根 `package.json` 的安装脚本、`3rd/mmd-ar-test/blender-engine/package.json` 与 lockfile 中的独立构建依赖，`3rd/mmd-ar-test/web-dist`（忽略生成目录）。
- `.htaccess`/跨域隔离配置及独立 WASM 静态资源目录。
- `docs/design.md`、`docs/spec.md`、`docs/usage.md`、`docs/todo.md`、`changelog.md`。

## 自测与兼容性检查

- 普通首屏没有请求 Blender ESM、worker、WASM/data/Essentials；点击 Blender 入口后才加载。
- 选择包含相对贴图的 `.blend` 目录；预览、Cycles PNG、保存后再打开。
- 目录选择取消、目录读/写权限撤销、WASM 下载失败、缺少 COOP/COEP、Service Worker 首次安装、保存哈希错误均能显示错误并保留可恢复状态。
- 确认普通 MMD-AR/PMX 功能不变；APK 包不包含 Blender 文件。
- 首期面向 HTTPS 桌面 Chromium；其他浏览器明确提示暂不支持目录工作流。

## 风险

WASM 初始化资源约 38 MB 压缩体积，Blender 本身的解码后内存约 150 MB，打开工程还会复制工程资源并占用模型内存。工程外部链接、未编入 Blender WASM 的插件、特殊渲染节点可能不可用。Apache 需要在该站点路径返回 COOP `same-origin` 和 COEP `credentialless`，并正确提供 Brotli 编码；没有跨域隔离时多线程 Blender 不可启动。COEP 可能限制未提供 CORS/CORP 的跨域资源。

## 预计工作

独立构建入口、静态文件适配、工作区 UI、权限/保存生命周期、完整 `web-dist` 构建及外网部署已完成。`npm run build:web:mmd-ar-test` 成功；未运行自动化测试或真实浏览器工程往返。

首次尝试发布时，Apache 未加载 `mod_headers`，`/var/www/` 的 `AllowOverrideList` 不允许 `Header`，原始静态资源规则中的 `Options -MultiViews` 也被拒绝；当时已回滚该次公开文件。随后改为直接请求 `.br`，移除 `Options` 和 rewrite 依赖。

管理员配置 `/etc/apache2/conf-available/mmd-ar-cross-origin-isolation.conf`：为 `/mnt/mmd-ar/` 设置 COOP `same-origin`、COEP `credentialless`，启用 `mod_headers`，并仅对 `/var/www/html/mnt/mmd-ar/assets/blender-engine/0.1.136` 允许 `.htaccess` 使用 `Header`。`apache2ctl configtest` 返回 `Syntax OK`，Apache 已重载。之后将 23 个文件（47,296,610 bytes）发布到 `https://c.aasc.us/mnt/mmd-ar/`；暂存文件 SHA-256 与本地全部匹配。线上首页 SHA-256 为 `433687352b362e29eb836a905d244c9471cd840fd15c3c740f1881fa6dbb31b3`，首页、工作区模块、Service Worker、引擎状态和压缩 WASM 均 HTTP 200，WASM 返回 `application/wasm` 与 `Content-Encoding: br`。发布前的页面和资源备份保留在 `/home/as/a/.mmd-ar-blender-publish-backup-20261008`。真实浏览器的目录授权、工程预览、Cycles 渲染和保存往返仍待验收。
