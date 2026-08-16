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
    activationUntil = 0;   // 清零页面加载时 showMedia 触发的 60 秒激活窗口
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
    activationUntil = 0;   // 清零页面加载时 showMedia 触发的 60 秒激活窗口
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
