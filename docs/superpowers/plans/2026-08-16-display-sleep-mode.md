# 显示端睡眠模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为显示端（`display.html`）增加睡眠模式（按时段隐藏媒体、保留 UI）与深度睡眠模式（整屏黑幕），控制端可独立配置各显示端并支持 60 秒临时激活。

**Architecture:** 时间判断在显示端本地完成（每 10 秒 `checkSleepMode()`），优先级 临时激活 > 深度睡眠 > 睡眠 > 正常。深度睡眠用全屏 `#sleepOverlay` 黑幕遮罩（z-index 999999）实现，不逐元素枚举隐藏。设置通过 `sendControl('sleepSettings')` 下发，服务端在 control 处理器持久化到 `displayStates[ip].sleep`（沿用 rotation/fit/volume 现有模式），显示端重启后 `handleRestoreState(state.sleep)` 恢复。控制端在显示控制面板加「睡眠模式」入口，弹窗设置框（SleepPanel）复用现有 `modal-mask` 弹窗模式。

**Tech Stack:** 原生 JS（无框架），WebSocket 控制消息，`config.json`（DataSnapshot）持久化，node:test + puppeteer 集成测试。

## Global Constraints

- 时间判断在**显示端本地**（各设备用自己本地时区），每 10 秒检查一次。
- 优先级：**临时激活 > 深度睡眠 > 睡眠 > 正常**。
- 深度睡眠用全屏黑幕遮罩实现，**不逐元素枚举隐藏**；`#sleepOverlay` z-index 必须为 `999999`（高于 `#monitorOverlay` 等全部覆盖层）。
- 时段跨天判定：`startHour > endHour` 时 `h >= startHour || h < endHour`，否则 `h >= startHour && h < endHour`。
- 睡眠/深度睡眠隐藏 `#mediaContainer` 并**暂停媒体**（视频 `pause()`，html 模式 `stopHtmlScroll()`）；恢复时续播（html `startHtmlScroll(mediaHtml, currentHtmlScroll)`，视频 `play().catch()`）。
- 不产生一大段 if-else-else if 链（AASC 规则）；状态与上一次不同才执行 DOM 操作，避免每 10 秒重复。
- hour 值 clamp 到 0-23；`enabled` 布尔化。
- 服务端持久化沿用现有模式：在 `server-app.js` control 处理器按 `data.action` 分支调用 `config.updateDisplayState(ip, partial)`。
- 代码用 `const/let`（display.html 现有代码风格），中文注释。
- 每个提交前运行：服务端/控制端文件 `node --check`；display.html 用内联脚本提取脚本检查。

---

### Task 1: 服务端配置字段与持久化

**Files:**
- Modify: `src/apps/server/modules/config/config-app-service.js:6-13`（`defaultDisplayState`）
- Modify: `src/apps/server/boot/server-app.js:3250-3275`（control 持久化分支）
- Modify: `docs/spec/config.md:54-61`（伪代码 `defaultDisplayState` 补 `sleep` 字段）

**Interfaces:**
- Consumes: 现有 `config.updateDisplayState(ip, partialState)`（config-app-service.js:161）与 `displayData.state`（server-app.js:2389）。
- Produces: `displayStates[ip].sleep`，形状 `{ enabled:false, startHour:23, endHour:8, deepStartHour:1, deepEndHour:6 }`。该字段随 `GET /api/device-settings/:displayId` 返回（server-app.js:1968，返回 `displayData.state` 或 `config.getDisplayState(savedIp)`），并在显示端连接时通过 `{...createDisplayState(), ...savedState}`（server-app.js:2389-2394）合并进 `displayData.state`。

- [ ] **Step 1: `defaultDisplayState` 追加 `sleep` 字段**

在 `/mnt/AASC/src/apps/server/modules/config/config-app-service.js` 第 12 行 `playlist: []` 后追加一行：

```js
const defaultDisplayState = {
    currentMedia: null,
    rotation: 0,
    fit: 'contain',
    crop: { x: 0, y: 0, width: 100, height: 100 },
    volume: 100,
    playlist: [],
    sleep: { enabled: false, startHour: 23, endHour: 8, deepStartHour: 1, deepEndHour: 6 }
};
```

- [ ] **Step 2: server-app.js control 处理器增加 `sleepSettings` 持久化分支**

在 `/mnt/AASC/src/apps/server/boot/server-app.js` 第 3272-3274 行 `controlMode`/`controlInput` 空分支（`} else if (data.action === 'controlMode' || data.action === 'controlInput') { ... }`）之后、第 3275 行 `sendToDisplay(displayId, data);` 之前，新增一个 `else if` 分支：

```js
                    } else if (data.action === 'sleepSettings') {
                        // 睡眠设置持久化：显示端刷新/重启后 restoreState 恢复
                        displayData.state.sleep = data.value;
                        config.updateDisplayState(displayData.ip, { sleep: data.value });
```

- [ ] **Step 3: 更新 `docs/spec/config.md` 伪代码**

在 `/mnt/AASC/docs/spec/config.md` 第 60 行 `playlist: []` 后追加：

```js
    sleep: { enabled: false, startHour: 23, endHour: 8, deepStartHour: 1, deepEndHour: 6 }
```

- [ ] **Step 4: 语法检查两个服务端文件**

Run:
```bash
node --check /mnt/AASC/src/apps/server/modules/config/config-app-service.js && node --check /mnt/AASC/src/apps/server/boot/server-app.js
```
Expected: 无输出（通过）。

- [ ] **Step 5: Commit**

```bash
git add src/apps/server/modules/config/config-app-service.js src/apps/server/boot/server-app.js docs/spec/config.md
git commit -m "feat(sleep): 服务端 displayStates 支持 sleep 字段并持久化 sleepSettings"
```

---

### Task 2: 显示端睡眠逻辑 + 集成测试

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Test: Create `tests/display-sleep-mode.test.js`
- Create: `docs/spec/display-sleep-mode.md`

**Interfaces:**
- Consumes: Task 1 产出的 `displayStates[ip].sleep`（经 `restoreState` 消息 `state.sleep` 到达显示端）。
- Produces（显示端全局可访问，供测试与后续任务使用）：
  - 状态：`sleepSettings`、`sleepState`（`'normal'|'sleep'|'deep'|'active'`）、`activationUntil`
  - 函数：`inSleepWindow(hour, start, end)`、`checkSleepMode()`、`applySleepState(state)`、`activateTemporarily()`
  - `handleControl` 新增 `case 'sleepSettings'` / `case 'sleepActivate'`
  - `handleRestoreState` 识别 `state.sleep` 并立即应用
  - `showMedia(data)` 入口调用 `activateTemporarily()`
  - 控制消息 ack 携带 `extraData.sleepState`（供 Task 3 控制端状态显示）

**测试前提：** `tests/display-sleep-mode.test.js` 与 `tests/display-native-bridge.test.js` 同模式，需要服务端运行在 `127.0.0.1:8081`（`npm start`）。驱动方式为 `page.evaluate` 直接调用显示端顶层函数（`function` 声明在 window 上，`let/const` 在全局词法作用域中，`page.evaluate` 均可访问）+ `MessageEvent` 注入 WS 消息。

- [ ] **Step 1: 写失败测试 `tests/display-sleep-mode.test.js`**

创建 `/mnt/AASC/tests/display-sleep-mode.test.js`：

```js
// 显示端睡眠模式集成测试：inSleepWindow 跨天判定 / checkSleepMode 状态机 /
// applySleepState DOM 操作 / handleControl('sleepSettings'|'sleepActivate') / handleRestoreState
// 运行：node tests/display-sleep-mode.test.js （需服务端运行在 127.0.0.1:8081）
const puppeteer = require('/mnt/AASC/node_modules/puppeteer');
const assert = require('assert');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium',
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // 捕获 WS 发送，验证 ack 携带 sleepState
  await page.evaluateOnNewDocument(() => {
    const OrigWS = window.WebSocket;
    window.__wsSends = [];
    window.__wsInstance = null;
    window.WebSocket = function(...args) {
      const ws = new OrigWS(...args);
      window.__wsInstance = ws;
      const origSend = ws.send.bind(ws);
      ws.send = function(data) {
        window.__wsSends.push(data);
        return origSend(data);
      };
      return ws;
    };
    window.WebSocket.prototype = OrigWS.prototype;
    Object.getOwnPropertyNames(OrigWS).forEach(k => {
      try { if (!(k in window.WebSocket)) window.WebSocket[k] = OrigWS[k]; } catch (e) {}
    });
  });

  await page.goto('https://127.0.0.1:8081/display', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.checkSleepMode === 'function', { timeout: 15000 });
  await page.waitForFunction(() => window.__wsInstance && window.__wsInstance.readyState === 1, { timeout: 15000 });

  // ---- 1. inSleepWindow 跨天 / 非跨天判定 ----
  const w = await page.evaluate(() => ({
    crossIn: inSleepWindow(23, 23, 8),
    crossLate: inSleepWindow(5, 23, 8),
    crossOut: inSleepWindow(12, 23, 8),
    normalIn: inSleepWindow(3, 1, 6),
    normalOut: inSleepWindow(9, 1, 6)
  }));
  assert.strictEqual(w.crossIn, true, '23:00 应落在跨天 23-8 内');
  assert.strictEqual(w.crossLate, true, '5:00 应落在跨天 23-8 内');
  assert.strictEqual(w.crossOut, false, '12:00 不应在 23-8 内');
  assert.strictEqual(w.normalIn, true, '3:00 应落在 1-6 内');
  assert.strictEqual(w.normalOut, false, '9:00 不应在 1-6 内');
  console.log('PASS: inSleepWindow 跨天/非跨天判定');

  // ---- 2. 睡眠时段：隐藏媒体容器、保留 UI（无黑幕）----
  await page.evaluate(() => {
    const h = new Date().getHours();
    sleepSettings = { enabled: true, startHour: h, endHour: h + 1, deepStartHour: -1, deepEndHour: -1 };
    checkSleepMode();
  });
  const sleep = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    overlay: document.getElementById('sleepOverlay').style.display
  }));
  assert.strictEqual(sleep.state, 'sleep', '当前时段应在睡眠状态');
  assert.strictEqual(sleep.media, 'none', '睡眠应隐藏媒体容器');
  assert.strictEqual(sleep.overlay, 'none', '睡眠不应显示黑幕');
  console.log('PASS: 睡眠模式隐藏媒体保留 UI');

  // ---- 3. 深度睡眠：全屏黑幕 + 隐藏媒体 ----
  await page.evaluate(() => {
    const h = new Date().getHours();
    sleepSettings = { enabled: true, startHour: 0, endHour: 24, deepStartHour: h, deepEndHour: h + 1 };
    checkSleepMode();
  });
  const deep = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    overlay: document.getElementById('sleepOverlay').style.display
  }));
  assert.strictEqual(deep.state, 'deep', '深度时段应优先于睡眠时段');
  assert.strictEqual(deep.media, 'none', '深度睡眠应隐藏媒体容器');
  assert.strictEqual(deep.overlay, 'block', '深度睡眠应显示全屏黑幕');
  console.log('PASS: 深度睡眠全屏黑幕（优先于睡眠）');

  // ---- 4. 临时激活：强制显示，黑幕移除 ----
  await page.evaluate(() => {
    activateTemporarily();
  });
  const active = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    overlay: document.getElementById('sleepOverlay').style.display,
    until: activationUntil > Date.now()
  }));
  assert.strictEqual(active.state, 'active', '临时激活应进入激活状态');
  assert.strictEqual(active.media, 'flex', '激活应显示媒体容器');
  assert.strictEqual(active.overlay, 'none', '激活应移除黑幕');
  assert.strictEqual(active.until, true, 'activationUntil 应为未来时间');
  console.log('PASS: 临时激活强制显示');

  // ---- 5. 未启用：强制回到 normal ----
  await page.evaluate(() => {
    sleepSettings = { enabled: false, startHour: 0, endHour: 24, deepStartHour: 0, deepEndHour: 24 };
    checkSleepMode();
  });
  const disabled = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    overlay: document.getElementById('sleepOverlay').style.display
  }));
  assert.strictEqual(disabled.state, 'normal', '未启用应回到 normal');
  assert.strictEqual(disabled.media, 'flex', 'normal 应显示媒体容器');
  assert.strictEqual(disabled.overlay, 'none', 'normal 不应有黑幕');
  console.log('PASS: 未启用睡眠时始终正常显示');

  // ---- 6. handleControl('sleepSettings') 接线 + ack 携带 sleepState ----
  // 先清零 activationUntil（步骤 4 的激活窗口未过期会覆盖成 active，干扰 deep 断言）
  await page.evaluate(() => {
    activationUntil = 0;
    const ws = window.__wsInstance;
    const h = new Date().getHours();
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'sleepSettings',
      value: { enabled: true, startHour: h, endHour: h + 1, deepStartHour: h, deepEndHour: h + 1 }
    }) }));
  });
  await new Promise(r => setTimeout(r, 300));
  const ctl = await page.evaluate(() => {
    const acks = window.__wsSends
      .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(m => m && m.type === 'commandAck' && m.commandType === 'control' && m.details === 'sleepSettings');
    const last = acks[acks.length - 1];
    return { state: sleepState, ackExtra: last && last.extraData ? last.extraData.sleepState : null };
  });
  assert.strictEqual(ctl.state, 'deep', 'handleControl 应应用睡眠设置并立即判定');
  assert.strictEqual(ctl.ackExtra, 'deep', 'ack 应携带当前 sleepState');
  console.log('PASS: handleControl(sleepSettings) 应用 + ack 携带 sleepState');

  // ---- 7. handleControl('sleepActivate') 接线 ----
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'sleepActivate'
    }) }));
  });
  await new Promise(r => setTimeout(r, 300));
  const act = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    overlay: document.getElementById('sleepOverlay').style.display
  }));
  assert.strictEqual(act.state, 'active', 'sleepActivate 应进入激活状态');
  assert.strictEqual(act.media, 'flex', '激活应显示媒体容器');
  console.log('PASS: handleControl(sleepActivate) 临时激活');

  // ---- 8. handleRestoreState(state.sleep) 恢复 ----
  // 先清零 activationUntil（步骤 7 的激活窗口未过期会覆盖成 active，干扰 deep 断言）
  await page.evaluate(() => {
    activationUntil = 0;
    const ws = window.__wsInstance;
    const h = new Date().getHours();
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'restoreState',
      state: { sleep: { enabled: true, startHour: h, endHour: h + 1, deepStartHour: h, deepEndHour: h + 1 } }
    }) }));
  });
  await new Promise(r => setTimeout(r, 300));
  const restored = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    overlay: document.getElementById('sleepOverlay').style.display
  }));
  assert.strictEqual(restored.state, 'deep', 'restoreState 应恢复睡眠设置并立即判定');
  assert.strictEqual(restored.overlay, 'block', '恢复后应显示黑幕');
  console.log('PASS: handleRestoreState(state.sleep) 恢复设置');

  await browser.close();
  console.log('ALL PASS: 显示端睡眠模式');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/display-sleep-mode.test.js`
Expected: FAIL（`checkSleepMode` 未定义，页面加载后无该函数）——这是预期的红灯，因为显示端尚未实现。

- [ ] **Step 3: 实现显示端睡眠逻辑**

3a. **HTML 遮罩层**：在 `/mnt/AASC/src/apps/web-mediacenter/ui/public/display.html` 第 36 行 `<audio id="ttsAudio" ...></audio>` 之后插入（必须在内联 `<script>` 之前，保证 `getElementById` 可取到）：

```html
    <div id="sleepOverlay" style="display:none;position:fixed;inset:0;background:#000;z-index:999999;"></div>
```

3b. **状态变量与函数**：在 `handleControl` 函数结束（第 2348 行 `}`）之后、`getPersistentDisplayId`（第 2350 行）之前，插入完整睡眠模式区块：

```js
        // ===== 睡眠模式：按时段自动隐藏媒体/UI，降低夜间干扰 =====
        // 时间在显示端本地判断（各设备用自己时区），每 10 秒检查一次。
        // 优先级：临时激活 > 深度睡眠 > 睡眠 > 正常。
        const sleepOverlay = document.getElementById('sleepOverlay');
        const mediaContainer = document.getElementById('mediaContainer');
        let sleepSettings = { enabled: false, startHour: 23, endHour: 8, deepStartHour: 1, deepEndHour: 6 };
        let sleepState = 'normal';   // 'normal' | 'sleep' | 'deep' | 'active'
        let activationUntil = 0;     // 临时激活截止时间戳

        // 跨天时段判定：startHour > endHour 时跨天（23-8），否则非跨天（1-6）
        function inSleepWindow(hour, start, end) {
            if (start > end) return hour >= start || hour < end;
            return hour >= start && hour < end;
        }

        // 小时值合法化：clamp 到 0-23
        function clampHour(h) {
            h = parseInt(h, 10);
            if (isNaN(h)) return 0;
            return Math.max(0, Math.min(23, h));
        }

        // 暂停媒体：视频暂停 + html 滚动暂停（图片无需处理）
        function pauseSleepMedia() {
            mediaVideo.pause();
            if (mediaHtml.style.display !== 'none') stopHtmlScroll();
        }

        // 恢复媒体：html 续滚动，视频续播（拦截自动播放限制）
        function resumeSleepMedia() {
            if (mediaHtml.style.display !== 'none') {
                startHtmlScroll(mediaHtml, currentHtmlScroll);
            } else if (mediaVideo.src) {
                mediaVideo.play().catch(e => console.log('恢复播放被阻止'));
            }
        }

        // 应用睡眠状态：深度全黑（遮罩盖全部覆盖层），睡眠隐藏媒体保 UI，正常/激活显示
        function applySleepState(state) {
            const prev = sleepState;
            sleepState = state;
            const isHidden = (state === 'sleep' || state === 'deep');
            sleepOverlay.style.display = (state === 'deep') ? 'block' : 'none';
            mediaContainer.style.display = isHidden ? 'none' : 'flex';
            if (isHidden) {
                pauseSleepMedia();
            } else if (prev === 'sleep' || prev === 'deep') {
                // 仅从隐藏态恢复时续播，避免重复 play
                resumeSleepMedia();
            }
        }

        // 10 秒定时检查：按优先级计算目标状态，状态变化才应用（避免每 10 秒重复 DOM 操作）
        function checkSleepMode() {
            let target = 'normal';
            if (sleepSettings.enabled) {
                const hour = new Date().getHours();
                if (Date.now() < activationUntil) {
                    target = 'active';
                } else if (inSleepWindow(hour, sleepSettings.deepStartHour, sleepSettings.deepEndHour)) {
                    target = 'deep';
                } else if (inSleepWindow(hour, sleepSettings.startHour, sleepSettings.endHour)) {
                    target = 'sleep';
                }
            }
            if (target !== sleepState) {
                applySleepState(target);
            }
        }

        // 临时激活：强制显示 60 秒，之后下一次检查恢复按时段隐藏
        function activateTemporarily() {
            activationUntil = Date.now() + 60000;
            applySleepState('active');
        }
```

3c. **`handleControl` 新增两个 case**：在 `case 'customCrop'`（第 2343-2346 行）之后、switch 结束 `}` 之前插入：

```js
                case 'sleepSettings':
                    // 应用控制端下发的睡眠设置（合法化小时值），立即判定并应用
                    {
                        const s = data.value || {};
                        sleepSettings = {
                            enabled: !!s.enabled,
                            startHour: clampHour(s.startHour),
                            endHour: clampHour(s.endHour),
                            deepStartHour: clampHour(s.deepStartHour),
                            deepEndHour: clampHour(s.deepEndHour)
                        };
                        checkSleepMode();
                    }
                    break;

                case 'sleepActivate':
                    activateTemporarily();
                    break;
```

3d. **控制消息 ack 携带 sleepState**：在 WS onmessage 分发处（第 2458-2462 行）把 `sendCommandAck('control', true, data.action)` 改为带 sleep 额外信息：

```js
                    if (data.type === 'control') {
                        handleControl(data);
                        if (data.action !== 'crop') {
                            // 睡眠设置/激活回传当前 sleepState，供控制端状态显示
                            let ackExtra = null;
                            if (data.action === 'sleepSettings' || data.action === 'sleepActivate') {
                                ackExtra = { sleepState: sleepState };
                            }
                            sendCommandAck('control', true, data.action, ackExtra);
                        }
```

3e. **`handleRestoreState` 恢复睡眠设置**：在 `handleRestoreState`（第 1121 行）中 `state.currentMedia` 分支之后插入：

```js
            if (state.sleep !== undefined) {
                sleepSettings = {
                    enabled: !!state.sleep.enabled,
                    startHour: clampHour(state.sleep.startHour),
                    endHour: clampHour(state.sleep.endHour),
                    deepStartHour: clampHour(state.sleep.deepStartHour),
                    deepEndHour: clampHour(state.sleep.deepEndHour)
                };
                checkSleepMode();
            }
```

3f. **`showMedia` 入口自动激活**：在 `showMedia` 函数开头（第 2140 行 `function showMedia(data) {` 后第一行）插入：

```js
            // 控制端下发媒体自动进入 60 秒激活窗口（睡眠中操作即时可见）
            activateTemporarily();
```

3g. **启动时立即检查 + 定时**：在 `connectWebSocket();`（第 2535 行）之后插入：

```js
        checkSleepMode();
        setInterval(checkSleepMode, 10000);
```

- [ ] **Step 4: 内联脚本语法检查**

Run:
```bash
node -e 'const fs=require("fs"),os=require("os"),p=require("path"),{execFileSync}=require("child_process");const s=fs.readFileSync("/mnt/AASC/src/apps/web-mediacenter/ui/public/display.html","utf8");const blocks=[...s.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);blocks.forEach((b,i)=>{const f=p.join(os.tmpdir(),"d"+i+".js");fs.writeFileSync(f,b);execFileSync("node",["--check",f]);console.log("OK inline script block",i,b.length);});'
```
Expected: 每个内联 `<script>` 块打印 `OK inline script block N <长度>`，无报错。

- [ ] **Step 5: 运行测试确认通过**

Run: `node tests/display-sleep-mode.test.js`
Expected: 依次打印 `PASS: ...`，最后 `ALL PASS: 显示端睡眠模式`，退出码 0。

- [ ] **Step 6: 编写 `docs/spec/display-sleep-mode.md` 伪代码**

创建 `/mnt/AASC/docs/spec/display-sleep-mode.md`：

```markdown
# 显示端睡眠模式 — 实现文档

## 概述

显示端（`display.html`）按本地时段自动隐藏媒体（睡眠）或整屏黑幕（深度睡眠），降低夜间干扰。时间判断在显示端本地，每 10 秒检查一次；优先级 临时激活 > 深度睡眠 > 睡眠 > 正常。

## 状态模型

```
sleepSettings = { enabled, startHour, endHour, deepStartHour, deepEndHour }
sleepState    = 'normal' | 'sleep' | 'deep' | 'active'
activationUntil = 临时激活截止时间戳

function inSleepWindow(hour, start, end):
    若 start > end:  return hour >= start || hour < end    # 跨天（23-8）
    否则:            return hour >= start && hour < end    # 非跨天（1-6）

function clampHour(h):
    h = parseInt(h); 若 isNaN(h) 返回 0
    返回 clamp(h, 0, 23)

function pauseSleepMedia():
    mediaVideo.pause()
    若 mediaHtml 显示中: stopHtmlScroll()

function resumeSleepMedia():
    若 mediaHtml 显示中: startHtmlScroll(mediaHtml, currentHtmlScroll)
    否则若 mediaVideo.src 非空: mediaVideo.play().catch(...)

function applySleepState(state):
    prev = sleepState;  sleepState = state
    isHidden = (state == 'sleep' || state == 'deep')
    #sleepOverlay.display = (state == 'deep') ? 'block' : 'none'
    #mediaContainer.display = isHidden ? 'none' : 'flex'
    若 isHidden: pauseSleepMedia()
    否则若 prev 为 'sleep'/'deep': resumeSleepMedia()   # 仅隐藏态恢复时续播

function checkSleepMode():          # 每 10 秒，setInterval
    target = 'normal'
    若 sleepSettings.enabled:
        hour = now.getHours()
        若 now < activationUntil:  target = 'active'
        否则若 inSleepWindow(hour, deepStartHour, deepEndHour): target = 'deep'
        否则若 inSleepWindow(hour, startHour, endHour):         target = 'sleep'
    若 target != sleepState:  applySleepState(target)     # 状态变化才操作 DOM

function activateTemporarily():     # 控制端按钮 / showMedia 触发
    activationUntil = now + 60000
    applySleepState('active')
```

## 触发链路

```
控制端 SleepPanel 保存
  → sendControl('sleepSettings', settings)
  → 服务端 control 处理器持久化 displayStates[ip].sleep
  → 显示端 handleControl('sleepSettings') → 应用设置 + checkSleepMode()
  → ack 携带 extraData.sleepState → 控制端更新弹窗状态行

控制端「临时激活」/ 下发媒体
  → sendControl('sleepActivate') / 显示端 showMedia() 入口 activateTemporarily()
  → 60 秒激活窗口强制显示，之后 checkSleepMode() 恢复按时段隐藏

显示端刷新/重启
  → 服务端 restoreState(state) → handleRestoreState 读 state.sleep → checkSleepMode() 立即应用
```

## 媒体暂停/恢复

| 模式 | 睡眠/深度睡眠 | 恢复（normal/active） |
|------|--------------|----------------------|
| 视频 | `mediaVideo.pause()` | `mediaVideo.play().catch(...)` |
| html（iframe 滚动） | `stopHtmlScroll()` | `startHtmlScroll(mediaHtml, currentHtmlScroll)` |
| 图片 | 无需处理 | 无需处理 |

## 遮罩层

`#sleepOverlay`（`position:fixed;inset:0;background:#000;z-index:999999`）：深度睡眠时 `display:block` 全屏黑幕，z-index 高于 `#monitorOverlay`（render-display 监控层）等全部覆盖层；睡眠/正常/激活时 `display:none`。

## 消息协议

| 消息 | 值 | 处理 |
|------|----|------|
| `control` / `sleepSettings` | `{enabled,startHour,endHour,deepStartHour,deepEndHour}` | 应用设置 + checkSleepMode + ack(`extraData.sleepState`) |
| `control` / `sleepActivate` | 无 | `activateTemporarily()` + ack(`extraData.sleepState`) |
| `restoreState` | `state.sleep` | 恢复设置 + checkSleepMode |
| `GET /api/device-settings/:displayId` | — | 返回 `settings.sleep`（控制端填充弹窗） |
```

（注意：以上 ` ```markdown ` 与结尾 ` ``` ` 之间的内容为写入文件的全部内容，**结尾的 ` ``` ` 本身不写入文件**。）

- [ ] **Step 7: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/display.html tests/display-sleep-mode.test.js docs/spec/display-sleep-mode.md
git commit -m "feat(sleep): 显示端睡眠模式（时段判定/深度黑幕/临时激活）+ 集成测试"
```

---

### Task 3: 控制端睡眠模式设置框（SleepPanel）

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`（显示控制面板入口按钮）
- Modify: `src/apps/web-mediacenter/ui/public/js/controls.js`（`showSleepModePanel` 弹窗）
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`（commandAck 睡眠状态钩子）

**Interfaces:**
- Consumes: Task 2 的 `extraData.sleepState` ack；`GET /api/device-settings/:displayId` 返回的 `settings.sleep`；`window.WebSocketManager.sendControl(action, value)`（websocket.js:372）；`window.currentDisplayId`。
- Produces: `Controls.showSleepModePanel()`（upload.html 按钮 onclick 引用）、`Controls.updateSleepStatus(state)`（websocket.js commandAck 钩子调用）。

- [ ] **Step 1: controls.js 增加 `showSleepModePanel` 与 `updateSleepStatus`**

在 `/mnt/AASC/src/apps/web-mediacenter/ui/public/js/controls.js` 的 `showHtmlModePanel` 方法（第 105 行 `},`）之后插入两个方法（注意末尾逗号）：

```js
    // 睡眠模式设置弹窗：按时段隐藏媒体/UI，降低夜间干扰；设置按当前选中显示端生效
    showSleepModePanel() {
        const displayId = window.currentDisplayId;
        if (!displayId) {
            if (window.showToast) window.showToast('未选中显示端', 'warning');
            return;
        }
        const hourOptions = () => {
            let html = '';
            for (let i = 0; i <= 23; i++) html += `<option value="${i}">${i} 时</option>`;
            return html;
        };
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="playlist-settings-dialog">
                <div class="dialog-title">睡眠模式</div>
                <div class="dialog-body">
                    <div class="settings-row">
                        <label><input type="checkbox" id="sleepPanelEnabled"> 启用睡眠模式</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">睡眠时段</span>
                        <select id="sleepPanelStart">${hourOptions()}</select>
                        <span>至</span>
                        <select id="sleepPanelEnd">${hourOptions()}</select>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">深度睡眠时段</span>
                        <select id="sleepPanelDeepStart">${hourOptions()}</select>
                        <span>至</span>
                        <select id="sleepPanelDeepEnd">${hourOptions()}</select>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">临时激活</span>
                        <button class="btn-confirm" id="sleepPanelActivateBtn">激活 60 秒</button>
                    </div>
                    <div id="sleepPanelStatus" style="font-size:12px;color:rgba(255,255,255,0.5);">当前: 正常</div>
                </div>
                <div class="dialog-footer">
                    <button class="btn-cancel" id="sleepPanelCancelBtn">取消</button>
                    <button class="btn-confirm" id="sleepPanelSaveBtn">保存</button>
                </div>
            </div>`;
        mask.querySelector('#sleepPanelCancelBtn').addEventListener('click', () => mask.remove());
        mask.querySelector('#sleepPanelActivateBtn').addEventListener('click', () => {
            if (window.WebSocketManager) window.WebSocketManager.sendControl('sleepActivate');
        });
        mask.querySelector('#sleepPanelSaveBtn').addEventListener('click', () => {
            const settings = {
                enabled: mask.querySelector('#sleepPanelEnabled').checked,
                startHour: parseInt(mask.querySelector('#sleepPanelStart').value, 10),
                endHour: parseInt(mask.querySelector('#sleepPanelEnd').value, 10),
                deepStartHour: parseInt(mask.querySelector('#sleepPanelDeepStart').value, 10),
                deepEndHour: parseInt(mask.querySelector('#sleepPanelDeepEnd').value, 10)
            };
            mask.remove();
            if (window.WebSocketManager) window.WebSocketManager.sendControl('sleepSettings', settings);
        });
        document.body.appendChild(mask);
        // 填充当前选中显示端的已存设置（无则用默认值）
        fetch('/api/device-settings/' + displayId)
            .then(r => r.json())
            .then(d => {
                const s = (d.settings && d.settings.sleep) || { enabled: false, startHour: 23, endHour: 8, deepStartHour: 1, deepEndHour: 6 };
                mask.querySelector('#sleepPanelEnabled').checked = !!s.enabled;
                mask.querySelector('#sleepPanelStart').value = s.startHour;
                mask.querySelector('#sleepPanelEnd').value = s.endHour;
                mask.querySelector('#sleepPanelDeepStart').value = s.deepStartHour;
                mask.querySelector('#sleepPanelDeepEnd').value = s.deepEndHour;
            })
            .catch(() => {});
    },

    // 显示端回传当前睡眠状态，更新弹窗状态行（弹窗未打开时为空操作）
    updateSleepStatus(state) {
        const el = document.getElementById('sleepPanelStatus');
        if (!el) return;
        const names = { normal: '正常', sleep: '睡眠中', deep: '深度睡眠中', active: '临时激活中' };
        el.textContent = '当前: ' + (names[state] || state);
    },
```

- [ ] **Step 2: upload.html 显示控制面板加入口按钮**

在 `/mnt/AASC/src/apps/web-mediacenter/ui/public/upload.html` 第 169 行 `</div>`（画面填充 control-item 结束）之后插入：

```html
                <div class="control-item">
                    <label>睡眠模式</label>
                    <div class="control-buttons">
                        <button class="control-btn" onclick="Controls.showSleepModePanel()" title="按时段隐藏媒体/UI，降低夜间干扰">设置</button>
                    </div>
                </div>
```

- [ ] **Step 3: websocket.js commandAck 钩子更新睡眠状态行**

在 `/mnt/AASC/src/apps/web-mediacenter/ui/public/js/websocket.js` 第 299-308 行 `commandAck` 分支内、`updateCropDisplayInfo` 调用之后插入：

```js
            if (data.commandType === 'control' && data.extraData && data.extraData.sleepState && window.Controls) {
                window.Controls.updateSleepStatus(data.extraData.sleepState);
            }
```

- [ ] **Step 4: 语法检查控制端文件**

Run:
```bash
node --check /mnt/AASC/src/apps/web-mediacenter/ui/public/js/controls.js && node --check /mnt/AASC/src/apps/web-mediacenter/ui/public/js/websocket.js
```
Expected: 无输出（通过）。

- [ ] **Step 5: 手动验证（浏览器）**

启动服务端 `npm start`，打开控制端 `https://127.0.0.1:8081/upload`：
1. 选中一个显示端 → 「显示控制」面板出现「睡眠模式 / 设置」按钮。
2. 点击按钮弹出设置框；「保存」→ 显示端按设置进入睡眠/深度睡眠/正常；弹窗「当前」状态行更新。
3. 「激活 60 秒」→ 显示端强制显示，状态行显示「临时激活中」。
4. 刷新显示端页面 → 设置恢复（restoreState）。
5. 睡眠时段内下发媒体 → 显示端自动激活显示 60 秒后恢复隐藏。

- [ ] **Step 6: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/upload.html src/apps/web-mediacenter/ui/public/js/controls.js src/apps/web-mediacenter/ui/public/js/websocket.js
git commit -m "feat(sleep): 控制端睡眠模式设置弹窗 + 状态显示钩子"
```

---

### Task 4: 文档与收尾

**Files:**
- Modify: `docs/design.md`（索引加睡眠模式条目）
- Modify: `docs/spec.md`（索引加睡眠模式条目）
- Create: `docs/task/20260816_睡眠模式.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

**Interfaces:**
- Consumes: Task 1-3 全部完成后的实现事实。

- [ ] **Step 1: `docs/design.md` 索引加条目**

在 `/mnt/AASC/docs/design.md` 表格中 `render-display 文字内嵌` 行后追加：

```
| 显示端睡眠模式 | [display-sleep-mode.md](design/display-sleep-mode.md) | 按时段隐藏媒体/深度全黑/60s 临时激活，控制端可配 |
```

- [ ] **Step 2: `docs/spec.md` 索引加条目**

在 `/mnt/AASC/docs/spec.md` 功能模块实现表格末尾（`| 上传功能 | ...` 行后）追加：

```
| 显示端睡眠模式 | [display-sleep-mode.md](spec/display-sleep-mode.md) | 时段判定/深度黑幕/临时激活/控制端配置 |
```

- [ ] **Step 3: 创建任务文档 `docs/task/20260816_睡眠模式.md`**

创建 `/mnt/AASC/docs/task/20260816_睡眠模式.md`，沿用仓库 task 文档格式（标题 + 任务概述 + 任务状态 + 设计需求 + 功能列表 + 自测用例 + 风险评估 + 预计工时）：

```markdown
# 显示端睡眠模式任务

## 任务概述

为显示端（display.html）增加睡眠模式（按时段隐藏媒体、保留 UI）与深度睡眠模式（整屏黑幕），控制端可独立配置各显示端并支持 60 秒临时激活。

## 任务状态：✅ 已完成

## 设计需求

参考：[design/display-sleep-mode.md](../design/display-sleep-mode.md)

## 功能列表

### 1. ✅ 显示端睡眠判定
- 每 10 秒本地检查，优先级 临时激活 > 深度睡眠 > 睡眠 > 正常
- 跨天时段（23-8 / 1-6）判定：startHour > endHour 时 h >= start || h < end

### 2. ✅ 睡眠 / 深度睡眠
- 睡眠：隐藏 #mediaContainer、视频暂停、保留 UI 覆盖层
- 深度睡眠：显示 #sleepOverlay 全屏黑幕（z-index 999999），媒体与 UI 全隐藏

### 3. ✅ 临时激活
- 控制端按钮 / 下发媒体自动触发，强制显示 60 秒后恢复按时段隐藏

### 4. ✅ 控制端配置
- 显示控制面板「睡眠模式」入口 + 弹窗设置框（启用开关 + 时段 + 临时激活 + 状态行）
- 设置按当前选中显示端生效并持久化到 displayStates[ip].sleep

## 受影响模块

- display.html / upload.html / js/controls.js / js/websocket.js
- config-app-service.js / server-app.js
- 新增 docs/spec/display-sleep-mode.md、tests/display-sleep-mode.test.js

## 自测用例

- node tests/display-sleep-mode.test.js（需服务端运行）：跨天判定 / 睡眠隐藏 / 深度黑幕 / 临时激活 / 未启用 / handleControl 接线 + ack / restoreState 恢复
- 真机：睡眠时段隐藏媒体保 UI、深度全黑、60 秒恢复、媒体自动激活、刷新后设置恢复、跨天边界、视频恢复续播

## 风险评估

- 深度睡眠黑幕需 z-index 高于全部覆盖层（999999）
- 视频恢复受浏览器自动播放策略限制，play() 需 catch 拦截
- 设置持久化依赖服务端 control 处理器分支，缺失则刷新后不恢复

## 预计工时

- 显示端判定/遮罩/激活：1.5h
- 控制端弹窗设置框：1.5h
- 服务端配置字段：0.5h
- 文档更新：0.5h
- 真机自测：1h
- 合计：**5h**
```

- [ ] **Step 4: 更新 `docs/todo.md`**

将「显示端睡眠模式」从待办移除（若存在）。

- [ ] **Step 5: 更新 `changelog.md`**

在文件顶部「新需求」区追加：

```
## 睡眠模式（2026-08-16）
- 显示端按时段自动隐藏媒体（睡眠）或整屏黑幕（深度睡眠），视频暂停、恢复续播
- 控制端显示控制面板新增「睡眠模式」入口与设置弹窗，按显示端独立配置并持久化
- 60 秒临时激活：控制端按钮 / 下发媒体自动触发
- 改动：display.html / upload.html / js/controls.js / js/websocket.js / config-app-service.js / server-app.js / docs/spec/display-sleep-mode.md / tests/display-sleep-mode.test.js
```

- [ ] **Step 6: 全量回归 + Commit**

Run: `node tests/display-sleep-mode.test.js && node --check src/apps/server/modules/config/config-app-service.js && node --check src/apps/server/boot/server-app.js`
Expected: `ALL PASS` + 两个服务端文件无语法错误。

```bash
git add docs/design.md docs/spec.md docs/task/20260816_睡眠模式.md docs/todo.md changelog.md
git commit -m "docs: 睡眠模式设计/实现文档、任务记录、changelog"
```
