# 本地 PMX 模型与 VMD 动作接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本地 Node 服务和浏览器显示端加载下载的 PMX 2.0 模型、相对纹理和 VMD 0002 动作，替换当前默认 VRM 角色；本阶段不构建 Offline APK、不上传外网。

**Architecture:** 复用现有 `/models` 静态资源路由，新增固定资源清单和 PMX/MMD 运行时分支。`display-mmd.js` 根据 `modelType` 在 VRM 运行时和 PMX 运行时之间选择；PMX 运行时使用 Three.js MMDLoader/MMDAnimationHelper，动作只通过白名单资源 ID 解析。资源目录按未来外网上传的相同相对路径组织，并保留现有占位降级。

**Tech Stack:** Node.js、Express、原生 ES modules、Three.js 0.160.0、Three.js MMDLoader/MMDAnimationHelper、node:test、Chromium/本地 WebView。

**Spec:** `docs/superpowers/specs/2026-09-22-mmd-pmx-vmd-local-design.md`、`docs/design/mmd-pmx-vmd-local.md`、`docs/spec/mmd-pmx-vmd-local.md`

## Global Constraints

- 只处理本地 Node 服务和浏览器显示端，不修改 Offline APK、Android Runtime 或 APK 模型清单。
- 不修改 PMX/VMD 二进制内容；只允许把压缩包中的文件解压到固定资源目录并使用 ASCII 文件名别名。
- PMX 必须保留 `tex/`、`toon/` 相对纹理目录，浏览器只能加载同源 `/models` 资源。
- 默认 VMD 动作启动后播放一次，不循环。
- 动作计划只能引用白名单 `resourceId`，禁止任意 URL、文件系统路径、路径穿越和脚本。
- 使用 `const/let`、`async/await`、`try-catch`，新增注释使用中文并说明资源生命周期。
- 本地模型资源不提交 Git；保留安装脚本、清单模板和测试契约。

## Review Focus

- PMX 依赖的 `tex/`、`toon/` 相对路径必须以 PMX 所在目录解析；测试：资源安装和浏览器请求验证覆盖纹理目录。
- VMD 前 7 帧为空不能被误判为加载失败；测试：VMD 文件头/帧数据校验和播放状态回归。
- VRM profile 仍需正常加载，模型类型切换必须释放旧 runtime；测试：VRM 契约和 runtime dispose 分支。
- 非法动作资源不能绕过白名单访问外部地址；测试：未知 resourceId、URL、绝对路径和 `..` 均拒绝。
- WebGL/纹理/动作任一失败不能阻塞聊天与媒体；测试：加载失败保留占位并停止动画循环。

### Task 1: 安装本地 MMD 资源并生成版本化清单

**Files:**
- Create: `scripts/models/install-local-mmd-assets.js`
- Modify: `package.json`（新增 `prepare:mmd-model` 和直接依赖 `yauzl@2.10.0`）
- Create: `res/models/mmd/README.md`
- Create locally, do not commit: `res/models/mmd/miya/**`、`res/models/mmd/motions/**`、`res/models/mmd/manifest.json`
- Test: `tests/mmd-resource-install.test.js`

**Interfaces:**
- Produces `res/models/mmd/manifest.json` with `{ schemaVersion, resources: [{ resourceId, modelType, modelPath, motionResourceId, motionPath, playMode, version, files }] }`.
- CLI accepts `--model-zip <path>` and `--motion-zip <path>`; default paths are `D:\down\a6fc97ed31db587c30d49d49d53939c7.zip` and `D:\down\半成品_by_爱打游戏的柠檬茶_7979ff2612c650d9094502210c9781bf.zip`.
- CLI exports `installMmdAssets(options)` for tests without executing on import.

- [ ] **Step 1: Write the failing resource contract tests**

  Add tests that create temporary ZIP files containing one PMX entry, `tex/` and `toon/` entries, one VMD entry, and a note file. Assert that `installMmdAssets({ modelZip, motionZip, outputRoot })` returns a manifest with `modelType: 'pmx'`, fixed ASCII paths `miya/miya.pmx` and `motions/miya-default.vmd`, `motionResourceId: 'miya-default-motion'`, SHA-256 entries, and `playMode: 'once'`. Add rejection cases for missing PMX, missing VMD, a path traversal entry, a non-regular entry, and invalid PMX/VMD headers.

- [ ] **Step 2: Run the focused tests to verify they fail**

  Run: `node --test tests/mmd-resource-install.test.js`

  Expected: FAIL because `scripts/models/install-local-mmd-assets.js` and the installer export do not exist.

- [ ] **Step 3: Implement ZIP validation and atomic local extraction**

  Implement `installMmdAssets` with `node:fs/promises`, `node:path`, `node:crypto` and the direct `yauzl` ZIP dependency. Validate every entry before writing, reject absolute paths and `..`, require the PMX header `PMX ` plus version `2.0`, require the VMD header `Vocaloid Motion Data 0002`, copy model textures under `miya/tex` and `miya/toon`, rename only the top-level PMX/VMD filenames, calculate SHA-256 after extraction, write the manifest to a staging directory, and atomically replace only the task-owned `res/models/mmd/miya` and `res/models/mmd/motions` directories. Do not remove unrelated model directories.

- [ ] **Step 4: Add the npm command and resource documentation**

  Add `"prepare:mmd-model": "node scripts/models/install-local-mmd-assets.js"` to `package.json`. Document the local command, generated URLs, external upload directory shape, and the rule that generated binary files are not committed in `res/models/mmd/README.md`.

- [ ] **Step 5: Run the installer tests and a real local extraction**

  Run: `node --test tests/mmd-resource-install.test.js`

  Then run: `npm run prepare:mmd-model`

  Expected: tests PASS; generated files include `res/models/mmd/miya/miya.pmx`, its `tex/` and `toon/` files, `res/models/mmd/motions/miya-default.vmd`, and `res/models/mmd/manifest.json`. Do not add generated binaries to Git.

### Task 2: Add server-side fixed MMD resource profile

**Files:**
- Create: `src/apps/server/modules/mmd/mmd-resource-service.js`
- Modify: `src/apps/server/boot/server-app.js`
- Test: `src/apps/server/modules/mmd/mmd-resource-service.test.js`
- Modify: `tests/display-chat-mmd.test.js`

**Interfaces:**
- `loadMmdResourceManifest({ modelRoot }) -> Promise<MmdManifest>`.
- `resolveMmdResource(resourceId, { manifest }) -> MmdLocalResource`.
- `createMmdResourceProfile(resource, { basePath = '/models' }) -> MmdModelProfile`.
- `MmdModelProfile` includes `resourceId`, `modelType`, `modelUrl`, `motionResourceId`, `motionUrl`, `playMode` and `version`.
- `GET /api/mmd/resources` returns `{ status: 'success', resources: [...] }` and never echoes an arbitrary request URL.

- [ ] **Step 1: Write failing service and route contract tests**

  Assert that the manifest loader accepts only the generated schema, that the default resource maps to `/models/mmd/miya/miya.pmx` and `/models/mmd/motions/miya-default.vmd`, that an unknown resource ID returns a 404/structured error, and that a profile never contains a URL outside the same-origin `/models` prefix. Add a server source contract asserting the new route is registered without changing `/api/vrm/model/static`.

- [ ] **Step 2: Run the focused service tests to verify they fail**

  Run: `node --test src/apps/server/modules/mmd/mmd-resource-service.test.js tests/display-chat-mmd.test.js`

  Expected: FAIL because the MMD service and route are absent.

- [ ] **Step 3: Implement manifest validation and profile generation**

  Load only `res/models/mmd/manifest.json`; validate `schemaVersion`, resource IDs, relative file paths, `modelType === 'pmx'`, `playMode === 'once'`, and declared regular files under the MMD model root. Resolve the default resource without accepting query-supplied file paths. Return model and motion paths as same-origin `/models/...` URLs with encoded segments.

- [ ] **Step 4: Register `GET /api/mmd/resources`**

  Add a read-only route near the existing VRM resource routes. On success return the validated profiles; on missing or invalid manifest return a structured 503 response. Keep existing VRM routes and APK behavior unchanged.

- [ ] **Step 5: Run service and display contract tests**

  Run: `node --test src/apps/server/modules/mmd/mmd-resource-service.test.js tests/display-chat-mmd.test.js`

  Expected: PASS, including existing VRM route assertions.

### Task 3: Vendor the Three.js MMD loader dependencies

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/vendor/three/loaders/MMDLoader.js`
- Create: `src/apps/web-mediacenter/ui/public/js/vendor/three/loaders/TGALoader.js`
- Create: `src/apps/web-mediacenter/ui/public/js/vendor/three/animation/CCDIKSolver.js`
- Create: `src/apps/web-mediacenter/ui/public/js/vendor/three/animation/MMDAnimationHelper.js`
- Create: `src/apps/web-mediacenter/ui/public/js/vendor/three/animation/MMDPhysics.js`
- Create: `src/apps/web-mediacenter/ui/public/js/vendor/three/libs/mmdparser.module.js`
- Create: `src/apps/web-mediacenter/ui/public/js/vendor/three/shaders/MMDToonShader.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Test: `tests/display-mmd-runtime.test.js`

**Interfaces:**
- Import map continues to map `three/addons/` to `./js/vendor/three/`.
- `MMDLoader.js` imports only the vendored sibling dependencies and `three`.
- No CDN or runtime network dependency is introduced.

- [ ] **Step 1: Write failing vendor/import-map tests**

  Assert that all seven files exist, each referenced relative import resolves to a file under the vendor tree, `display.html` retains the existing import map, and no MMD loader file references a CDN URL.

- [ ] **Step 2: Run the focused vendor tests to verify they fail**

  Run: `node --test tests/display-mmd-runtime.test.js`

  Expected: FAIL because the MMD vendor modules do not exist.

- [ ] **Step 3: Copy the pinned Three.js 0.160.0 example modules**

  Copy the exact modules from `node_modules/three/examples/jsm/` into the listed vendor paths, preserving relative import paths and the project’s existing vendored-runtime policy. Do not change the Three.js package version or use the viewer page’s CDN import map.

- [ ] **Step 4: Run import graph and syntax contract tests**

  Run: `node --test tests/display-mmd-runtime.test.js`

  Expected: PASS and all relative imports resolve.

### Task 4: Implement the PMX/VMD browser runtime and preserve VRM fallback

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/display-mmd.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/display-mmd-command-adapter.js`
- Test: `tests/display-mmd-runtime.test.js`

**Interfaces:**
- `createDisplayPmxRuntime({ canvas, onStatus }) -> { load, loadMotion, playMotion, handleActionPlan, raycast, resize, setVisible, dispose }`.
- `load(profile) -> Promise<boolean>` loads `profile.modelUrl`, then loads `profile.motionUrl` if present.
- `playMotion(resourceId) -> Promise<boolean>` accepts only the resource ID already resolved in the profile.
- `dispose() -> void` stops animation frames and releases the active PMX scene and helper.

- [ ] **Step 1: Extend contract tests for runtime selection and action routing**

  Assert that the default profile has `modelType: 'pmx'`, `resourceId`, `motionResourceId`, a PMX URL, a VMD URL and `playMode: 'once'`; VRM profiles still select `display-vrm-runtime.js`; PMX profiles select `display-pmx-runtime.js`; `MOTION_ADD` uses a registered motion resource ID; arbitrary motion URLs are rejected; `dispose` is called when the profile type changes.

- [ ] **Step 2: Run the runtime contract tests to verify they fail**

  Run: `node --test tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js`

  Expected: FAIL because the PMX runtime and model-type dispatch do not exist.

- [ ] **Step 3: Implement PMX loading and normalization**

  In `display-pmx-runtime.js`, create a transparent `THREE.WebGLRenderer`, scene, camera, lighting, `MMDLoader`, `MMDAnimationHelper`, and `THREE.Raycaster`. Load the PMX URL with `MMDLoader.load`; use the PMX URL directory as the texture base; compute the model bounding box; normalize height to the existing stage target; center the model; add it to the scene; and start a `requestAnimationFrame` loop only when visible. Keep animation updates and rendering in one loop.

- [ ] **Step 4: Implement one-shot VMD playback and failure cleanup**

  Load the VMD with `MMDLoader.loadAnimation(profile.motionUrl, mesh)`, add it to `MMDAnimationHelper` with `loop: false`, and stop/remove the action when the animation duration is reached. On any model, texture or motion error, dispose partial resources, set the status message, and return control to the existing Canvas placeholder without interrupting chat/media.

- [ ] **Step 5: Implement profile dispatch in `display-mmd.js`**

  Replace the single `ensureRuntime` path with a model-type-aware runtime factory. Default to the server’s PMX profile, preserve the existing VRM profile resolution and `display-vrm-runtime.js`, dispose the old runtime before switching type, and pass only the validated profile returned by `/api/mmd/resources` or a matching WebSocket profile.

- [ ] **Step 6: Route `MOTION_ADD` through the resource whitelist**

  Extend the command adapter so `MOTION_ADD` requires `resourceId`, rejects URL/path fields, and calls the active runtime’s `playMotion(resourceId)`. Keep `MOTION_DELETE`, face binding, bone binding and unknown-command behavior unchanged. Do not allow the action plan to replace `motionUrl` directly.

- [ ] **Step 7: Run runtime contract tests**

  Run: `node --test tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js`

  Expected: PASS with VRM compatibility assertions and PMX/VMD route assertions.

### Task 5: Local browser verification and project documentation

**Files:**
- Modify: `docs/design/mmd-pmx-vmd-local.md`
- Modify: `docs/spec/mmd-pmx-vmd-local.md`
- Modify: `docs/task/20260922_本地PMX模型与VMD动作接入.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Test: `tests/display-chat-mmd.test.js`

**Interfaces:**
- Local verification URL: `https://127.0.0.1:8081/display` when `res/certs/key.pem` and `res/certs/cert.pem` exist; otherwise `http://127.0.0.1:8081/display`.
- Local model profile URL: `/api/mmd/resources`; model files under `/models/mmd/`.

- [ ] **Step 1: Add final contract assertions**

  Assert that the display module requests `/api/mmd/resources`, uses same-origin PMX/VMD paths, keeps the existing layer z-index and visibility controls, and does not add an APK asset or external upload step.

- [ ] **Step 2: Run all focused automated tests**

  Run: `node --test tests/mmd-resource-install.test.js src/apps/server/modules/mmd/mmd-resource-service.test.js tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js`

  Expected: all focused tests PASS.

- [ ] **Step 3: Start the local server and verify resource responses**

  Run: `npm start`

  Verify with the local server origin: `GET /api/mmd/resources`, the PMX URL, one `tex/` URL, one `toon/` URL, and the VMD URL. Expected: JSON profile succeeds and each declared file returns HTTP 200 with the expected non-empty body.

- [ ] **Step 4: Verify the browser display**

  Open `/display`, enable the role layer, and confirm the PMX model is visible, the VMD plays once, the first empty frames do not fail loading, and chat/media continue working. Hide and show the MMD layer, refresh the page, and confirm rendering resumes without duplicate animation loops.

- [ ] **Step 5: Update completion docs and remove the completed todo item**

  Record the actual local resource layout, test results, and explicit non-scope for APK/external publishing in the design/spec/task docs and `changelog.md`. Remove only the completed local PMX/VMD item from `docs/todo.md`; keep any separate external publishing work as a pending item.

- [ ] **Step 6: Run final verification before claiming completion**

  Run: `git diff --check`, `node --check src/apps/web-mediacenter/ui/public/js/display-mmd.js`, `node --check src/apps/web-mediacenter/ui/public/js/display-mmd-command-adapter.js`, and the focused test command from Step 2. Confirm `git status --short` shows generated model binaries as untracked/ignored as intended and no unrelated user files were staged.
