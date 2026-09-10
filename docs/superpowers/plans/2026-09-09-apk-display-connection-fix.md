# APK Display Connection Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Android display APK reconnect to the HTTPS/WSS main server and start its embedded AASC Node subprocess reliably.

**Architecture:** Trust the build-time main-server certificate through Android Network Security Config so WebView page requests and same-origin WSS use one TLS trust chain. Run the Android arm64 Node binary from the APK native library directory, while keeping the server package and mutable runtime data in the private app directory.

**Tech Stack:** Kotlin Android app, Android Network Security Config, Node.js, WebSocket, Node test runner, Gradle.

**Spec:** `docs/spec/android-display.md`, `docs/spec/android-embedded-node-server.md`

## Global Constraints

- Preserve existing uncommitted user changes in the worktree.
- Support only the existing `arm64-v8a` Android APK target and `minSdk=26`.
- Do not call `SslErrorHandler.proceed()` for unknown or hostname-mismatched certificates.
- Use `const`/`let`, `async`/`await`, and `try/catch` in new JavaScript.
- Keep spec documents as pseudocode synchronized with the implementation.

### Task 1: Document the approved design

**Files:**
- Modify: `docs/design/android-display.md`
- Modify: `docs/spec/android-display.md`
- Modify: `docs/spec/android-embedded-node-server.md`
- Create: `docs/task/20260909_APK显示端主服务器连接修复.md`
- Modify: `docs/todo.md`

- [x] Record the TLS trust-anchor, SAN, native-library startup, reconnect, compatibility, risk, and acceptance requirements before implementation.

### Task 2: Add failing TLS and package contract tests

**Files:**
- Create: `tests/android-display-tls.test.js`
- Modify: `tests/android-node-runtime-package.test.js`
- Modify: `tests/display-websocket-reconnect.test.js` only if a missing error-path assertion is identified.

- [x] Assert the Android manifest references the network security config.
- [x] Assert the config references the bundled certificate and preserves system/user trust anchors.
- [x] Assert the APK certificate matches `res/certs/cert.pem` and contains the required SAN entries.
- [x] Run the targeted tests and confirm they fail against the current certificate/configuration.

### Task 3: Implement trusted HTTPS/WSS configuration

**Files:**
- Modify: `res/certs/cert.pem`
- Create: `src/apps/android-display/app/src/main/res/raw/aasc_server_cert.pem`
- Create: `src/apps/android-display/app/src/main/res/xml/network_security_config.xml`
- Modify: `src/apps/android-display/app/src/main/AndroidManifest.xml`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`

- [x] Add SANs to the existing-key development certificate.
- [x] Add the certificate as a scoped application trust anchor.
- [x] Cancel and log SSL errors instead of broadly proceeding.
- [x] Run TLS contract tests and Android unit tests.

### Task 4: Verify the native Node runtime fix

**Files:**
- Review/modify only when tests require it: `scripts/ops/prepare-android-node-runtime.js`, `src/apps/android-display/app/build.gradle.kts`, `src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt`, related tests.

- [x] Run Node package and Android Service tests.
- [x] Build the APK through the Gradle task used by `npm run build:apk` after supplying the runtime inputs.
- [x] Inspect the APK to confirm `lib/arm64-v8a/libaasc_node.so` is executable and the old asset Node binary is absent.

### Task 5: Install and perform device acceptance

**Files:**
- No source changes; use `npm run upload:apk` and `npm run start:apk:display`.

- [x] Install the rebuilt APK without clearing unrelated user data.
- [x] Verify Node launcher startup, `/server` registration, and no permission-denied error in logcat.
- [x] Restart the main server and verify the device display reconnects over WSS.
- [x] Run the relevant regression tests and `git diff --check`.

### Task 6: Close documentation and changelog

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/design/android-display.md`
- Modify: `docs/spec/android-display.md`
- Modify: `docs/spec/android-embedded-node-server.md`
- Modify: `changelog.md`

- [x] Remove the completed connection-repair task from `docs/todo.md`.
- [x] Record changed files and exact verification results in `changelog.md`.
- [x] Record the final device and server acceptance evidence in the task document.
