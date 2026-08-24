# LLM Profile Pi Agent Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-profile `llm`/`agent` selection, run Pi as a server-managed RPC process with template-bound read-only permissions, and keep ordinary LLM behavior compatible.

**Architecture:** A generic `PiRuntimeManager` owns one in-process child session per profile/template/permission tuple. `llm-service` remains the chat domain adapter: it normalizes profile/template policy, isolates history, builds the Agent prompt, and routes stream callbacks either to the existing HTTP/SSE implementation or the Pi runtime. The first permission policy is `readonly`; the control UI persists that policy on chat templates, while the server maps it to a fixed tool allowlist.

**Tech Stack:** Node.js `child_process.spawn`, Pi 0.84 RPC JSONL, Express, WebSocket, native HTML/CSS/JavaScript, Node built-in test runner.

**Spec:** `docs/spec/llm-agent-mode.md`

## Global Constraints

- Existing profiles without `mode` remain `llm` profiles.
- Agent mode accepts only the `pi` backend and never falls back to direct LLM HTTP when Pi fails.
- Pi is a non-detached child of the server; the server owns startup, timeout, error cleanup, and shutdown.
- The `readonly` policy allows only `read`, `grep`, `find`, `ls`, `aasc_web_search`, and `aasc_web_fetch`; it does not allow `bash`, `edit`, or `write`.
- Profile and template context are isolated; no work AI role history or Codex/Claude process is reused.
- Control-side template configuration is the permission source for this feature; no administrator authentication is added.
- Production code uses `const`/`let`, `async`/`await`, `try-catch`, early returns, and Chinese detailed comments.
- Do not modify unrelated dirty files: `logs/server*.jsonl` and `res/tasks/render-display/results/8db6c9bc/run.log`.

---

### Task 1: Add profile/template policy and history-key primitives

**Files:**
- Create: `src/apps/server/modules/chat/pi-runtime-policy.js`
- Create: `src/apps/server/modules/chat/pi-runtime-policy.test.js`
- Modify: `src/external/llm/llm-service.js`
- Test: `src/external/llm/llm-service.test.js`

**Interfaces:**
- `normalizeAgentProfile(profile) -> normalizedProfile`
- `normalizeChatTemplate(template) -> normalizedTemplate`
- `resolvePermissionPolicy(permissionProfile) -> { name, tools }`
- `normalizeOpenAiBaseUrl(apiUrl) -> string`
- `buildChatSessionKey({ profileName, templateId, mode, target, sessionId }) -> string`

- [ ] **Step 1: Write failing policy tests**

```javascript
test('缺少 mode 的 profile 默认按普通 LLM', () => {
    assert.deepStrictEqual(normalizeAgentProfile({ name: 'local' }).mode, 'llm');
});

test('Agent profile 只接受 Pi', () => {
    assert.equal(normalizeAgentProfile({ name: 'local', mode: 'agent' }).backend, 'pi');
    assert.throws(() => normalizeAgentProfile({ mode: 'agent', backend: 'codex' }), /Pi/);
});

test('只读权限只返回固定工具白名单', () => {
    assert.deepStrictEqual(resolvePermissionPolicy('readonly').tools, [
        'read', 'grep', 'find', 'ls', 'aasc_web_search', 'aasc_web_fetch'
    ]);
});

test('模板缺少权限时默认只读，且拒绝任意工具字段', () => {
    const template = normalizeChatTemplate({ name: '资料助手', content: '查资料' });
    assert.equal(template.permissionProfile, 'readonly');
    assert.equal('tools' in template, false);
});

test('Chat session key 同时隔离 profile 和 template', () => {
    const key = buildChatSessionKey({
        profileName: 'qwen', templateId: 'researcher', mode: 'group'
    });
    assert.equal(key, 'profile:qwen:template:researcher:group');
});
```

- [ ] **Step 2: Run the focused test and verify it fails for missing functions**

Run: `node --test src/apps/server/modules/chat/pi-runtime-policy.test.js`

Expected: FAIL because `pi-runtime-policy.js` does not exist yet.

- [ ] **Step 3: Implement the minimal policy module**

Implement strict enum validation, fixed `readonly` tools, URL normalization for an endpoint ending in `/chat/completions`, and path-safe session key construction. Do not accept a client-provided tools array.

- [ ] **Step 4: Run policy tests and existing LLM tests**

Run: `node --test src/apps/server/modules/chat/pi-runtime-policy.test.js src/external/llm/llm-service.test.js`

Expected: PASS; the existing global `agentBackend` test remains unchanged.

- [ ] **Step 5: Update `llm-service` data primitives under test**

Add `mode`/`backend` normalization when loading and saving profiles, add `permissionProfile` to templates, and extend stored chat messages with `profileName` and `templateId`. Change `sessionKey` callers to use the new primitive while mapping old records without these fields to the startup active profile and `default` template. Keep `getHistory()` compatible for the control UI by returning the active profile’s visible records.

- [ ] **Step 6: Run the existing LLM test file again**

Run: `node --test src/external/llm/llm-service.test.js`

Expected: PASS with no changes to direct LLM behavior.

---

### Task 2: Implement the fixed read-only Pi extension

**Files:**
- Create: `src/apps/server/modules/chat/pi-readonly-tools.js`
- Create: `src/apps/server/modules/chat/pi-readonly-tools.test.js`

**Interfaces:**
- Default extension factory consumed by Pi `--extension`.
- `validateReadOnlyUrl(url) -> URL`
- `readOnlyFetch(url, options) -> { status, contentType, text }`
- `parseSearchResults(html, limit) -> [{ title, url, snippet }]`

- [ ] **Step 1: Write failing helper and static permission tests**

```javascript
test('拒绝非 HTTP URL', () => {
    assert.throws(() => validateReadOnlyUrl('file:///etc/passwd'), /URL/);
});

test('网络工具只允许 GET 且限制响应大小', async () => {
    await assert.rejects(
        () => readOnlyFetch('https://example.test', { method: 'POST' }),
        /GET/
    );
});

test('搜索结果只返回标题、URL 和摘要', () => {
    const result = parseSearchResults('<a class="result__a" href="https://example.test">标题</a>', 3);
    assert.deepStrictEqual(result[0], {
        title: '标题', url: 'https://example.test', snippet: ''
    });
});

test('扩展源码不得启用写入或 shell 工具', () => {
    const source = fs.readFileSync(extensionFile, 'utf8');
    assert.doesNotMatch(source, /registerTool\(\{\s*name:\s*['"](?:bash|edit|write)['"]/u);
});
```

- [ ] **Step 2: Run the test to verify the expected failure**

Run: `node --test src/apps/server/modules/chat/pi-readonly-tools.test.js`

Expected: FAIL because the extension helper module is not present.

- [ ] **Step 3: Implement read-only helpers and the Pi extension**

Use native `fetch` with an abort timeout, maximum response bytes, bounded redirects, and only `http`/`https`. Implement `aasc_web_fetch` for a user-supplied URL and `aasc_web_search` through the fixed search endpoint/parser. The extension registers the custom provider from `AASC_PI_BASE_URL`, `AASC_PI_MODEL`, and `AASC_PI_API_KEY`, and registers only the two network tools. It must not import filesystem write APIs or register shell tools.

- [ ] **Step 4: Run the extension tests**

Run: `node --test src/apps/server/modules/chat/pi-readonly-tools.test.js`

Expected: PASS, including URL, size, parser, and static tool-boundary assertions.

---

### Task 3: Implement the generic server-owned Pi RPC runtime

**Files:**
- Create: `src/apps/server/modules/chat/pi-runtime-manager.js`
- Create: `src/apps/server/modules/chat/pi-runtime-manager.test.js`

**Interfaces:**
- `new PiRuntimeManager({ projectRoot, extensionPath, spawn, commandPath, requestTimeoutMs })`
- `chatStream(profile, template, prompt, callbacks) -> Promise<{ success, message }>`
- `stopSession(key) -> Promise<void>`
- `stopAll() -> Promise<void>`
- `buildSpawnArgs(profile, template, extensionPath) -> string[]`

- [ ] **Step 1: Write a fake-Pi failing integration test**

The fake child must accept JSONL prompts on stdin and emit a matching RPC response, two `message_update` text deltas, and `agent_end`. Assert that the manager returns the combined message and invokes `onChunk` in order.

```javascript
test('Pi RPC 流式文本按增量回调并完成请求', async () => {
    const child = createFakePiChild();
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.js',
        spawn: () => child
    });
    const chunks = [];
    const result = await manager.chatStream(
        { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1/chat/completions', model: 'qwen' },
        { id: 'researcher', permissionProfile: 'readonly', content: '只读助手' },
        '查找文件',
        { onChunk: (chunk) => chunks.push(chunk) }
    );
    assert.deepStrictEqual(chunks, ['找到', '文件']);
    assert.equal(result.message, '找到文件');
});
```

- [ ] **Step 2: Run the runtime test and verify it fails**

Run: `node --test src/apps/server/modules/chat/pi-runtime-manager.test.js`

Expected: FAIL because `PiRuntimeManager` is not defined.

- [ ] **Step 3: Implement spawn, JSONL correlation, and session queues**

Spawn Pi as a non-detached child with `cwd=projectRoot`, `stdio=['pipe','pipe','pipe']`, `--mode rpc`, `--no-session`, `--no-context-files`, `--no-extensions`, the fixed extension path, profile provider/model, and the policy tool list. Put API URL/model/key in the child environment, never in args. Keep one pending request per session, queue concurrent calls, parse `message_update` text deltas, finish on `agent_end`, and reject on RPC failure, malformed JSON, timeout, or child exit.

- [ ] **Step 4: Add failure and cleanup tests**

Cover: no `bash/edit/write` in spawn args, profile/template/permission changes create a new session, child exit rejects the request and removes the session, timeout kills the child, and `stopAll()` closes every child.

- [ ] **Step 5: Run the runtime tests**

Run: `node --test src/apps/server/modules/chat/pi-runtime-manager.test.js`

Expected: PASS with all cleanup assertions.

---

### Task 4: Route chat through Pi and isolate context/history

**Files:**
- Modify: `src/external/llm/llm-service.js`
- Modify: `src/external/llm/llm-service.test.js`
- Modify: `src/apps/server/boot/server-app.js`
- Create: `tests/llm-agent-mode.test.js`

**Interfaces:**
- `chat.init(config, { piRuntimeManager })`
- `chat.shutdown() -> Promise<void>`
- Existing `chat.chatStream()` callbacks remain unchanged.

- [ ] **Step 1: Write failing routing tests**

```javascript
function createAgentChatHarness() {
    const calls = [];
    const runtime = {
        async chatStream(profile, template, prompt, callbacks) {
            calls.push({ profile, template, prompt });
            callbacks.onChunk?.('Pi回复', 'Pi回复');
            callbacks.onComplete?.('Pi回复');
            return { success: true, message: 'Pi回复' };
        },
        async stopAll() {}
    };
    chat.init({
        systemPrompt: '默认助手',
        activeProfile: 'agent',
        llmProfiles: [{
            name: 'agent', mode: 'agent', backend: 'pi',
            apiUrl: 'http://127.0.0.1:9/v1/chat/completions',
            model: 'qwen', maxTokens: 1000, temperature: 0.7,
            contextCount: 10, apiKey: ''
        }]
    }, { piRuntimeManager: runtime });
    chat.setTemplates([{ id: 'researcher', name: 'researcher', content: '只读助手', permissionProfile: 'readonly' }]);
    return { calls };
}

test('Agent profile 使用 Pi，不调用普通 LLM HTTP', async () => {
    const { calls } = createAgentChatHarness();
    const result = await chat.chatStream('查找文件', {
        templateTarget: 'researcher',
        mode: 'group',
        includeHistory: true,
        contextCount: 10
    }, {});
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].profile.name, 'agent');
    assert.match(calls[0].prompt, /查找文件/u);
});

test('模板权限来自服务端模板，不能由请求 tools 字段覆盖', async () => {
    const { calls } = createAgentChatHarness();
    await chat.chatStream('搜索资料', {
        templateTarget: 'researcher',
        mode: 'group',
        tools: ['bash']
    }, {});
    assert.equal(calls[0].template.permissionProfile, 'readonly');
    assert.equal('tools' in calls[0].template, false);
});
```

- [ ] **Step 2: Run the routing tests and verify they fail**

Run: `node --test tests/llm-agent-mode.test.js`

Expected: FAIL because `chat.init` does not accept a Pi runtime and `chatStream` still always uses HTTP.

- [ ] **Step 3: Implement profile/template-aware context construction**

Extend `buildMessages` and its history lookup to use active profile, template name, mode, target, and session ID. Build the Pi prompt from the selected system prompt/template, only the current profile/template’s recent `contextCount` records, and the current user message. Preserve the existing OpenAI/raw message construction for direct LLM mode.

- [ ] **Step 4: Implement the `chatStream` branch**

When the normalized active profile is `agent`, resolve the saved template by `templateTarget`, call the injected `PiRuntimeManager`, and forward `onChunk`, `onSentence`, `onComplete`, and `onError`. Do not call `makeStreamRequest` in this branch. On success, save the final assistant message through the existing history path; on failure, return the error without fallback.

- [ ] **Step 5: Wire server initialization and shutdown**

Create one `PiRuntimeManager` in `server-app.js`, inject it into `chat.init`, and call `chat.shutdown()` before the existing delayed restart `process.exit(0)`. Add a guarded process shutdown handler for SIGTERM/SIGINT that stops Pi sessions before exit without changing the existing work AI role backend host behavior.

- [ ] **Step 6: Run routing, chat, and request-id regressions**

Run: `node --test tests/llm-agent-mode.test.js src/external/llm/llm-service.test.js tests/chat-stream-request-id.test.js tests/agent-chat-tts.test.js`

Expected: PASS; ordinary LLM and existing Agent-role tests remain green.

---

### Task 5: Add profile mode and template permission controls to the control UI

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Modify: `src/apps/web-mediacenter/ui/public/js/chat.js`
- Modify: `src/apps/web-mediacenter/ui/public/css/chat.css`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/external/llm/llm-service.js`
- Create: `tests/llm-agent-mode-ui.test.js`

**Interfaces:**
- Profile payload includes `mode` and `backend`.
- Template payload includes `permissionProfile`.
- Existing `/api/chat/profiles` and `/api/chat/templates*` endpoints remain compatible.

- [ ] **Step 1: Write failing UI/source tests**

```javascript
const html = fs.readFileSync(uploadHtmlFile, 'utf8');
const chatSource = fs.readFileSync(chatJsFile, 'utf8');

test('profile 编辑器提供 llm/agent 模式', () => {
    assert.match(html, /id="profileEditMode"/u);
    assert.match(html, /value="agent"/u);
    assert.match(chatSource, /mode\s*:/u);
    assert.match(chatSource, /backend\s*:\s*['"]pi['"]/u);
});

test('模板编辑器提供 readonly 权限并保存 permissionProfile', () => {
    assert.match(html, /id="templatePermissionProfile"/u);
    assert.match(html, /value="readonly"/u);
    assert.match(chatSource, /permissionProfile\s*:/u);
});
```

- [ ] **Step 2: Run UI tests to verify failure**

Run: `node --test tests/llm-agent-mode-ui.test.js`

Expected: FAIL because the new controls and payload fields do not exist.

- [ ] **Step 3: Implement profile controls**

Add a profile “调用模式” select. In agent mode show “Pi Agent” and the fixed read-only explanation; send `mode` and `backend: 'pi'` in the profile save payload. Render the mode in the profile list. Keep old profiles defaulting to direct LLM.

- [ ] **Step 4: Implement template permission controls**

Add a template permission select with `readonly` and save it through the existing template add/update endpoints. Add an edit/save path for an existing template’s permission so users do not need to delete and recreate a template. Display the policy label in the template list.

- [ ] **Step 5: Validate server payloads**

Make profile/template setters call the policy normalizers. Reject unsupported mode/backend/permission values with a visible JSON error. Ignore arbitrary `tools` fields from incoming payloads.

- [ ] **Step 6: Run UI and backend regressions**

Run: `node --test tests/llm-agent-mode-ui.test.js src/apps/server/modules/chat/pi-runtime-policy.test.js src/external/llm/llm-service.test.js`

Expected: PASS.

---

### Task 6: Update configuration defaults, documentation, and change records

**Files:**
- Modify: `config/config.json`
- Modify: `src/apps/server/modules/config/config-app-service.js`
- Modify: `docs/design/chat-system.md`
- Modify: `docs/spec/chat-system.md`
- Modify: `docs/design/llm-agent-mode.md`
- Modify: `docs/spec/llm-agent-mode.md`
- Modify: `docs/task/2026-08-23_LLM配置Agent模式与Pi只读执行.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [ ] **Step 1: Add backward-compatible defaults**

Add `mode: 'llm'`, `backend: 'pi'` only where needed, and template `permissionProfile: 'readonly'` defaults without overwriting existing user values. Keep the existing global `chat.agentBackend` semantics for work AI roles.

- [ ] **Step 2: Synchronize chat design/spec pseudocode**

Document the unified chat route: deterministic built-in command recognition stays first; unresolved chat goes to direct LLM or Pi according to the active profile; future server command tools use separate permission policies. Document that control-side template settings are the permission source for this feature.

- [ ] **Step 3: Record completion**

Move the task from the pending section of `docs/todo.md` to a completed entry with timestamps and changed files. Add the completed feature and verification evidence to `changelog.md`.

---

### Task 7: Full verification and handoff

**Files:**
- Test: all changed test files and relevant existing suites.

- [ ] **Step 1: Run syntax checks**

Run: `node --check src/apps/server/modules/chat/pi-runtime-policy.js && node --check src/apps/server/modules/chat/pi-runtime-manager.js && node --check src/apps/server/modules/chat/pi-readonly-tools.js && node --check src/external/llm/llm-service.js && node --check src/apps/web-mediacenter/ui/public/js/chat.js`

Expected: no syntax errors.

- [ ] **Step 2: Run focused feature tests**

Run: `node --test src/apps/server/modules/chat/pi-runtime-policy.test.js src/apps/server/modules/chat/pi-readonly-tools.test.js src/apps/server/modules/chat/pi-runtime-manager.test.js tests/llm-agent-mode.test.js tests/llm-agent-mode-ui.test.js`

Expected: all feature tests PASS.

- [ ] **Step 3: Run related regressions**

Run: `node --test src/external/llm/llm-service.test.js tests/chat-stream-request-id.test.js tests/agent-chat-tts.test.js tests/chat-markdown.test.js`

Expected: all related tests PASS; report any sandbox-only failures separately.

- [ ] **Step 4: Perform static security verification**

Run: `rg -n -- "--tools|bash|edit|write|spawn\(" src/apps/server/modules/chat tests --glob '*.js'`

Verify that production Pi startup uses the fixed allowlist and no user input is interpolated into executable command arguments or tool names.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check` and `git status --short`.

Verify only requested source/tests/config/docs changed; preserve the pre-existing log changes.
