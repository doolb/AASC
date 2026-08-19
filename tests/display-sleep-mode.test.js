// 显示端睡眠模式集成测试：inSleepWindow 跨天判定 / checkSleepMode 状态机 /
// applySleepState DOM 操作 / handleControl('sleepSettings'|'sleepActivate'|'sleepOverride') / handleRestoreState
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

  // ---- 0. 默认开启 + 页面加载不自动打开激活窗口 ----
  const loadState = await page.evaluate(() => ({ enabled: sleepSettings.enabled, until: activationUntil }));
  assert.strictEqual(loadState.enabled, true, '睡眠模式默认开启');
  assert.strictEqual(loadState.until, 0, '页面加载恢复持久化媒体不应打开 60 秒激活窗口');
  // 关闭睡眠开关，保证后续「正常」断言不受默认时段影响（默认开启下夜间加载可能判定为 sleep/deep）
  await page.evaluate(() => { sleepSettings = { ...sleepSettings, enabled: false }; checkSleepMode(); });
  const normalState = await page.evaluate(() => ({ state: sleepState }));
  assert.strictEqual(normalState.state, 'normal', '关闭睡眠后应回到 normal');
  console.log('PASS: 睡眠默认开启 + 加载不激活');

  // ---- 0.5 连接即上报 sleepState ----
  const reports = await page.evaluate(() => window.__wsSends
    .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
    .filter(m => m && m.type === 'sleepStateReport'));
  assert.ok(reports.length > 0, '连接成功后应上报 sleepState');
  console.log('PASS: 连接即上报 sleepState');

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

  // ---- 2. 睡眠时段：只遮住媒体，保留 UI 与媒体容器布局 ----
  await page.evaluate(() => {
    const h = new Date().getHours();
    sleepSettings = { enabled: true, startHour: h, endHour: h + 1, deepStartHour: -1, deepEndHour: -1 };
    checkSleepMode();
  });
  const sleep = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display,
    mediaSize: [document.getElementById('mediaContainer').clientWidth, document.getElementById('mediaContainer').clientHeight]
  }));
  assert.strictEqual(sleep.state, 'sleep', '当前时段应在睡眠状态');
  assert.notStrictEqual(sleep.media, 'none', '睡眠不应隐藏媒体容器');
  assert.strictEqual(sleep.mediaOverlay, 'block', '睡眠应显示媒体区域遮罩');
  assert.strictEqual(sleep.uiOverlay, 'none', '睡眠不应显示 UI 全屏遮罩');
  assert.ok(sleep.mediaSize[0] > 0 && sleep.mediaSize[1] > 0, '睡眠期间媒体容器应保持有效尺寸');
  console.log('PASS: 睡眠模式只遮媒体并保持布局');

  // ---- 3. 深度睡眠：只显示 UI 全屏遮罩，媒体容器仍保持布局 ----
  await page.evaluate(() => {
    const h = new Date().getHours();
    sleepSettings = { enabled: true, startHour: 0, endHour: 24, deepStartHour: h, deepEndHour: h + 1 };
    checkSleepMode();
  });
  const deep = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display,
    zIndex: getComputedStyle(document.getElementById('uiSleepOverlay')).zIndex,
    mediaSize: [document.getElementById('mediaContainer').clientWidth, document.getElementById('mediaContainer').clientHeight]
  }));
  assert.strictEqual(deep.state, 'deep', '深度时段应优先于睡眠时段');
  assert.notStrictEqual(deep.media, 'none', '深度睡眠不应隐藏媒体容器');
  assert.strictEqual(deep.mediaOverlay, 'none', '深度睡眠不应重复显示媒体遮罩');
  assert.strictEqual(deep.uiOverlay, 'block', '深度睡眠应显示 UI 全屏遮罩');
  assert.strictEqual(deep.zIndex, '999999', '深度睡眠 UI 遮罩 z-index 应为 999999');
  assert.ok(deep.mediaSize[0] > 0 && deep.mediaSize[1] > 0, '深度睡眠期间媒体容器应保持有效尺寸');
  console.log('PASS: 深度睡眠只显示 UI 全屏遮罩');

  // ---- 4. 临时激活：强制显示，移除两个遮罩 ----
  await page.evaluate(() => {
    activateTemporarily();
  });
  const active = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display,
    until: activationUntil > Date.now()
  }));
  assert.strictEqual(active.state, 'active', '临时激活应进入激活状态');
  assert.notStrictEqual(active.media, 'none', '激活应保持媒体容器显示');
  assert.strictEqual(active.mediaOverlay, 'none', '激活应移除媒体遮罩');
  assert.strictEqual(active.uiOverlay, 'none', '激活应移除 UI 遮罩');
  assert.strictEqual(active.until, true, 'activationUntil 应为未来时间');
  console.log('PASS: 临时激活强制显示');

  // ---- 5. 未启用：强制回到 normal ----
  // 先清零 activationUntil（步骤 4 的激活窗口未过期会覆盖成 active——激活与启用开关无关）
  await page.evaluate(() => {
    activationUntil = 0;
    sleepSettings = { enabled: false, startHour: 0, endHour: 24, deepStartHour: 0, deepEndHour: 24 };
    checkSleepMode();
  });
  const disabled = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display
  }));
  assert.strictEqual(disabled.state, 'normal', '未启用应回到 normal');
  assert.notStrictEqual(disabled.media, 'none', 'normal 应保持媒体容器显示');
  assert.strictEqual(disabled.mediaOverlay, 'none', 'normal 不应显示媒体遮罩');
  assert.strictEqual(disabled.uiOverlay, 'none', 'normal 不应显示 UI 遮罩');
  console.log('PASS: 未启用睡眠时始终正常显示');

  // ---- 6. handleControl('sleepSettings') 接线 + ack 携带 sleepState ----
  // 先清零 activationUntil（步骤 4 的激活窗口未过期会覆盖成 active，干扰 deep 断言）
  await page.evaluate(() => {
    activationUntil = 0;
    const ws = window.__wsInstance;
    const h = new Date().getHours();
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'sleepSettings',
      value: { enabled: true, startHour: h, endHour: (h + 23) % 24, deepStartHour: h, deepEndHour: (h + 23) % 24 }
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
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display
  }));
  assert.strictEqual(act.state, 'active', 'sleepActivate 应进入激活状态');
  assert.notStrictEqual(act.media, 'none', '激活应保持媒体容器显示');
  assert.strictEqual(act.mediaOverlay, 'none', '激活应移除媒体遮罩');
  assert.strictEqual(act.uiOverlay, 'none', '激活应移除 UI 遮罩');
  console.log('PASS: handleControl(sleepActivate) 临时激活');

  // ---- 8. 临时激活过期：60 秒后自动恢复按时段隐藏 ----
  // 步骤 6/7 留下的 sleepSettings 为 { enabled:true, startHour:h, endHour:h+1, deepStartHour:h, deepEndHour:h+1 }，
  // 激活窗口过期后 checkSleepMode() 应恢复为 'deep'（UI 遮罩重新显示）
  await page.evaluate(() => {
    activationUntil = Date.now() - 1;   // 模拟激活窗口已过期
    checkSleepMode();
  });
  const expired = await page.evaluate(() => ({
    state: sleepState,
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display
  }));
  assert.strictEqual(expired.state, 'deep', '激活窗口过期后应恢复深度睡眠');
  assert.strictEqual(expired.mediaOverlay, 'none', '过期恢复后不应显示媒体遮罩');
  assert.strictEqual(expired.uiOverlay, 'block', '过期恢复后应重新显示 UI 遮罩');
  console.log('PASS: 临时激活 60 秒后自动恢复深度睡眠');

  // ---- 9. handleRestoreState(state.sleep) 恢复 ----
  // 先清零 activationUntil（步骤 7 的激活窗口未过期会覆盖成 active，干扰 deep 断言）
  await page.evaluate(() => {
    activationUntil = 0;
    const ws = window.__wsInstance;
    const h = new Date().getHours();
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'restoreState',
      state: { sleep: { enabled: true, startHour: h, endHour: (h + 23) % 24, deepStartHour: h, deepEndHour: (h + 23) % 24 } }
    }) }));
  });
  await new Promise(r => setTimeout(r, 300));
  const restored = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display
  }));
  assert.strictEqual(restored.state, 'deep', 'restoreState 应恢复睡眠设置并立即判定');
  assert.strictEqual(restored.mediaOverlay, 'none', '恢复深度睡眠后不应显示媒体遮罩');
  assert.strictEqual(restored.uiOverlay, 'block', '恢复深度睡眠后应显示 UI 遮罩');
  console.log('PASS: handleRestoreState(state.sleep) 恢复设置');

  // ---- 10. handleControl('sleepOverride', 'sleep') 手动睡眠 + ack ----
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'sleepOverride', value: 'sleep'
    }) }));
  });
  await new Promise(r => setTimeout(r, 300));
  const ovrSleep = await page.evaluate(() => {
    const acks = window.__wsSends
      .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(m => m && m.type === 'commandAck' && m.commandType === 'control' && m.details === 'sleepOverride');
    const last = acks[acks.length - 1];
    return { state: sleepState, media: document.getElementById('mediaContainer').style.display, mediaOverlay: document.getElementById('mediaSleepOverlay').style.display, uiOverlay: document.getElementById('uiSleepOverlay').style.display, ackExtra: last && last.extraData ? last.extraData.sleepState : null };
  });
  assert.strictEqual(ovrSleep.state, 'sleep', 'sleepOverride=sleep 应进入睡眠状态');
  assert.notStrictEqual(ovrSleep.media, 'none', '手动睡眠不应隐藏媒体容器');
  assert.strictEqual(ovrSleep.mediaOverlay, 'block', '手动睡眠应显示媒体遮罩');
  assert.strictEqual(ovrSleep.uiOverlay, 'none', '手动睡眠不应显示 UI 遮罩');
  assert.strictEqual(ovrSleep.ackExtra, 'sleep', 'sleepOverride ack 应携带当前 sleepState');
  console.log('PASS: handleControl(sleepOverride=sleep) 手动睡眠 + ack');

  // ---- 11. handleControl('sleepOverride', 'deep') 手动深度睡眠 ----
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'sleepOverride', value: 'deep'
    }) }));
  });
  await new Promise(r => setTimeout(r, 300));
  const ovrDeep = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display
  }));
  assert.strictEqual(ovrDeep.state, 'deep', 'sleepOverride=deep 应进入深度睡眠');
  assert.notStrictEqual(ovrDeep.media, 'none', '手动深度不应隐藏媒体容器');
  assert.strictEqual(ovrDeep.mediaOverlay, 'none', '手动深度不应显示媒体遮罩');
  assert.strictEqual(ovrDeep.uiOverlay, 'block', '手动深度应显示 UI 遮罩');
  console.log('PASS: handleControl(sleepOverride=deep) 手动深度睡眠');

  // ---- 12. 手动覆盖与启用开关无关：enabled=false 仍保持手动深度 ----
  await page.evaluate(() => {
    sleepSettings = { enabled: false, startHour: 0, endHour: 24, deepStartHour: 0, deepEndHour: 24 };
    checkSleepMode();
  });
  const manualIndependent = await page.evaluate(() => ({
    state: sleepState,
    overlay: document.getElementById('uiSleepOverlay').style.display
  }));
  assert.strictEqual(manualIndependent.state, 'deep', 'enabled=false 时手动覆盖仍生效');
  assert.strictEqual(manualIndependent.overlay, 'block', '手动深度 UI 遮罩应保持显示');
  console.log('PASS: 手动覆盖不依赖启用开关');

  // ---- 13. 下发媒体/临时激活取消手动覆盖（activateTemporarily 清 manualSleepMode）----
  await page.evaluate(() => { activateTemporarily(); });
  const ovrActive = await page.evaluate(() => ({
    state: sleepState,
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display,
    manual: manualSleepMode
  }));
  assert.strictEqual(ovrActive.state, 'active', '临时激活应进入激活状态');
  assert.strictEqual(ovrActive.mediaOverlay, 'none', '激活应移除媒体遮罩');
  assert.strictEqual(ovrActive.uiOverlay, 'none', '激活应移除 UI 遮罩');
  assert.strictEqual(ovrActive.manual, null, '临时激活应取消手动覆盖（manualSleepMode=null）');
  await page.evaluate(() => {
    activationUntil = Date.now() - 1;   // 模拟激活窗口过期
    checkSleepMode();
  });
  const ovrBack = await page.evaluate(() => ({
    state: sleepState,
    overlay: document.getElementById('uiSleepOverlay').style.display
  }));
  assert.strictEqual(ovrBack.state, 'normal', '激活过期后不再回落手动覆盖（已取消），enabled=false 按 normal');
  assert.strictEqual(ovrBack.overlay, 'none', '取消覆盖后正常态无 UI 遮罩');
  console.log('PASS: 下发媒体取消手动覆盖，过期不再回落');

  // ---- 14. handleControl('sleepOverride', 'normal') 恢复正常 ----
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'sleepOverride', value: 'normal'
    }) }));
  });
  await new Promise(r => setTimeout(r, 300));
  const ovrNormal = await page.evaluate(() => ({
    state: sleepState,
    media: document.getElementById('mediaContainer').style.display,
    mediaOverlay: document.getElementById('mediaSleepOverlay').style.display,
    uiOverlay: document.getElementById('uiSleepOverlay').style.display
  }));
  assert.strictEqual(ovrNormal.state, 'normal', 'sleepOverride=normal 应恢复正常显示');
  assert.notStrictEqual(ovrNormal.media, 'none', '正常应保持媒体容器显示');
  assert.strictEqual(ovrNormal.mediaOverlay, 'none', '正常不应显示媒体遮罩');
  assert.strictEqual(ovrNormal.uiOverlay, 'none', '正常不应显示 UI 遮罩');
  console.log('PASS: handleControl(sleepOverride=normal) 恢复正常');

  // ---- 15. 状态变化后上报匹配当前 sleepState ----
  await page.evaluate(() => { activateTemporarily(); });
  await new Promise(r => setTimeout(r, 200));
  const lastReport = await page.evaluate(() => {
    const rs = window.__wsSends
      .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(m => m && m.type === 'sleepStateReport');
    const last = rs[rs.length - 1];
    return { reported: last ? last.sleepState : null, state: sleepState };
  });
  assert.strictEqual(lastReport.reported, lastReport.state, '状态变化后上报应匹配当前 sleepState');
  console.log('PASS: 状态变化后上报 sleepState');

  // ---- 16. restoreState isPlaying=false：控制端暂停的视频重连后保持暂停（不自动播放）----
  // 关闭睡眠，避免 sleep/deep 遮罩状态干扰视频判定
  await page.evaluate(() => {
    activationUntil = 0;
    sleepSettings = { enabled: false, startHour: 0, endHour: 24, deepStartHour: 0, deepEndHour: 24 };
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'restoreState',
      state: {
        currentMedia: { type: 'base64', mediaType: 'video', data: '', fileName: 'test.mp4', mimeType: 'video/mp4' },
        isPlaying: false
      }
    }) }));
  });
  await new Promise(r => setTimeout(r, 500));
  const pausedRestore = await page.evaluate(() => {
    const pr = window.__wsSends
      .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(m => m && m.type === 'playStateReport');
    const last = pr[pr.length - 1];
    return { paused: mediaVideo.paused, display: mediaVideo.style.display, reported: last ? last.isPlaying : null };
  });
  assert.strictEqual(pausedRestore.paused, true, 'restoreState isPlaying=false 应保持暂停（不自动播放）');
  assert.strictEqual(pausedRestore.display, 'block', '暂停恢复也应显示视频容器');
  assert.strictEqual(pausedRestore.reported, false, '恢复暂停后应上报 playStateReport isPlaying=false');
  console.log('PASS: restoreState isPlaying=false 恢复暂停');

  // ---- 17. restoreState isPlaying=true：视频恢复应播放并上报 true ----
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'restoreState',
      state: {
        currentMedia: { type: 'base64', mediaType: 'video', data: '', fileName: 'test.mp4', mimeType: 'video/mp4' },
        isPlaying: true
      }
    }) }));
  });
  await new Promise(r => setTimeout(r, 300));
  const playingRestore = await page.evaluate(() => {
    const pr = window.__wsSends
      .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(m => m && m.type === 'playStateReport');
    const last = pr[pr.length - 1];
    return { reported: last ? last.isPlaying : null };
  });
  assert.strictEqual(playingRestore.reported, true, 'restoreState isPlaying=true 应上报 playStateReport isPlaying=true');
  console.log('PASS: restoreState isPlaying=true 恢复播放上报');

  // ---- 18. 控制端 play 命令触发 playStateReport 上报 ----
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'play', value: false
    }) }));
  });
  await new Promise(r => setTimeout(r, 200));
  const playFalse = await page.evaluate(() => {
    const pr = window.__wsSends
      .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(m => m && m.type === 'playStateReport');
    const last = pr[pr.length - 1];
    return { reported: last ? last.isPlaying : null, paused: mediaVideo.paused };
  });
  assert.strictEqual(playFalse.reported, false, '控制端暂停应上报 isPlaying=false');
  assert.strictEqual(playFalse.paused, true, '控制端暂停应暂停视频');
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'play', value: true
    }) }));
  });
  await new Promise(r => setTimeout(r, 200));
  const playTrue = await page.evaluate(() => {
    const pr = window.__wsSends
      .map(s => { try { return JSON.parse(s); } catch (e) { return null; } })
      .filter(m => m && m.type === 'playStateReport');
    const last = pr[pr.length - 1];
    return { reported: last ? last.isPlaying : null };
  });
  assert.strictEqual(playTrue.reported, true, '控制端播放应上报 isPlaying=true');
  console.log('PASS: 控制端 play 命令上报 playStateReport');

  // ---- 19. 睡眠暂停 TTS + 丢弃睡眠中新 TTS ----
  await page.evaluate(() => {
    activationUntil = 0;
    // 模拟当前正在播放一条 TTS
    isPlayingTts = true;
    ttsAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    // 监视 ttsAudio 的 pause/play 调用
    window.__ttsPauseCalls = 0;
    window.__ttsPlayCalls = 0;
    const origPause = ttsAudio.pause.bind(ttsAudio);
    const origPlay = ttsAudio.play.bind(ttsAudio);
    ttsAudio.pause = () => { window.__ttsPauseCalls++; return origPause(); };
    ttsAudio.play = () => { window.__ttsPlayCalls++; return origPlay(); };
    ttsQueue = [{ text: '待播' }];
    // 进入深度睡眠（覆盖当前小时）
    const h = new Date().getHours();
    sleepSettings = { enabled: true, startHour: h, endHour: h + 1, deepStartHour: h, deepEndHour: h + 1 };
    checkSleepMode();
    // 睡眠期间新 TTS 应被丢弃（队列不增长）
    queueTts({ text: '睡眠中新消息' });
  });
  await new Promise(r => setTimeout(r, 200));
  const ttsSleep = await page.evaluate(() => ({
    state: sleepState,
    queueLen: ttsQueue.length,
    pauseCalls: window.__ttsPauseCalls,
    paused: ttsAudio.paused,
    textClass: document.getElementById('voiceTextDisplay').className
  }));
  assert.strictEqual(ttsSleep.state, 'deep', '应进入深度睡眠');
  assert.strictEqual(ttsSleep.pauseCalls, 1, '进入睡眠应暂停当前 TTS');
  assert.strictEqual(ttsSleep.paused, true, '睡眠后 ttsAudio 应处于暂停态');
  assert.strictEqual(ttsSleep.queueLen, 0, '睡眠期间新 TTS 应被丢弃（队列为空）');
  assert.strictEqual(ttsSleep.textClass, 'voice-text-hidden', '睡眠应隐藏语音文本');
  console.log('PASS: 睡眠暂停 TTS + 丢弃新 TTS');

  // ---- 20. 唤醒续播睡眠前暂停的当前 TTS ----
  await page.evaluate(() => {
    sleepSettings = { enabled: false, startHour: 0, endHour: 24, deepStartHour: 0, deepEndHour: 24 };
    checkSleepMode();   // deep → normal，触发 resumeSleepTts
  });
  await new Promise(r => setTimeout(r, 200));
  const ttsResume = await page.evaluate(() => ({
    state: sleepState,
    playCalls: window.__ttsPlayCalls
  }));
  assert.strictEqual(ttsResume.state, 'normal', '关闭睡眠应回到 normal');
  assert.strictEqual(ttsResume.playCalls, 1, '唤醒应续播睡眠前暂停的当前 TTS');
  console.log('PASS: 唤醒续播当前 TTS');

  // ---- 21. handleTTS('setAutoTts') 同步 autoTtsEnabled ----
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'tts', action: 'setAutoTts', enabled: false
    }) }));
  });
  await new Promise(r => setTimeout(r, 200));
  const ttsOff = await page.evaluate(() => ({ autoTts: autoTtsEnabled }));
  assert.strictEqual(ttsOff.autoTts, false, 'setAutoTts false 应关闭自动播报');
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'tts', action: 'setAutoTts', enabled: true
    }) }));
  });
  await new Promise(r => setTimeout(r, 200));
  const ttsOn = await page.evaluate(() => ({ autoTts: autoTtsEnabled }));
  assert.strictEqual(ttsOn.autoTts, true, 'setAutoTts true 应开启自动播报');
  console.log('PASS: handleTTS(setAutoTts) 同步 autoTtsEnabled');

  // ---- 22. restoreState 恢复 autoTts（持久化开关）+ 旧数据缺字段保持默认 ----
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'restoreState', state: { autoTts: false }
    }) }));
  });
  await new Promise(r => setTimeout(r, 200));
  const restoredFalse = await page.evaluate(() => ({ autoTts: autoTtsEnabled }));
  assert.strictEqual(restoredFalse.autoTts, false, 'restoreState autoTts=false 应恢复关闭');
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'restoreState', state: { autoTts: true }
    }) }));
  });
  await new Promise(r => setTimeout(r, 200));
  const restoredTrue = await page.evaluate(() => ({ autoTts: autoTtsEnabled }));
  assert.strictEqual(restoredTrue.autoTts, true, 'restoreState autoTts=true 应恢复开启');
  // 旧数据无 autoTts 字段：不改变当前值（降级安全）
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'restoreState', state: { rotation: 90 }
    }) }));
  });
  await new Promise(r => setTimeout(r, 200));
  const restoredUndef = await page.evaluate(() => ({ autoTts: autoTtsEnabled }));
  assert.strictEqual(restoredUndef.autoTts, true, 'restoreState 无 autoTts 字段应保持当前值');
  console.log('PASS: restoreState 恢复 autoTts + 旧数据降级');

  // ---- 23. 睡眠中 document click 不恢复视频（此前 click 监听无守卫，display:block && paused 时任何点击都 play）----
  const videoUrl = 'https://127.0.0.1:8081/api/media-libraries/lib_1774720230592/proxy/mnt%2F145842476_p0-%E5%8A%A8%E5%9B%BE.mp4';
  await page.evaluate((u) => {
    mediaVideo.style.display = 'block';
    mediaVideo.src = u;
    mediaVideo.load();
    playVideoAuto(mediaVideo);
  }, videoUrl);
  await page.waitForFunction(() => mediaVideo.readyState >= 2, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));
  const vPlaying = await page.evaluate(() => ({ paused: mediaVideo.paused, display: mediaVideo.style.display }));
  assert.strictEqual(vPlaying.paused, false, '视频应正在播放');
  assert.strictEqual(vPlaying.display, 'block', 'video display 应为 block（click 监听条件成立）');
  // 进入睡眠
  await page.evaluate(() => applySleepState('sleep'));
  const vSlept = await page.evaluate(() => mediaVideo.paused);
  assert.strictEqual(vSlept, true, '睡眠应暂停视频');
  // 睡眠中 click
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await new Promise(r => setTimeout(r, 300));
  const vAfterClick = await page.evaluate(() => mediaVideo.paused);
  assert.strictEqual(vAfterClick, true, '睡眠中 click 不应恢复视频（守卫生效）');
  console.log('PASS: 睡眠中 click 不恢复视频');

  // ---- 24. 睡眠中 handleControl('play', true) 拒绝播放 ----
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'play', value: true
    }) }));
  });
  await new Promise(r => setTimeout(r, 300));
  const vAfterPlayCmd = await page.evaluate(() => mediaVideo.paused);
  assert.strictEqual(vAfterPlayCmd, true, '睡眠中 play 命令应被拒绝（视频保持暂停）');
  console.log('PASS: 睡眠中 play 命令拒绝');

  // ---- 25. 播放列表在睡眠中不切播（playCurrentItem 守卫）----
  await page.evaluate(() => {
    applySleepState('sleep');
    // 哨兵 src：若 playCurrentItem 未守卫，会被播放列表项 URL 覆盖
    mediaVideo.src = 'https://example.com/sentinel.mp4';
    mediaVideo.pause();
    playlistState = {
      listId: 'pl-sleep-test', index: 0, active: true, paused: false, interval: 0,
      timer: null, videoEndedHandler: null,
      playlist: [{ url: 'https://example.com/playlist-item.mp4', fileName: 'x', mediaType: 'video' }]
    };
    playCurrentItem();
    return { src: mediaVideo.src };
  });
  await new Promise(r => setTimeout(r, 200));
  const plState = await page.evaluate(() => ({ src: mediaVideo.src, index: playlistState.index }));
  assert.strictEqual(plState.src, 'https://example.com/sentinel.mp4', '睡眠中 playCurrentItem 不应加载播放列表项');
  assert.strictEqual(plState.index, 0, '睡眠中播放列表 index 不应推进');
  console.log('PASS: 播放列表睡眠中不切播');

  // ---- 26. 睡眠前单媒体暂停 → 退出睡眠保持暂停（resumeSleepMedia 检查 mediaIsPlaying）----
  const vUrl2 = 'https://127.0.0.1:8081/api/media-libraries/lib_1774720230592/proxy/mnt%2F145842476_p0-%E5%8A%A8%E5%9B%BE.mp4';
  await page.evaluate((u) => {
    applySleepState('normal');
    playlistState = null;             // 清除步骤 25 残留的播放列表，回到单媒体场景
    mediaIsPlaying = false;           // 模拟控制端暂停（handleControl play false 已同步）
    mediaVideo.style.display = 'block';
    mediaVideo.src = u;
    mediaVideo.load();
    mediaVideo.pause();
  }, vUrl2);
  await page.waitForFunction(() => mediaVideo.readyState >= 2, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));
  // 进入睡眠再退出：resumeSleepMedia 应因 mediaIsPlaying=false 保持暂停
  await page.evaluate(() => { applySleepState('sleep'); applySleepState('normal'); });
  await new Promise(r => setTimeout(r, 300));
  const pausedRestore2 = await page.evaluate(() => mediaVideo.paused);
  assert.strictEqual(pausedRestore2, true, '睡眠前暂停的单媒体退出睡眠后应保持暂停');
  console.log('PASS: 睡眠前暂停的单媒体退出睡眠保持暂停');

  // ---- 27. 睡眠前单媒体播放中 → 退出睡眠恢复播放（mediaIsPlaying=true）----
  await page.evaluate(() => {
    mediaIsPlaying = true;            // 模拟控制端播放
    mediaVideo.play().catch(() => {});
  });
  await new Promise(r => setTimeout(r, 300));
  const vPlaying2 = await page.evaluate(() => mediaVideo.paused);
  assert.strictEqual(vPlaying2, false, '播放中单媒体应处于播放态');
  await page.evaluate(() => { applySleepState('sleep'); applySleepState('normal'); });
  await new Promise(r => setTimeout(r, 300));
  const vResumed = await page.evaluate(() => mediaVideo.paused);
  assert.strictEqual(vResumed, false, '睡眠前播放中的单媒体退出睡眠后应恢复播放');
  console.log('PASS: 睡眠前播放中的单媒体退出睡眠恢复播放');

  // ---- 28. 睡眠前播放列表暂停 → 退出睡眠保持暂停（shouldPlayMedia 读 ps.paused）----
  await page.evaluate((u) => {
    applySleepState('normal');
    mediaVideo.style.display = 'block';
    mediaVideo.src = u;
    mediaVideo.load();
    mediaVideo.play().catch(() => {});
    playlistState = {
      listId: 'pl-resume-test', index: 0, active: true, paused: true, interval: 0,
      timer: null, videoEndedHandler: null,
      playlist: [{ url: u, fileName: 'x', mediaType: 'video' }]
    };
    applySleepState('sleep');
    applySleepState('normal');        // resumeSleepMedia 读 ps.paused=true → 保持暂停
  }, vUrl2);
  await new Promise(r => setTimeout(r, 300));
  const plPausedRestore = await page.evaluate(() => ({ paused: mediaVideo.paused, psPaused: playlistState.paused }));
  assert.strictEqual(plPausedRestore.psPaused, true, '播放列表应处于暂停态');
  assert.strictEqual(plPausedRestore.paused, true, '睡眠前暂停的播放列表退出睡眠后应保持暂停');
  console.log('PASS: 睡眠前暂停的播放列表退出睡眠保持暂停');

  // ---- 29. 立即切换指令优先于临时激活窗口 ----
  const overridePriority = await page.evaluate(() => {
    sleepSettings = { ...sleepSettings, enabled: false };

    activateTemporarily();
    const activeUntilBeforeSleep = activationUntil > Date.now();
    handleControl({ action: 'sleepOverride', value: 'sleep' });
    const sleepResult = { state: sleepState, activationCleared: activationUntil === 0 };

    activateTemporarily();
    handleControl({ action: 'sleepOverride', value: 'deep' });
    const deepResult = { state: sleepState, activationCleared: activationUntil === 0 };

    activateTemporarily();
    handleControl({ action: 'sleepOverride', value: 'normal' });
    const normalResult = { state: sleepState, activationCleared: activationUntil === 0 };

    return { activeUntilBeforeSleep, sleepResult, deepResult, normalResult };
  });
  assert.strictEqual(overridePriority.activeUntilBeforeSleep, true, '测试前应存在未过期临时激活');
  assert.deepStrictEqual(overridePriority.sleepResult, { state: 'sleep', activationCleared: true }, '立即睡眠应覆盖临时激活');
  assert.deepStrictEqual(overridePriority.deepResult, { state: 'deep', activationCleared: true }, '立即深度睡眠应覆盖临时激活');
  assert.deepStrictEqual(overridePriority.normalResult, { state: 'normal', activationCleared: true }, '恢复正常应清除临时激活');
  console.log('PASS: 立即切换指令优先于临时激活窗口');

  // 恢复 normal，清理测试状态
  await page.evaluate(() => { applySleepState('normal'); playlistState = null; });

  await browser.close();
  console.log('ALL PASS: 显示端睡眠模式');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
