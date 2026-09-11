# Same Registered Speaker ASR Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress duplicate final ASR results caused by the same registered speaker being heard by different display microphones within a short interval.

**Architecture:** Add a small, stateful server-side deduplicator module. Display ASR results carry optional speech interval metadata; the existing `voiceInput` handler checks speaker identity, interval overlap/nearby timing, and character edit similarity before broadcasting to controls or entering repair/conversation/command handling.

**Tech Stack:** Node.js CommonJS, `node:test`, existing WebSocket voice-input pipeline.

**Spec:** `docs/spec/same-speaker-asr-dedup.md`

## Global Constraints

- Only matched, non-empty registered `speaker` values participate.
- Only different `displayId` values participate; timed results require interval overlap/500 ms gap and text similarity at least 0.65.
- Untimed legacy results require normalized text equality within 2000 ms.
- The first accepted result remains the primary result; no audio fusion or spatial localization is included.
- Keep the existing `voiceInput` payload compatible.
- Follow AASC rules: `const/let`, Chinese detailed comments, no destructive worktree cleanup, and synchronized design/spec/task/changelog documents.

---

### Task 1: Define the deduplicator contract with tests

**Files:**
- Create: `tests/voice-input-deduplicator.test.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Read: `docs/design/same-speaker-asr-dedup.md`
- Read: `docs/spec/same-speaker-asr-dedup.md`

**Interfaces:**
- Consumes: `createSameSpeakerVoiceInputDeduplicator(options)` from the production module.
- Produces: `check(input, receivedAt)` returning `{ isDuplicate, duplicateOfDisplayId }` when suppressed.

- [x] **Step 1: Write the failing test**

```js
const { createSameSpeakerVoiceInputDeduplicator } = require('../src/apps/server/modules/voice/voice-input-deduplicator');

test('同一注册声纹在不同显示端的短时相同 ASR 只保留首条', () => {
    const deduplicator = createSameSpeakerVoiceInputDeduplicator({ windowMs: 2000 });
    assert.equal(deduplicator.check({ displayId: 'display-a', speaker: 'z', text: '打开客厅灯。', isFinal: true }, 1000).isDuplicate, false);
    const result = deduplicator.check({ displayId: 'display-b', speaker: 'z', text: '打开客厅灯', isFinal: true }, 2500);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.duplicateOfDisplayId, 'display-a');
});

test('未匹配声纹、不同说话人、同一显示端和超时结果不去重', () => {
    const deduplicator = createSameSpeakerVoiceInputDeduplicator({ windowMs: 2000 });
    assert.equal(deduplicator.check({ displayId: 'display-a', speaker: null, text: '你好', isFinal: true }, 1000).isDuplicate, false);
    assert.equal(deduplicator.check({ displayId: 'display-b', speaker: 'x', text: '你好', isFinal: true }, 1100).isDuplicate, false);
    assert.equal(deduplicator.check({ displayId: 'display-b', speaker: 'x', text: '你好', isFinal: true }, 1200).isDuplicate, false);
    assert.equal(deduplicator.check({ displayId: 'display-a', speaker: 'x', text: '你好', isFinal: true }, 1300).isDuplicate, false);
    assert.equal(deduplicator.check({ displayId: 'display-c', speaker: 'x', text: '你好', isFinal: true }, 3401).isDuplicate, false);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/voice-input-deduplicator.test.js`

Expected: FAIL because `voice-input-deduplicator.js` does not exist yet.

- [x] **Step 3: Implement the minimal deduplicator**

Create the module with text normalization, character edit similarity, speech interval matching, short-lived metadata cache, strict matched-speaker checks, different-display check, and a `check()` result.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/voice-input-deduplicator.test.js`

Expected: PASS.

### Task 2: Insert deduplication before server voice routing

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Test: `tests/display-voice-listening.test.js`

**Interfaces:**
- Consumes: `sameSpeakerVoiceInputDeduplicator.check({ displayId, speaker, text, isFinal, speechStartAt, speechEndAt }, Date.now())`.
- Produces: Existing `voiceInput` broadcast and voice command routing with duplicate final events suppressed.

- [x] **Step 1: Extend the failing contract test**

Assert that `server-app.js` requires the deduplicator, invokes it inside the `voiceInput` branch, and checks `isDuplicate` before the control broadcast and conversation handling.

- [x] **Step 2: Run the focused contract tests**

Run: `node --test tests/voice-input-deduplicator.test.js tests/display-voice-listening.test.js`

Expected: FAIL on the new server integration assertions.

- [x] **Step 3: Implement the minimal server integration**

Instantiate one module-level deduplicator, pass current voice-input metadata including optional speech interval, log suppressed events, and return before existing broadcast/command handling. Disable the check when the server voiceprint switch is off.

- [x] **Step 4: Run the focused tests**

Run: `node --test tests/voice-input-deduplicator.test.js tests/display-voice-listening.test.js`

Expected: PASS.

### Task 3: Synchronize documentation and verify regressions

**Files:**
- Modify: `docs/design.md`
- Modify: `docs/spec.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Create: `docs/design/same-speaker-asr-dedup.md`
- Create: `docs/spec/same-speaker-asr-dedup.md`
- Create: `docs/task/2026-09-11_同一声纹跨显示端ASR去重.md`

- [x] **Step 1: Record completion in changelog and remove no pending todo item**

The task is completed in this implementation, so `todo.md` must not retain a completed item. Add the implementation, compatibility, and test result to `changelog.md`.

- [x] **Step 2: Run all related tests and syntax checks**

Run: `node --test tests/voice-input-deduplicator.test.js tests/display-voice-listening.test.js tests/display-list-voice-status.test.js tests/display-recording-modes.test.js tests/display-voice-resource-lifecycle.test.js tests/display-vad-config.test.js`

Run: `node --check src/apps/server/boot/server-app.js`

Run: `git diff --check`

Expected: all commands exit with code 0.
