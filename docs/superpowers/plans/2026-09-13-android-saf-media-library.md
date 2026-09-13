# Android SAF Media Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android 10/API 29 and later expose one user-selected SAF directory to the embedded Node server as a media library whose virtual root is `/`, while preserving Android 9 direct-path access.

**Architecture:** `MainActivity` obtains and persists an `ACTION_OPEN_DOCUMENT_TREE` URI on API 29+. `NodeServerService` starts a loopback-only, token-protected `SafMediaServer` that performs all `ContentResolver`/`DocumentFile` operations. The Node process receives the loopback endpoint through environment variables and uses a new `AndroidSafProvider`; no `content://` URI is passed to Node `fs`, and no `MANAGE_EXTERNAL_STORAGE` permission is used.

**Tech Stack:** Kotlin, Android Storage Access Framework, `androidx.documentfile:documentfile`, Java `ServerSocket`, Node.js `http` streams, Node test runner, Android JVM unit tests, Gradle.

**Spec:** `docs/spec/android-display.md`, `docs/spec/android-embedded-node-server.md`, `docs/task/20260913_APK支持Android10及11以上共享存储访问.md`

## Global Constraints

- API 28 and below keep `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE`; API 29 and above use `ACTION_OPEN_DOCUMENT_TREE`.
- The selected tree is represented to Node as virtual `/`; never expand it to `/storage/emulated/0`, `~/`, or pass its `content://` URI to Node.
- The native gateway binds only to `127.0.0.1`, requires `Authorization: Bearer <random token>`, and rejects virtual path traversal.
- Directory listing is non-recursive; file reads and uploads are streamed and support HTTP Range.
- Existing `LocalProvider`, remote media-library WebSocket flow, `readonly` checks, and browser behavior remain compatible.
- Before every production-code change, the corresponding test must exist and have been observed failing.
- Use `npm run` scripts first; use the Android module Gradle wrapper for Android JVM tests and APK assembly.

---

### Task 1: Lock the Android SAF permission contract

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/SharedStorageAccess.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
- Modify: `src/apps/android-display/app/src/main/res/values/strings.xml`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/SharedStorageAccessTest.kt`

**Interfaces:**
- Produces `SharedStorageAccess.requiresTreeAccess(sdkInt: Int): Boolean`.
- Produces `SharedStorageAccess.requiredPermissions(sdkInt: Int): Array<String>` with API 28 as the legacy upper bound.
- Produces `SharedStorageAccess.createTreePickerIntent(): Intent` and persisted-tree helpers used by `MainActivity`.
- `MainActivity` launches `ACTION_OPEN_DOCUMENT_TREE` for API 29+ when no persisted tree URI is usable, persists read/write flags, then continues normal startup after either success or cancellation.

- [ ] **Step 1: Add failing JVM tests for the version boundary and picker intent.**

  Add assertions that API 28 returns both legacy permissions, API 29 and API 34 return no legacy permissions, API 29+ requires tree access, and the picker intent action is `Intent.ACTION_OPEN_DOCUMENT_TREE` with read/write persistable flags.

- [ ] **Step 2: Run the focused Android test and verify the expected failure.**

  Run:

  ```bash
  cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests com.aasc.display.SharedStorageAccessTest --no-daemon --console=plain
  ```

  Expected: the new API 29+ assertions fail because the current helper has no SAF contract.

- [ ] **Step 3: Implement the minimal permission and picker contract.**

  Keep the old permission helpers for API 23..28. Add persisted URI storage under the existing `aasc_display` preferences, use `ContentResolver.takePersistableUriPermission`, and change startup so API 29+ launches the picker only when there is no valid persisted tree. Add a Chinese cancellation/invalid-access message without blocking Node or WebView startup.

- [ ] **Step 4: Run the focused test and verify it passes.**

  Run the same Gradle command; expected result is `BUILD SUCCESSFUL` with all `SharedStorageAccessTest` cases passing.

### Task 2: Add the native SAF virtual-path and HTTP protocol layer

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/SafMediaPath.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/SafMediaServer.kt`
- Modify: `src/apps/android-display/app/build.gradle.kts`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/SafMediaPathTest.kt`

**Interfaces:**
- `SafMediaPath.normalize(rawPath: String): String` returns `/` or a slash-prefixed virtual path and rejects `..`, NUL, backslash, and empty file segments that could escape the selected tree.
- `SafMediaServer.start(): ConnectionInfo` returns a loopback URL and random token; `stop()` closes the socket and workers.
- The gateway routes are `GET /v1/status`, `GET /v1/list?path=...`, `HEAD/GET /v1/file?path=...`, `POST/DELETE /v1/file`, and `POST/DELETE /v1/folder`.
- Every route requires `Authorization: Bearer <random token>`; binary responses use streaming and `Range`/`Content-Range` when a valid range is requested. Invalid ranges fall back to a full `200` response, matching the existing media provider contract.

- [ ] **Step 1: Add failing pure path and range tests.**

  Test normalization of `/`, `/folder/file.mp4`, `../secret`, `/folder/../secret`, backslash paths, NUL paths, and double separators. Test valid `bytes=0-99`, suffix ranges, open-ended ranges, and invalid-range fallback behavior.

- [ ] **Step 2: Run the focused Android test and verify the expected failure.**

  Run:

  ```bash
  cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests com.aasc.display.SafMediaPathTest --no-daemon --console=plain
  ```

  Expected: compilation/test failure because the new path and protocol helpers do not exist.

- [ ] **Step 3: Implement the minimal native gateway.**

  Add the DocumentFile dependency. Implement a loopback `ServerSocket` with bounded HTTP header parsing and `Content-Length` upload limits. Resolve `/` to the persisted tree URI and each segment with `DocumentFile.findFile`; list only the current directory; use `ContentResolver.openInputStream`/`openOutputStream`; recursively delete only inside the selected tree; stream upload/read buffers without Base64; and return JSON errors for missing URI, revoked permission, missing file, invalid path, and unsupported method.

- [ ] **Step 4: Run Android JVM tests and verify the path/protocol contract passes.**

  Run the focused test and then `./gradlew :app:testDebugUnitTest --no-daemon --console=plain`. Expected result: `BUILD SUCCESSFUL`.

### Task 3: Connect the SAF server lifecycle to the embedded Node process

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt`
- Modify: `src/apps/android-display/app/src/test/java/com/aasc/display/NodeServerServiceTest.kt`
- Modify: `src/apps/android-display/app/src/main/AndroidManifest.xml` only if the gateway lifecycle needs no new exported component; do not add `MANAGE_EXTERNAL_STORAGE`.

**Interfaces:**
- `NodeServerService.buildNodeEnvironment(..., safBaseUrl: String? = null, safToken: String? = null)` adds `AASC_ANDROID_SAF_URL` and `AASC_ANDROID_SAF_TOKEN` only when both values are present.
- The service owns one `SafMediaServer`, starts it before launching Node, and stops it in `onDestroy`.
- When no valid persisted tree URI exists, the service omits the SAF endpoint/token; it does not prevent the existing Node service from starting.

- [ ] **Step 1: Add failing environment/lifecycle tests.**

  Extend `NodeServerServiceTest` to assert that the environment contains the exact SAF URL/token, preserves existing `HOME`, `LD_LIBRARY_PATH`, `AASC_ANDROID_NODE`, and offline fields, and that empty SAF values remain empty.

- [ ] **Step 2: Run the focused test and verify the expected failure.**

  Run:

  ```bash
  cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests com.aasc.display.NodeServerServiceTest --no-daemon --console=plain
  ```

  Expected: the new environment assertions fail because the service does not expose SAF values.

- [ ] **Step 3: Implement lifecycle and environment injection.**

  Start the gateway in `onCreate`, obtain its connection info for each Node launch, add the values to `ProcessBuilder.environment()`, and stop the gateway with the service. Keep restart behavior and existing Node process cleanup unchanged.

- [ ] **Step 4: Run the focused test and full Android JVM tests.**

  Run the same focused Gradle command followed by `./gradlew :app:testDebugUnitTest --no-daemon --console=plain`; expected result is `BUILD SUCCESSFUL`.

### Task 4: Implement the Node AndroidSafProvider contract

**Files:**
- Modify: `src/apps/web-mediacenter/modules/media/media-library-app-service.js`
- Modify: `src/apps/web-mediacenter/modules/media/media-library-app-service.test.js` if a colocated test exists; otherwise modify `tests/media-library-app-service.test.js`
- Create: `tests/android-saf-media-provider.test.js`

**Interfaces:**
- `AndroidSafProvider` implements `connect`, `disconnect`, `list`, `getFile`, `uploadFile`, `deleteFile`, `createFolder`, `deleteFolder`, `getFileStream`, and `getPublicUrl` from `MediaLibraryProvider`.
- `AndroidSafProvider(config)` consumes `config.url` and `config.token` and returns same-origin proxy URLs for the existing media route.
- `getPublicUrl('/x.mp4')` returns the existing same-node `/api/media-libraries/{id}/proxy/x.mp4` path; no native URL or token is exposed to clients.

- [ ] **Step 1: Add deterministic fake gateway responses/streams and failing provider tests.**

  Test status/connect, list metadata mapping, HEAD metadata, full streaming, Range forwarding, multipart upload body forwarding, delete, create-folder, delete-folder, token header, and virtual-path rejection. Assert upload clears `file.data` after the request is accepted, matching `LocalProvider` behavior.

- [ ] **Step 2: Run the Node test and verify the expected failure.**

  Run:

  ```bash
  node --test tests/android-saf-media-provider.test.js
  ```

  Expected: failure because `AndroidSafProvider` is not exported or implemented.

- [ ] **Step 3: Implement the provider with Node HTTP streams.**

  Add a small request helper using `node:http`, set the token on every request, encode query path segments safely, parse JSON responses, preserve status/headers for file streams, forward `Range`, and avoid buffering streamed reads. Export the provider alongside existing providers.

- [ ] **Step 4: Run focused provider and existing media-library tests.**

  Run:

  ```bash
  node --test tests/android-saf-media-provider.test.js tests/media-library-app-service.test.js
  ```

  Expected result: all focused tests pass.

### Task 5: Auto-register the Android SAF media library

**Files:**
- Modify: `src/apps/web-mediacenter/modules/media/media-library-app-service.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `tests/media-library-app-service.test.js`
- Create or modify: `tests/android-shared-storage.test.js`

**Interfaces:**
- `MediaLibraryManager` consumes an optional `androidSafConfig: { url: String, token: String }` option.
- On initialization with valid endpoint/token it adds managed library `{ id: 'android-saf', name: 'Android SAF 媒体目录', type: 'android-saf', managed: true }`.
- Managed SAF configuration is runtime-only and is not persisted with the user media-library JSON; endpoint/token never appear in `/api/media-libraries` or AASC remote-library payloads.
- `getLocalLibraryRoutes()` continues returning only filesystem `LocalProvider` routes; the existing `/api/media-libraries/:id/proxy/*` route serves SAF streams through `getFileStream`.

- [ ] **Step 1: Add failing manager and server-environment contract tests.**

  Assert that a manager with valid Android SAF options exposes exactly one managed SAF library, defaults to it when no other default exists, excludes its endpoint/token from saved config, and leaves ordinary local/http/smb configuration unchanged. Assert the APK manifest does not declare `MANAGE_EXTERNAL_STORAGE` and legacy permissions remain max SDK 28.

- [ ] **Step 2: Run the focused Node tests and verify the expected failure.**

  Run:

  ```bash
  node --test tests/android-shared-storage.test.js tests/media-library-app-service.test.js
  ```

  Expected: failure because the manager does not know the `android-saf` provider and server startup does not pass SAF configuration.

- [ ] **Step 3: Implement manager registration and server wiring.**

  Add the provider branch, runtime managed-library initialization, default selection, save filtering, and provider export. Pass `AASC_ANDROID_SAF_URL`/`AASC_ANDROID_SAF_TOKEN` from `server-app.js` only when both are non-empty. Leave the HTTP CRUD routes and AASC WebSocket remote configuration flow unchanged.

- [ ] **Step 4: Run focused Node tests and JavaScript syntax checks.**

  Run:

  ```bash
  node --test tests/android-shared-storage.test.js tests/android-saf-media-provider.test.js tests/media-library-app-service.test.js
  node --check src/apps/web-mediacenter/modules/media/media-library-app-service.js
  node --check src/apps/server/boot/server-app.js
  ```

  Expected result: all tests pass and both syntax checks exit successfully.

### Task 6: Verify Android 9/10/11+ behavior and finish repository documentation

**Files:**
- Modify: `docs/design/android-display.md`
- Modify: `docs/design/android-embedded-node-server.md`
- Modify: `docs/spec/android-display.md`
- Modify: `docs/spec/android-embedded-node-server.md`
- Modify: `docs/task/20260913_APK支持Android10及11以上共享存储访问.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

**Interfaces:**
- Documentation describes API 28 direct `fs`, API 29+ SAF virtual `/`, loopback gateway, token, streaming, error behavior, and Android 11+ picker restrictions.
- Completion removes the in-progress task from `docs/todo.md` and records files plus verification in `changelog.md`.

- [ ] **Step 1: Run repository-focused Node tests.**

  Run:

  ```bash
  npm test -- --test-name-pattern='Android|media-library|shared storage|SAF'
  ```

  If the repository Node version does not support the name filter, run the exact focused test files from Tasks 4 and 5 instead and record any pre-existing unrelated failures.

- [ ] **Step 2: Run all Android JVM tests and assemble the debug APK.**

  Run:

  ```bash
  cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --no-daemon --console=plain
  cd /mnt/AASC && npm run build:apk
  ```

  Expected result: Android unit tests and APK assembly succeed with no `MANAGE_EXTERNAL_STORAGE` declaration.

- [ ] **Step 3: Perform device checks where Android 10/11+ devices are available.**

  Verify API 28 legacy permission and direct-path regression; on API 29+ select a normal user media directory, verify Node index root `/`, list/read/Range/upload/create/delete, restart persistence, cancellation, URI revocation, and protected-directory rejection. Confirm the display/AASC connection remains usable for all media authorization outcomes.

- [ ] **Step 4: Update final docs and run `git diff --check`.**

  Record actual test counts, APK path, and any unavailable physical-device checks in the task/changelog documents. Run:

  ```bash
  git diff --check
  ```

  Expected result: no whitespace errors and no completed item remains in `docs/todo.md`.
