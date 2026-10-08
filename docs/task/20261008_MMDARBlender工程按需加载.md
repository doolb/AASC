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

管理员配置 `/etc/apache2/conf-available/mmd-ar-cross-origin-isolation.conf`：为 `/mnt/mmd-ar/` 设置 COOP `same-origin`、COEP `credentialless`，启用 `mod_headers`，并仅对 `/var/www/html/mnt/mmd-ar/assets/blender-engine/0.1.136` 允许 `.htaccess` 使用 `Header`。`apache2ctl configtest` 返回 `Syntax OK`，Apache 已重载。之后将 23 个文件（47,296,610 bytes）发布到 `https://c.aasc.us/mnt/mmd-ar/`；暂存文件 SHA-256 与本地全部匹配。首次线上首页 SHA-256 为 `433687352b362e29eb836a905d244c9471cd840fd15c3c740f1881fa6dbb31b3`，WASM 返回 `application/wasm` 与 `Content-Encoding: br`。

用户首次点击 Blender 工程时遇到 `module.mountBlenderWorkbench is not a function`。确认 Vite 默认未保留动态导入入口的公开签名，生成模块只有被压缩的依赖导出。设置 `preserveEntrySignatures: 'exports-only'` 并在网页构建后断言 `mountBlenderWorkbench` 存在；Node 动态导入确认其类型为 `function`。重新部署首页、`display-mmd.js`、`web-editor-ui.mjs`、工作区入口和两个分块共 6 个文件，SHA-256 全部匹配；当前首页 SHA-256 为 `123c31429dd0e3e748a3a04729c9414a75f424619b218d97dafac8f8a32e6ef4`，线上工作区入口和分块均 HTTP 200。发布前的页面和资源备份保留在 `/home/as/a/.mmd-ar-blender-publish-backup-20261008`。请刷新页面后重试；真实目录授权、工程预览、Cycles 渲染和保存往返仍待验收。

## 子目录 worker 加载修复

- 复现：线上工作台分块将 worker 写成 `/assets/worker-Dlfs8e8L.js`；该 URL 在域名根目录返回 404，实际资源 `/mnt/mmd-ar/js/blender-engine/assets/worker-Dlfs8e8L.js` 返回 200。
- 修复范围：Vite 使用相对资源基路径；构建时将固定版本引擎内的 `/__editor/*` 请求改为应用子目录内的 URL；Service Worker 路由从 `registration.scope` 派生；构建后断言生成的 worker/API URL 保持子目录相对。
- `npm run build:web:mmd-ar-test` 构建通过；构建断言拒绝域名根 `/assets/worker-*` 和 `/__editor/*` 请求。生成 worker 从其 `js/blender-engine/assets/` 目录回到应用根，再请求 `__editor` 路由；Service Worker 依据 `/mnt/mmd-ar/` scope 生成同一路径。
- 启动前显式请求 Service Worker 更新，并等待注册实例的 active worker 控制当前页面，避免旧版 worker 因已存在 controller 而被误认为就绪。
- 按资源、UI 模块、显示入口、首页顺序同步外网；校验 rsync checksum dry-run 无差异。线上首页、工作台 chunk、worker 均 HTTP 200 且保留 COOP/COEP；线上 worker 子目录 URL 可用，域名根 `/assets/worker-*` 为 404；入口仍导出 `mountBlenderWorkbench`。Blender WASM 文件未变化。
- 未进行真实浏览器目录授权与 `.blend` 打开/保存/渲染验收；普通页面刷新后由 Blender 入口重新注册并更新 Service Worker。

## 引擎状态 URL 生成修复

- 用户继续报告 `.../js/blender-engine/assets/undefined: HTTP 404`。生成的 `worker.ts` 路由辅助器使用动态模板传给 `new URL`，Vite 将其改写成空资源映射 `Object.assign({})[route]`。
- 将路由构造改为复制 `import.meta.url` 并按 worker 目录层级设置 `pathname`、`search`；构建断言检测空资源映射，防止退化为 `undefined`。
- `npm run build:web:mmd-ar-test` 成功；生成 worker 不含空资源映射。修复后的 worker 使用 `/mnt/mmd-ar/__editor/*`，Service Worker 根据注册 scope 处理同一应用子目录。
- 修复后的文件已同步至 `https://c.aasc.us/mnt/mmd-ar/`；`rsync -aciR --dry-run` 无差异。线上首页、工作台模块、worker 和 Blender 状态端点均 HTTP 200，状态端点返回 `available: true`，COOP/COEP 保持启用。
- 尚未在真实浏览器中完成目录授权及 `.blend` 打开、预览、渲染、保存往返验收。

## `/mnt/mmd/blender/西施原皮.blend` 浏览器验收

- 文件为 103,355,592 bytes；所有测试均保持 `/mnt/mmd/blender/西施原皮.blend` 源文件不变。
- 首次打开时确认缺少 `BlenderRuntime.stage` 转接会报 `The presenter does not support staged Blender frames`。已在工作区接入 `stage: part => presenter.view.stageFrame(part)`，重新执行 `npm run build:web:mmd-ar-test` 并发布；线上工作区入口及新分块 HTTP 200，Blender 静态资源状态端点返回 `available: true`，COOP/COEP 仍启用。
- 用本机 Blender 4.5.4 LTS 后台打开原文件成功：1 个场景、15 个对象、8 个网格。这只确认 `.blend` 文件可读，不代表网页预览已通过。
- 修复后尝试用 Chromium 加载工作台进行回归，但当前自动化 Chromium 在导航前即失败；它连本机临时 HTTP 页面也报 `net::ERR_INSUFFICIENT_RESOURCES`。因此没有进入修复后的工作台打开流程。
- 网页端模型是否可见、保存写回和 Cycles 渲染尚未验证；此前临时拦截模块响应的“已打开”状态及 403 保存结果不作为修复后验收结论。需要在可用的桌面 Chromium 上继续验证真实目录授权、预览、保存与渲染。
