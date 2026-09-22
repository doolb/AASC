# Offline MMD Static Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已安装的 Offline APK 通过服务代码更新，以静态 VRM 相同的固定上游代理规则加载米娅 PMX、纹理和 VMD，而不向 APK、Runtime 或 Git 写入模型二进制。

**Architecture:** `mmd-resource-service` 增加固定的 `miya-v1` release 元数据、缺失本地清单时的 profile 回退，以及有大小/hash 校验的上游文件读取。`server-app` 以路径型 `/api/mmd/static/mmd/...` 代理固定 14 个资源，从而让 PMX 的相对纹理路径继续命中同源代理；显示端只扩展既有同源 URL 校验前缀，不改变加载、灯光、阴影或拖动旋转逻辑。

**Tech Stack:** Node.js、Express、Node 内置 `fetch`/`dns`/`crypto`/stream、原生浏览器 JavaScript、node:test。

**Spec:** `docs/superpowers/specs/2026-09-22-offline-mmd-static-proxy-design.md`, `docs/design/mmd-pmx-vmd-local.md`, `docs/spec/mmd-pmx-vmd-local.md`

## Global Constraints

- 固定上游只能是 `http://c.aasc.us/mnt/mmd/miya-v1/` 经 IPv4 解析后的地址；HTTP 请求、动作计划、控制端和显示端均不能配置 host、版本或文件路径。
- release 白名单恰为 14 个模型文件：1 个 PMX、12 张 PNG、1 个 VMD；必须固定每个相对路径、字节大小和 SHA-256。
- 本地 `res/models/mmd/manifest.json` 有效时优先本地 `/models/mmd/...`；仅 `ENOENT` 回退静态 profile，格式/大小/hash 错误必须保持 503。
- 上游响应必须完整缓冲并验证 HTTP 200、Content-Length 和 SHA-256 后再输出；禁止重定向、持久缓存和部分响应。
- 不修改 `release/apkbuild/*/app.json`、Android Kotlin/Gradle、`scripts/ops/prepare-android-node-runtime.js` 或模型文件；不得运行任何 `build:apk*`、`build:offline-update` 或发布命令。
- 保留用户工作区中未提交的空白区域拖动旋转改动；只在 URL 校验函数附近做最小合并，不能覆盖其 Pointer Event 和 runtime 旋转实现。
- 不自动暂存或提交，直到用户明确要求提交。

## Review Focus

- PMX 纹理相对 URL：`/api/mmd/static/mmd/miya/miya.pmx` 必须把 `tex/1.png` 解析到同一代理前缀；测试放在 Task 3。
- 本地损坏清单：仅缺失可回退，存在但无效必须 503；测试放在 Task 2。
- 代理逃逸：`..`、反斜杠、双斜杠、query、重复编码与未声明文件必须都被拒绝；测试放在 Task 1 和 Task 2。
- 上游不可信数据：状态码、Content-Length、真实字节数和 SHA-256 任一不符时，绝不回传部分资源；测试放在 Task 1。
- 模型体积边界：APK Runtime 与模型 assets 不得新增 `mmd`、PMX、VMD、PNG 路径；在 Task 4 对现有打包逻辑做非构建验证。

### Task 1: 固定静态 release 与受限上游读取

**Files:**

- Modify: `src/apps/server/modules/mmd/mmd-resource-service.js`
- Modify: `src/apps/server/modules/mmd/mmd-resource-service.test.js`

**Interfaces:**

- Produces `STATIC_MMD_RELEASE` with `host`, `publicPath`, resource identity, PMX/VMD paths, version and 14 immutable file records.
- Produces `createStaticMmdResourceProfile() -> { resourceId, modelType, modelUrl, motionResourceId, motionUrl, playMode, version }`.
- Produces `resolveStaticMmdAsset(relativePath) -> { path, size, sha256, contentType }`.
- Produces `requestStaticMmdAsset({ relativePath, lookup, request }) -> Promise<{ content, contentType, sourceUrl }>`; dependency injection is test-only and the HTTP route never accepts these parameters.

- [ ] **Step 1: Write the failing static-release service tests**

  Add tests that import `STATIC_MMD_RELEASE`, `createStaticMmdResourceProfile`, `resolveStaticMmdAsset`, `resolveStaticMmdAssetUrl` and `requestStaticMmdAsset`. Assert the profile uses exactly:

  ```js
  {
    modelUrl: '/api/mmd/static/mmd/miya/miya.pmx',
    motionUrl: '/api/mmd/static/mmd/motions/miya-default.vmd',
    resourceId: 'miya-default',
    motionResourceId: 'miya-default-motion',
    playMode: 'loop',
  }
  ```

  Use a `PassThrough` response and injected IPv4 lookup/request to assert the PMX target is `http://120.79.245.103/mnt/mmd/miya-v1/mmd/miya/miya.pmx`. Add rejection cases for `''`, `../`, `%2e%2e`, `mmd\\miya`, `mmd//miya`, query text, an undeclared toon file, HTTP 404, missing/incorrect `Content-Length`, oversized body and mismatched digest.

- [ ] **Step 2: Run the service tests and verify the expected RED state**

  Run:

  ```powershell
  node --test src/apps/server/modules/mmd/mmd-resource-service.test.js
  ```

  Expected: FAIL because the static release exports and static request functions do not exist.

- [ ] **Step 3: Define the immutable Miya release metadata**

  Add this exact source-level definition (metadata only; no model bytes):

  ```js
  const STATIC_MMD_RELEASE = Object.freeze({
    host: 'c.aasc.us',
    publicPath: '/mnt/mmd/miya-v1/',
    resourceId: 'miya-default',
    motionResourceId: 'miya-default-motion',
    modelPath: 'mmd/miya/miya.pmx',
    motionPath: 'mmd/motions/miya-default.vmd',
    playMode: 'loop',
    version: 'ca07d84b494577f5dab90d71465bc08e01ec036fe66278a2393313b6febf56c6',
    files: Object.freeze([
      ['mmd/miya/miya.pmx', 4908850, 'ef8f5c366b5a9761ded99215426d824b822c8035055e45397521e0fa0c80bf8d'],
      ['mmd/miya/tex/1.png', 522908, 'd8a676dd5f76dd40925f926e051ce94563674bb9a37afa00609094567e5e264b'],
      ['mmd/miya/tex/1q.png', 667270, 'ec912073f6d75a454e7e2263d9820e9880bd39db8327f1443dd57804feb72da8'],
      ['mmd/miya/tex/2.png', 1038189, '9d57fc713e0fe0ef99a3713048f92e406732e10a9c702b86fed371080e834ade'],
      ['mmd/miya/tex/2q.png', 948170, '677266bcb970b42ceac6a1633f57a670855d0211436d8269b15a65d46defbf8e'],
      ['mmd/miya/tex/3.1.png', 24313, '4b60220cec5b0d958b0b77d936ff82f9317cf475c59abf5413378d8c91c6e03e'],
      ['mmd/miya/tex/3.png', 354468, '3b8ad670a287ea888187c537a07abec48632f5da612faea9de9bc67f3080d060'],
      ['mmd/miya/tex/4.png', 302085, '9daaa9eac3569dddd881a9edec903e2b5e836b37ab5a9937c3347bba0ca3f633'],
      ['mmd/miya/tex/5.png', 1163640, '4bba5edecf5bbf6711d14a985be069908bcafa5e64a395a6452a70ce17acd83c'],
      ['mmd/miya/tex/5q.png', 1011518, 'b8f5029b7f5d17ce59d2c07bd61f6eb4f81355e70481518fffb2473dd308f694'],
      ['mmd/miya/tex/7.png', 870412, 'd88014e12cce67de05263d625cec0683a15b48966025dc397f505b319203a529'],
      ['mmd/miya/tex/8.1.png', 1212408, '1cc067cb7fbb49a3f728e85cb8876b6199563f3de1a2578a0a9250a0e5c67e69'],
      ['mmd/miya/tex/8.2.png', 271304, 'a9ef6f408c71d4681b68c944eba194d9980e963b1092b2149208da4bcd44d0e5'],
      ['mmd/motions/miya-default.vmd', 134051, '3f83325c7a4a0606e6d72c43ff7752a685c6617214d4df66d6e08af3dd367cad'],
    ]),
  });
  ```

  Convert the tuples into an internal `Map` without exposing a mutable collection. Assign MIME `image/png` to PNG, `application/octet-stream` to PMX/VMD. Reuse the existing relative-POSIX validation, but require the exact declared path and reject URL syntax before any DNS lookup.

- [ ] **Step 4: Implement IPv4-only fetch and complete-payload verification**

  Add a private `requestFetch` adapter that applies `AbortSignal.timeout`, reads a Node stream or `Readable.fromWeb` stream, and disables redirect following. `resolveStaticMmdAssetUrl` must require `http:`, exact host `c.aasc.us`, exact public root and a successful IPv4 lookup before replacing only the hostname with that IPv4 address. `requestStaticMmdAsset` must require upstream HTTP 200 and exact `Content-Length`, bound reading to the declared byte count, calculate `crypto.createHash('sha256')`, then return a buffer only when the digest equals the declared one.

- [ ] **Step 5: Run the focused service tests and verify GREEN**

  Run:

  ```powershell
  node --test src/apps/server/modules/mmd/mmd-resource-service.test.js
  ```

  Expected: PASS. Confirm the test uses mocked upstream streams and never performs a real WAN request.

### Task 2: 本地优先 profile 与 Express 同源路径代理

**Files:**

- Modify: `src/apps/server/modules/mmd/mmd-resource-service.js`
- Modify: `src/apps/server/modules/mmd/mmd-resource-service.test.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `tests/display-chat-mmd.test.js`

**Interfaces:**

- Produces `loadPreferredMmdResources({ modelRoot }) -> Promise<MmdResource[]>`.
- A missing `mmd/manifest.json` returns `[createStaticMmdResourceProfile()]`; an existing invalid manifest rejects with status 503.
- Produces `GET /api/mmd/static/*` with no accepted query parameters and exact static file responses.

- [ ] **Step 1: Write failing local-precedence and route-contract tests**

  Extend the MMD service fixture tests to assert: a valid fixture returns local `/models/mmd/...`; after deleting only `mmd/manifest.json`, `loadPreferredMmdResources` returns the static PMX/VMD profile; a malformed manifest and a manifest with a bad declared hash both reject rather than return static data. Extend `tests/display-chat-mmd.test.js` to assert `server-app.js` imports the static request helper and registers `/api/mmd/static/` without changing `/api/vrm/model/static`.

- [ ] **Step 2: Run the tests and verify RED**

  Run:

  ```powershell
  node --test src/apps/server/modules/mmd/mmd-resource-service.test.js tests/display-chat-mmd.test.js
  ```

  Expected: FAIL because the preferred-resource resolver and static route are absent.

- [ ] **Step 3: Preserve missing-manifest provenance and implement preferred resources**

  In `loadMmdResourceManifest`, preserve the original `ENOENT` as a dedicated `MMD_MANIFEST_MISSING` code. Do not label JSON parse errors, missing declared files or digest mismatches as missing. Implement `loadPreferredMmdResources` as:

  ```js
  async function loadPreferredMmdResources({ modelRoot }) {
    try {
      const manifest = await loadMmdResourceManifest({ modelRoot });
      return manifest.resources.map((resource) => createMmdResourceProfile(resource));
    } catch (error) {
      if (error.code === 'MMD_MANIFEST_MISSING') return [createStaticMmdResourceProfile()];
      throw error;
    }
  }
  ```

  Keep `loadMmdResourceManifest` and `createMmdResourceProfile` compatible with existing local tests and desktop behavior.

- [ ] **Step 4: Register the path proxy and use the preferred resolver**

  Replace the inline `/api/mmd/resources` manifest mapping in `server-app.js` with `loadPreferredMmdResources({ modelRoot: path.join(PROJECT_ROOT, 'res', 'models') })`. Register the static route before it is needed by browser requests:

  ```js
  app.get(/^\/api\/mmd\/static\/(.+)$/u, async (req, res) => {
    if (Object.keys(req.query || {}).length > 0) {
      res.status(400).json({ status: 'error', message: 'MMD 静态资源不接受查询参数' });
      return;
    }
    try {
      const asset = await requestStaticMmdAsset({ relativePath: req.params[0] });
      res.status(200);
      res.setHeader('Content-Type', asset.contentType);
      res.setHeader('Content-Length', String(asset.content.length));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-AASC-MMD-Source', 'static-miya-v1-ip-resolved');
      res.end(asset.content);
    } catch (error) {
      res.status(error.statusCode || 502).json({ status: 'error', message: error.message });
    }
  });
  ```

  Use the route capture only as input to the service allowlist; never concatenate it into a public URL in `server-app.js`.

- [ ] **Step 5: Run server contracts and syntax checks**

  Run:

  ```powershell
  node --test src/apps/server/modules/mmd/mmd-resource-service.test.js tests/display-chat-mmd.test.js
  node --check src/apps/server/modules/mmd/mmd-resource-service.js
  node --check src/apps/server/boot/server-app.js
  ```

  Expected: PASS. Existing static VRM route tests remain present and the MMD static path is source-constrained.

### Task 3: 允许显示端识别同源静态 MMD 前缀

**Files:**

- Modify: `src/apps/web-mediacenter/ui/public/js/display-mmd.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js`
- Modify: `tests/display-mmd-runtime.test.js`
- Modify: `tests/display-chat-mmd.test.js`

**Interfaces:**

- Browser PMX/VMD profile validation accepts exactly `/models/mmd/...` and `/api/mmd/static/mmd/...`.
- External URLs, protocol-relative URLs, query/hash data, traversal text and other `/api` paths remain invalid.

- [ ] **Step 1: Write failing browser path-contract tests**

  Add assertions that both display modules declare the static prefix and accept `/api/mmd/static/mmd/miya/miya.pmx` plus `/api/mmd/static/mmd/motions/miya-default.vmd`. Assert source-level rejection still covers `https://`, `//`, `..`, `?` and `#`, and assert no external `miya-v1` HTTP URL appears in browser JavaScript.

- [ ] **Step 2: Run the browser tests and verify RED**

  Run:

  ```powershell
  node --test tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js
  ```

  Expected: FAIL because both validators currently require only `/models/mmd/`.

- [ ] **Step 3: Replace the single local-prefix check with a frozen two-prefix allowlist**

  In both modules, define:

  ```js
  const MMD_MODEL_PREFIXES = Object.freeze([
    '/models/mmd/',
    '/api/mmd/static/mmd/',
  ]);

  function isSameOriginMmdAsset(url, extension) {
    if (typeof url !== 'string' || url.includes('://') || url.startsWith('//')
      || url.includes('..') || /[?#\\]/u.test(url)) return false;
    return MMD_MODEL_PREFIXES.some((prefix) => url.startsWith(prefix))
      && url.toLowerCase().endsWith(extension);
  }
  ```

  Make `display-mmd.js` use the equivalent helper when resolving the profile. Do not alter its current staged model load, lighting, shadow, Pointer Event or rotation code.

- [ ] **Step 4: Run the browser contracts and JavaScript checks**

  Run:

  ```powershell
  node --test tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js
  node --check src/apps/web-mediacenter/ui/public/js/display-mmd.js
  node --check src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js
  ```

  Expected: PASS. The existing local PMX path and the user’s uncommitted empty-area rotation contract remain covered.

### Task 4: 验证 APK 边界、完成文档与回归

**Files:**

- Modify: `docs/design/mmd-pmx-vmd-local.md`
- Modify: `docs/spec/mmd-pmx-vmd-local.md`
- Modify: `docs/task/20260922_OfflineAPK外网MMD代理.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Verify only: `scripts/ops/prepare-android-node-runtime.js`, `release/apkbuild/allserver/app.json`, `release/apkbuild/allserver-min/app.json`

**Interfaces:**

- Documents record that code update is the only deliverable; no new APK or model asset exists.
- `runtime-manifest.json`/`modelAssets` remain free of `mmd/`, `.pmx`, `.vmd` and the model texture paths.

- [ ] **Step 1: Add a package-boundary regression assertion after proxy code is green**

  Extend the existing Android Runtime package fixture test with a local `res/models/mmd/miya/miya.pmx` and texture file that are not included in `profile.models`. Assert the produced `manifest.files` and `manifest.modelAssets` do not contain `mmd/`, `.pmx`, `.vmd` or the texture path. This is a post-GREEN regression guard because the current exclusion already exists.

- [ ] **Step 2: Run the package-boundary test without building an APK**

  Run:

  ```powershell
  node --test tests/android-node-runtime-package.test.js
  ```

  Expected: PASS; this operates only on temporary Node fixture directories and creates no APK.

- [ ] **Step 3: Update completion documentation**

  Record the implemented release identifier, local-precedence/missing-only fallback, path proxy, complete-body SHA-256 verification, tests and the explicit non-actions: no `build:apk:offline`, no `build:apk:offline:min`, no `build:offline-update`, no model asset, no publication. Remove only the completed Offline MMD proxy item from `docs/todo.md`; retain release, authorization and WAN fallback work as pending where applicable.

- [ ] **Step 4: Run focused and full verification**

  Run:

  ```powershell
  node --test src/apps/server/modules/mmd/mmd-resource-service.test.js tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js tests/android-node-runtime-package.test.js
  npm test
  git diff --check
  git status --short
  ```

  Expected: focused tests PASS and `git diff --check` has no errors. If `npm test` reports known Windows/certificate/Chromium or other baseline failures, record their exact names and counts; do not mask them or alter unrelated tests. Confirm no PMX/VMD/texture file was staged, copied into an APK directory or published.

- [ ] **Step 5: Do not package, publish, stage or commit**

  Stop after code and test verification. Do not run any APK, update-package or publication command, and do not stage concurrent user changes. Report the service-code files ready for a later explicit code-package release.

## Self-Review

- Spec coverage: Task 1 implements the fixed metadata, URL resolution, limits and digest checks; Task 2 implements local precedence and the same-origin server route; Task 3 implements browser acceptance of only the new prefix; Task 4 proves the APK boundary and documents the result.
- Placeholder scan: every task lists paths, concrete command lines, expected RED/GREEN outcomes and source-level interfaces; no deferred implementation marker remains.
- Type consistency: `createStaticMmdResourceProfile`, `loadPreferredMmdResources` and `requestStaticMmdAsset` are defined in Task 1/2 and consumed under those names by the Express route; both browser modules use `isSameOriginMmdAsset`.
- Review focus coverage: all five listed failure classes map to a named task and a test/verification step.
