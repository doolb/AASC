# Server Launcher Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让服务器由前台启动器监管，重启服务器子进程时继续继承同一个控制台 TTY，不再因为 detached 进程导致服务器变成后台进程。

**Architecture:** `server-launcher.js` 作为前台父进程，通过 IPC 管理 `server-app.js` 子进程，并以 `inherit/inherit/inherit/ipc` 启动子进程。服务器子进程收到 `/api/restart` 请求后通知启动器、关闭 WebSocket 和 TUI、结束受管运行时并退出；启动器区分主动重启、正常退出和异常崩溃，分别执行重启或退出。

**Tech Stack:** Node.js `child_process.fork`、IPC、Express、WebSocket、Blessed TUI、Node Test Runner。

**Spec:** `docs/spec/server-restart-script.md`、`docs/design/server-restart-script.md`

## Global Constraints

- 默认直接在 `/mnt/AASC` 的 `master` 工作区修改，不创建或切换 worktree。
- 保留工作区现有的无关改动，不使用 reset、checkout、clean 或全量 `git add`。
- 使用 `const/let`，异步操作使用 `async/await`，错误处理使用 `try-catch`。
- 不使用 `detached` 或 `stdio: 'ignore'` 启动服务器子进程。
- 不引入 WebSocket 代理；控制端和显示端允许短暂断线并使用已有重连/状态恢复。
- 修改代码前先有失败测试；每个实现步骤运行对应测试。

---

### Task 1: 启动器生命周期与进程选项

**Files:**
- Create: `src/apps/server/boot/server-launcher.js`
- Modify: `package.json: scripts.start, main`
- Test: `tests/server-launcher.test.js`

**Interfaces:**
- Produces `createServerLauncher(options)`，返回 `{ start, requestStop, handleChildMessage, handleChildExit }`，供测试和启动入口使用。
- `options.spawnChild(file, args, options)` 可注入假的子进程工厂；默认使用 `child_process.fork`。
- `options.schedule(callback, delayMs)`、`options.cancelSchedule(timer)` 和 `options.exit(code)` 可注入测试时钟与退出行为。

- [x] **Step 1: Write the failing test**

```js
test('启动器使用继承标准流和 IPC 启动服务器子进程', () => {
    const calls = [];
    const child = createFakeChild();
    const launcher = createServerLauncher({
        serverPath: '/tmp/server-app.js',
        spawnChild: (...args) => {
            calls.push(args);
            return child;
        }
    });

    launcher.start();

    assert.deepEqual(calls[0][2].stdio, ['inherit', 'inherit', 'inherit', 'ipc']);
    assert.equal(calls[0][2].detached, undefined);
    assert.equal(calls[0][2].env.AASC_SERVER_CHILD, '1');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/server-launcher.test.js`

Expected: FAIL because `server-launcher.js` and `createServerLauncher` do not exist.

- [x] **Step 3: Write minimal implementation**

```js
function spawnServerChild() {
    child = spawnChild(serverPath, processArguments, {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, AASC_SERVER_CHILD: '1' }
    });
    child.once('message', handleChildMessage);
    child.once('exit', handleChildExit);
}
```

实现 `start()`、`requestStop(signal)`、主动重启标记、异常退出退避和入口 `main()`；默认启动命令改为 `node src/apps/server/boot/server-launcher.js`。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/server-launcher.test.js`

Expected: PASS for child spawn options and initial lifecycle.

- [x] **Step 5: Commit**

```bash
git add package.json src/apps/server/boot/server-launcher.js tests/server-launcher.test.js
git commit -m "feat: add foreground server launcher"
```

### Task 2: 服务器主动重启 IPC 与 TTY 清理

**Files:**
- Modify: `src/apps/server/boot/server-app.js:2872-2920`
- Test: `tests/server-launcher.test.js`

**Interfaces:**
- `server-app.js` 的 `/api/restart` 在 IPC 可用时发送 `{ type: 'restartRequested' }`。
- 服务器退出前调用 `tui.destroy()`、关闭 `wss.clients`，并执行现有 `chat.shutdown()`。
- 无 IPC 的直接运行模式不自行启动新进程，只执行优雅退出。

- [x] **Step 1: Write the failing test**

```js
test('服务器重启接口只通知启动器，不再 detached 启动新进程', () => {
    const source = fs.readFileSync(SERVER_PATH, 'utf8');
    const restartBlock = source.slice(source.indexOf("app.post('/api/restart'"), source.indexOf('let processShutdownStarted'));

    assert.match(restartBlock, /process\.send\(\{\s*type:\s*['"]restartRequested['"]/u);
    assert.match(restartBlock, /tui\.destroy\(\)/u);
    assert.doesNotMatch(restartBlock, /detached\s*:\s*true/u);
    assert.doesNotMatch(restartBlock, /stdio\s*:\s*['"]ignore['"]/u);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/server-launcher.test.js`

Expected: FAIL because the current `/api/restart` still calls `spawn(... detached: true, stdio: 'ignore')` and does not notify the launcher.

- [x] **Step 3: Write minimal implementation**

```js
function notifyLauncherRestart() {
    if (typeof process.send === 'function') {
        process.send({ type: 'restartRequested' });
    }
}

app.post('/api/restart', (req, res) => {
    res.json({ status: 'success', message: '服务器正在重启...' });
    setTimeout(() => {
        notifyLauncherRestart();
        wss.clients.forEach(client => client.close());
        tui.destroy();
        void shutdownManagedRuntimes(0);
    }, 100);
});
```

调整 `shutdownManagedRuntimes()` 的清理顺序，保证重复信号和重启请求只执行一次；TUI 的 `q` 正常退出码 0 不被启动器当作崩溃重启。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/server-launcher.test.js`

Expected: PASS for restart IPC, no detached child, TUI cleanup, and direct-run fallback contract.

- [x] **Step 5: Commit**

```bash
git add src/apps/server/boot/server-app.js tests/server-launcher.test.js
git commit -m "fix: restart server through launcher IPC"
```

### Task 3: 正常停止、异常退出和重启行为回归

**Files:**
- Modify: `src/apps/server/boot/server-launcher.js`
- Test: `tests/server-launcher.test.js`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

**Interfaces:**
- `restartRequested` 后子进程以 0 退出时立即重新启动。
- 启动器收到 `SIGINT`/`SIGTERM` 后设置 `stopping=true`，向子进程转发信号，子进程退出后启动器以相同语义退出，不再拉起新子进程。
- 非零异常退出使用 `RESTART_DELAY_MS=1000` 的退避，连续失败达到 `MAX_CRASH_RESTARTS=5` 后以非零码退出。

- [x] **Step 1: Write the failing test**

```js
test('主动重启会拉起新子进程，外部停止不会拉起新子进程', () => {
    const children = [createFakeChild(), createFakeChild()];
    let index = 0;
    const launcher = createServerLauncher({
        spawnChild: () => children[index++],
        schedule: callback => callback()
    });

    launcher.start();
    launcher.handleChildMessage({ type: 'restartRequested' });
    children[0].emit('exit', 0, null);
    assert.equal(index, 2);

    launcher.requestStop('SIGTERM');
    children[1].emit('exit', 143, 'SIGTERM');
    assert.equal(index, 2);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/server-launcher.test.js`

Expected: FAIL because the current launcher does not yet distinguish restart and stop exits.

- [x] **Step 3: Write minimal implementation**

在 `handleChildExit(code, signal)` 中按 `stopping`、`restartRequested`、`code === 0`、异常退出顺序分支；在 `requestStop()` 中取消待执行重启并转发信号。对异常退出维护连续失败计数和 5 次上限，所有定时器在退出时清理。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/server-launcher.test.js tests/restart-server-config.test.js tests/display-websocket-reconnect.test.js`

Expected: all tests PASS; existing restart URL and WebSocket reconnect behavior remain unchanged.

- [x] **Step 5: Commit**

```bash
git add src/apps/server/boot/server-launcher.js tests/server-launcher.test.js docs/todo.md changelog.md
git commit -m "test: verify server launcher lifecycle"
```

### Task 4: 文档与最终验证

**Files:**
- Modify: `docs/design/server-restart-script.md`
- Modify: `docs/spec/server-restart-script.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Test: `tests/server-launcher.test.js`

- [x] **Step 1: Update implementation documentation**

将伪代码中的实际函数名、启动脚本、退出码和异常退避常量与实现逐项对齐；将 `docs/todo.md` 的任务从待完成改为已完成。

- [x] **Step 2: Run full relevant verification**

Run: `node --test tests/server-launcher.test.js tests/restart-server-config.test.js tests/display-websocket-reconnect.test.js tests/display-theme-sync.test.js && node --check src/apps/server/boot/server-launcher.js && node --check src/apps/server/boot/server-app.js && git diff --check`

Expected: all tests pass, both server scripts pass syntax check, and diff check has no output.

- [x] **Step 3: Commit**

```bash
git add docs/design/server-restart-script.md docs/spec/server-restart-script.md docs/todo.md changelog.md tests/server-launcher.test.js
git commit -m "docs: finalize server launcher restart flow"
```
