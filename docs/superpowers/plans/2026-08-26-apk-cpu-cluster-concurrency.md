# APK ASR/TTS 大小核并发配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 APK 的 ASR/TTS 并发上限等于各自配置的大核数与小核数之和，并由服务器和控制端管理大小核数量。

**Architecture:** 服务器保存 `cpuAffinity.asr/tts` 配置并通过 WebSocket 广播；控制端提供两个引擎各自的大核/小核数量设置。APK 自动识别大小核，使用 JNI `sched_setaffinity` 为每个工作槽绑定一个 CPU；ASR 和 TTS 各自维护独立引擎池，单槽单线程，超出槽位的请求排队。

**Tech Stack:** Node.js/Express/WebSocket、原生 HTML/JavaScript、Kotlin、Android JNI/C++、sherpa-onnx Embedded Speech SDK、Gradle、JUnit、Node test runner。

**Spec:** `docs/superpowers/specs/2026-08-25-apk-cpu-cluster-config-design.md`

## Global Constraints

- 默认 ASR/TTS 均为 1 个大核 + 1 个小核。
- 控制端只设置大小核数量，不填写 CPU 编号；APK 动态识别 CPU 集群。
- 同一引擎并发上限为配置核心总数；单个工作槽的 ASR/TTS 推理线程数为 1。
- 保留 ASR/TTS 现有异步桥、60 秒超时、旧 APK 兼容和 TTS 生成阶段静音行为。
- affinity 失败只降级为 Android 默认调度，不得导致 ASR/TTS 请求失败。
- 修改前先写并运行失败测试；生产代码使用 `const/let`、`async/await`、`try/catch`，中文注释。
- 直接在 `/mnt/AASC` 的 master 工作区修改，不创建 worktree；保留无关用户改动。

### Task 1: 服务器配置与 WebSocket 契约

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `config/config.json`
- Test: `tests/apk-cpu-affinity-config.test.js`
- Modify: `docs/design/android-native-tts.md`
- Modify: `docs/spec/android-native-tts.md`

**Interfaces:**
- `GET /api/config/cpuAffinity` 返回规范化 `asr/tts` 大小核数量。
- `POST /api/config/cpuAffinity` 接受 `{asr:{bigCoreCount,littleCoreCount},tts:{bigCoreCount,littleCoreCount}}`，保存并广播 `cpuAffinityChanged` 与 `cpuConfig`。
- 显示端初次连接收到 `cpuConfig`，旧客户端忽略未知消息。

- [ ] **Step 1: Write the failing test**

```js
test('CPU 配置默认值为 ASR/TTS 各 1 大核 1 小核', () => {
    const server = read(SERVER);
    assert.match(server, /bigCoreCount/);
    assert.match(server, /littleCoreCount/);
    assert.match(server, /cpuConfig/);
});

test('CPU 配置接口拒绝负数和小数，并广播规范化配置', () => {
    // 使用现有配置路由测试夹具，提交 -1/1.5 后断言 400；提交合法值后断言两个广播消息。
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/apk-cpu-affinity-config.test.js`

Expected: FAIL because server has no `cpuAffinity` contract or broadcast.

- [ ] **Step 3: Write minimal implementation**

```js
const DEFAULT_CPU_AFFINITY = {
    asr: { bigCoreCount: 1, littleCoreCount: 1 },
    tts: { bigCoreCount: 1, littleCoreCount: 1 }
};
```

Add a validator that accepts only non-negative integers, falls back to the defaults for missing fields, saves `config.cpuAffinity`, and sends `cpuConfig` to every display. Include the same `cpuConfig` in the display connection initialization path.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/apk-cpu-affinity-config.test.js`

Expected: PASS with validation and broadcast assertions.

### Task 2: APK CPU topology and affinity primitive

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/CpuCluster.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/CpuAffinity.kt`
- Create: `src/apps/android-display/app/src/main/cpp/cpu_affinity.cpp`
- Create: `src/apps/android-display/app/src/main/cpp/CMakeLists.txt`
- Modify: `src/apps/android-display/app/build.gradle.kts`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/CpuClusterTest.kt`

**Interfaces:**
- `CpuCluster.detect(reader): CpuTopology` classifies online CPUs by `cpuinfo_max_freq`.
- `CpuTopology.policy(bigCoreCount, littleCoreCount): CpuPolicy` returns selected CPU IDs, effective counts, and fallback state.
- `CpuAffinity.applyCurrentThread(cpuMask): Boolean` calls JNI `sched_setaffinity` and never throws through the voice request path.

- [ ] **Step 1: Write the failing test**

```kotlin
@Test
fun policy按频率选择一大核两小核() {
    val topology = CpuTopology(listOf(0 to 1900800L, 1 to 1900800L, 2 to 2361600L, 3 to 2361600L))
    assertEquals(listOf(2), topology.policy(1, 0).bigCpus)
    assertEquals(listOf(0, 1), topology.policy(0, 2).littleCpus)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew :app:testDebugUnitTest --tests com.aasc.display.CpuClusterTest`

Expected: FAIL because topology and policy classes do not exist.

- [ ] **Step 3: Write minimal implementation**

Implement deterministic topology classification, count clamping, and JNI affinity. JNI must use the current native thread ID and a CPU bit mask; if the syscall is unavailable or denied, return false and log the fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `./gradlew :app:testDebugUnitTest --tests com.aasc.display.CpuClusterTest`

Expected: PASS; `assembleDebug` must also compile the JNI library.

### Task 3: ASR concurrent engine pool

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/AsrEngine.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/AsrEnginePool.kt`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/AsrEnginePoolTest.kt`

**Interfaces:**
- `AsrEnginePool.configure(policy, modelFiles)` rebuilds a bounded pool.
- `recognize(samples)` acquires one slot, applies its affinity, recognizes with an independent engine, and returns the slot in `finally`.
- Pool size is `max(1, policy.totalCoreCount)`; each recognizer uses `numThreads=1`.

- [ ] **Step 1: Write the failing test**

```kotlin
@Test
fun 并发上限等于大小核数量且超过后排队() = runBlocking {
    val pool = fakePool(big = 1, little = 1, operationDelayMs = 100)
    val results = (1..3).map { async { pool.run { "ok" } } }.awaitAll()
    assertEquals(listOf("ok", "ok", "ok"), results)
    assertEquals(2, pool.maxConcurrentObserved)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew :app:testDebugUnitTest --tests com.aasc.display.AsrEnginePoolTest`

Expected: FAIL because the current singleton recognizer and single executor have no bounded pool.

- [ ] **Step 3: Write minimal implementation**

Move recognizer state into pool slots, configure each slot with an independent recognizer and `numThreads=1`, and route both sync and async bridge paths through the pool. Reconfigure only between tasks so an in-flight stream is never released.

- [ ] **Step 4: Run test to verify it passes**

Run: `./gradlew :app:testDebugUnitTest --tests com.aasc.display.AsrEnginePoolTest`

Expected: PASS and no regression in existing ASR model readiness tests.

### Task 4: TTS concurrent engine pool

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/TtsEngine.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/TtsEnginePool.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/TtsEnginePoolTest.kt`

**Interfaces:**
- `TtsEnginePool.configure(policy, modelDir)` creates up to `policy.totalCoreCount` independent silent synthesizers.
- `synthesize(text)` acquires one synthesizer slot, applies affinity, calls `SpeakText`, returns WAV, and releases the slot.
- Each TTS slot retains the existing `SpeechSynthesizer(config, null)` behavior.

- [ ] **Step 1: Write the failing test**

```kotlin
@Test
fun TTS并发槽位为两个且仍然不输出到扬声器() {
    val source = readSource("TtsEngine.kt")
    assertTrue(source.contains("SpeechSynthesizer(config, null)"))
    assertTrue(source.contains("totalCoreCount"))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew :app:testDebugUnitTest --tests com.aasc.display.TtsEnginePoolTest`

Expected: FAIL because the current singleton engine has no pool.

- [ ] **Step 3: Write minimal implementation**

Refactor `TtsEngine` from a global singleton-only implementation into an independently loadable engine instance while preserving the current silent output configuration. Build a bounded pool, apply affinity per worker, and retain 60-second timeout/callback semantics.

- [ ] **Step 4: Run test to verify it passes**

Run: `./gradlew :app:testDebugUnitTest --tests com.aasc.display.TtsEnginePoolTest`

Expected: PASS; an end-to-end two-request test returns two valid WAV files.

### Task 5: Display configuration and control UI

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Modify: `src/apps/web-mediacenter/ui/public/js/tts.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Test: `tests/apk-cpu-affinity-display.test.js`

**Interfaces:**
- Display receives `cpuConfig` and calls `NativeDisplay.cpuConfigure` when available.
- Control UI reads/writes `/api/config/cpuAffinity` and updates after `cpuAffinityChanged`.

- [ ] **Step 1: Write the failing test**

Assert that the display handles `cpuConfig`, the control page exposes ASR/TTS big/little count fields, and old bridge absence does not throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/apk-cpu-affinity-display.test.js`

Expected: FAIL because no CPU configuration message or controls exist.

- [ ] **Step 3: Write minimal implementation**

Add numeric inputs with default 1, POST normalized values, subscribe to the change event, and send the merged configuration to the APK without changing existing device routing.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/apk-cpu-affinity-display.test.js`

Expected: PASS with old-browser compatibility assertions.

### Task 6: Integration verification and documentation

**Files:**
- Modify: `docs/design/android-native-asr.md`
- Modify: `docs/spec/android-native-asr.md`
- Modify: `docs/design/android-native-tts.md`
- Modify: `docs/spec/android-native-tts.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `docs/task/2026-08-26_APK大小核并发配置.md`

- [ ] **Step 1: Run focused Node tests**

Run: `node --test tests/apk-cpu-affinity-config.test.js tests/apk-cpu-affinity-display.test.js tests/tts-display-routing.test.js`

- [ ] **Step 2: Run Android tests and build**

Run: `./gradlew :app:testDebugUnitTest :app:assembleDebug`

- [ ] **Step 3: Deploy through npm and verify display2**

Run: `npm run upload:apk` and `npm run start:apk:display -- 2`.

Verify the APK process is alive, reports topology and `cpuConfig`, and keeps the existing display capabilities.

- [ ] **Step 4: Run concurrent display TTS test**

With default `1+1`, submit two TTS requests at once and verify both complete without duplicate playback, then submit a third and verify it waits rather than creating a third native worker.

- [ ] **Step 5: Update docs and task record**

Record effective topology, configured counts, observed concurrency, success/failure, memory impact, and fallback behavior. Mark the task complete only after all verification commands pass.

## Self-review

- Coverage: Tasks 1--2 cover configuration and affinity; Tasks 3--4 cover independent ASR/TTS pools; Task 5 covers protocol/UI; Task 6 covers build, deployment, concurrency and documentation.
- Concurrency semantics: the configured core total is a per-engine request-slot limit, while each slot uses one inference thread; this prevents CPU oversubscription.
- Compatibility: unknown `cpuConfig` messages are ignored by old APKs, and affinity failure falls back to default scheduling.
