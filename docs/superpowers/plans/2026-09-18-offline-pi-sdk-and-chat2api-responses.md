# Offline Pi SDK 与 Chat2API Responses 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Offline APK 的 Pi Agent 能在 Android Runtime 中找到 Provider manifest，并用回归测试锁定 Chat2API Responses 首轮、续聊、流式和错误透传行为。

**Architecture:** 构建器只对 `node_modules/**/.manifest.json` 建立显式安全 marker 映射，Android 安装器在 Runtime 目录切换成功后恢复原文件名；Pi 运行时继续使用原始 import 路径。Responses 保持现有 service/proxy/client 分层，用 fake core adapter 和 HTTP proxy 回归验证，不新增平行配置接口或模型映射。

**Tech Stack:** Node.js `node:test`、现有 Runtime asset builder、Kotlin Android JVM tests、Chat2API Responses service/proxy/client、SM-N9500 Offline APK smoke test。

**Spec:** `docs/design/android-offline-pi-sdk-and-chat2api-responses.md`、`docs/spec/android-offline-pi-sdk-and-chat2api-responses.md`

## Global Constraints

- 使用 `const/let`、`async/await` 和 `try-catch`，新增注释使用中文。
- 不覆盖或清理工作区内与本任务无关的现有修改。
- Android assets 不直接依赖隐藏文件；marker 必须恢复为 Node/Pi SDK 原始路径。
- Responses 只修复测试实际暴露的协议缺陷；Qwen3.6-Flash 映射和遮挡逻辑不改。
- 完成后同步 `todo.md`、design、spec、task 和 `changelog.md`。

### Task 1: Pi SDK manifest 资产打包与 Android 恢复

**Files:**
- Modify: `scripts/ops/prepare-android-node-runtime.js` (`isAndroidAssetExcluded`、`copyDirectoryWithManifest`、导出常量/辅助函数)
- Test: `tests/android-node-runtime-package.test.js`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt`（marker 恢复、Pi manifest 健康检查、安装调用）
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/NodeRuntimeManifestTest.kt`

**Interfaces:**
- Produces `ANDROID_HIDDEN_MANIFEST_MARKER = "aasc-bundled-manifest.json"` 和确定性的 `mapPackagedAssetPath` 行为。
- Produces `NodeRuntimeInstaller.materializeBundledPackageManifests(root: File)` 的可测试恢复逻辑。

- [x] **Step 1: Write the failing Node packaging test**

  在现有 Runtime packaging test 中建立临时 package，写入 `node_modules/pi-ai/dist/providers/data/.manifest.json`，调用 `prepareAndroidNodeRuntime`，断言 manifest 的文件路径是 `server/node_modules/pi-ai/dist/providers/data/aasc-bundled-manifest.json`，且输出目录不存在 `.manifest.json`。

- [x] **Step 2: Run the packaging test to verify it fails**

  Run: `node --test tests/android-node-runtime-package.test.js`

  Expected: FAIL because current hidden-file filtering excludes the source manifest.

- [x] **Step 3: Implement safe marker mapping**

  让 `isAndroidAssetExcluded` 只对 `node_modules` 下精确 basename `.manifest.json` 放行；在 `copyDirectoryWithManifest` 通过 `mapPackagedAssetPath` 将它改名为 `aasc-bundled-manifest.json`；保持模型 `.manifest.json` 的既有 `bundled-manifest.json` 逻辑不变。

- [x] **Step 4: Add failing Kotlin restoration and reuse tests**

  增加临时目录测试：marker 内容复制到同目录 `.manifest.json` 后 marker 删除；增加含 Pi 目录但缺 manifest 时 `canReuseInstalledRuntime` 返回 false、无 Pi 目录时保持 true 的断言。

- [x] **Step 5: Run Android tests to verify the new tests fail before implementation is complete**

  Run: `./gradlew :app:testDebugUnitTest --tests com.aasc.display.NodeRuntimeManifestTest` in `src/apps/android-display`.

  Expected: new restoration symbol and health check are missing, so compilation/test fails.

- [x] **Step 6: Implement installer restoration and health check**

  在 `NodeRuntimeInstaller` 增加 marker 常量和递归 `materializeBundledPackageManifests`；在 `installCodeFiles` 中先恢复 package marker；将 Pi manifest 条件并入 `canReuseInstalledRuntime`，并保留没有 Pi 目录的旧包兼容路径。

- [x] **Step 7: Run focused tests**

  Run: `node --test tests/android-node-runtime-package.test.js` and `./gradlew :app:testDebugUnitTest --tests com.aasc.display.NodeRuntimeManifestTest`.

  Expected: all focused Node and Android Runtime tests PASS.

### Task 2: Chat2API Responses 回归与真实链路验证

**Files:**
- Test: `src/apps/server/modules/chat2api/chat2api-responses-service.test.js`
- Test: `src/apps/server/modules/chat2api/chat2api-proxy-service.test.js`
- Test: `src/external/llm/llm-responses-client.test.js`
- Modify only if a regression test exposes a defect: corresponding Responses service/proxy/client source file

**Interfaces:**
- Consumes the existing `createChat2ApiResponsesService`, proxy `/v1/responses`, and `createResponsesClient` interfaces.
- Produces a stable test contract for non-stream, continuation, SSE ordering and upstream errors.

- [x] **Step 1: Write failing/coverage tests for continuation and errors**

  Add a proxy test with a fake Responses service/core adapter that returns a completed first response, accepts `previous_response_id`, and throws `{ statusCode: 503, code: "no_available_account" }`; assert the HTTP JSON fields and status are preserved.

- [x] **Step 2: Run focused Responses tests**

  Run: `node --test src/apps/server/modules/chat2api/chat2api-responses-service.test.js src/apps/server/modules/chat2api/chat2api-proxy-service.test.js src/external/llm/llm-responses-client.test.js`

  Expected: any missing status/error/SSE contract fails with the exact assertion, otherwise existing implementation passes without source changes.

- [x] **Step 3: Make the smallest source fix only if the focused test fails**

  Preserve `statusCode`, `code`, and `message` in the proxy error response; preserve event order and `previous_response_id` session state. Do not add model mapping or change Qwen provider selection.

- [x] **Step 4: Run the full Chat2API check**

  Run: `npm run check:chat2api`

  Expected: Chat2API service, gateway, provider, UI and proxy tests pass.

- [x] **Step 5: Repeat the real device smoke test**

  Through the existing localhost port forward, send one non-stream Qwen3.6 Responses request and one `previous_response_id` continuation; record only status/id/output text, never credentials. Confirm Qwen3.6-Flash remains the expected `503/no_available_account` boundary when mappings are empty.

### Task 3: Documentation, verification and release readiness

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/design/android-offline-pi-sdk-and-chat2api-responses.md`
- Modify: `docs/spec/android-offline-pi-sdk-and-chat2api-responses.md`
- Modify: `docs/task/20260918_OfflinePiSDK接入与Chat2APIResponses协议验证.md`
- Modify: `changelog.md`

- [x] **Step 1: Run packaging/build verification**

  Run: `npm run prepare:android-node` with the existing Android Runtime/package environment, then `npm run build:apk:offline:min` only if the focused assets are available and the user requests a new APK.

- [x] **Step 2: Run combined verification**

  Run: `npm run check:chat2api`, `node --test tests/android-node-runtime-package.test.js tests/android-offline-apk.test.js`, and Android `:app:testDebugUnitTest`.

- [x] **Step 3: Record results and close todo**

  Record exact test counts and any real-device boundary in the task/changelog; remove the completed implementation item from `docs/todo.md`, leaving only real login or release items still pending.

- [x] **Step 4: Check the diff**

  Run: `git diff --check` and inspect only files touched by this task; do not reset unrelated dirty files.
