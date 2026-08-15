// display.html 原生桥测试：mock window.NativeDisplay，验证 native 优先 + 输入走桥
// 运行：node tests/display-native-bridge.test.js        （桥场景）
//       NO_BRIDGE=1 node tests/display-native-bridge.test.js  （无桥回归）
const puppeteer = require('/mnt/AASC/node_modules/puppeteer');
const assert = require('assert');

const NO_BRIDGE = !!process.env.NO_BRIDGE;
const FAKE_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium',
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.evaluateOnNewDocument((noBridge, fakeJpeg) => {
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
    // mock 原生桥（NO_BRIDGE=1 时不注入，回归浏览器显示端行为）
    if (!noBridge) {
      window.__bridgeCalls = [];
      window.NativeDisplay = {
        isAvailable: () => true,
        takeScreenshot: () => {
          window.__bridgeCalls.push(['takeScreenshot']);
          return JSON.stringify({ dataUrl: fakeJpeg, width: 1280, height: 720 });
        },
        injectTouch: (x, y, a) => { window.__bridgeCalls.push(['injectTouch', x, y, a]); return true; },
        injectWheel: (x, y, d) => { window.__bridgeCalls.push(['injectWheel', x, y, d]); return true; },
        injectKey: (k, m) => { window.__bridgeCalls.push(['injectKey', k, m]); return true; },
        injectText: (t) => { window.__bridgeCalls.push(['injectText', t]); return true; },
        getScreenSize: () => ({ width: 1280, height: 800 })
      };
    }
  }, NO_BRIDGE, FAKE_JPEG);

  await page.goto('https://127.0.0.1:8081/display', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__wsInstance && window.__wsInstance.readyState === 1, { timeout: 15000 });
  await new Promise(r => setTimeout(r, 500));

  // 发送本地 srcdoc html（桥场景下 native 截图优先，不依赖 html-to-image）
  const htmlB64 = Buffer.from('<html><body><h1>bridge test</h1><img src="https://example.com/x.jpg"></body></html>').toString('base64');
  await page.evaluate(b64 => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'base64', data: b64, fileName: 't.html', mediaType: 'html', temp: true
    }) }));
  }, htmlB64);
  await new Promise(r => setTimeout(r, 2500));

  // 开启控制模式
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'control', action: 'controlMode', value: true }) }));
  });
  await new Promise(r => setTimeout(r, 2500));

  // 断言：桥场景回传 mode='native'；无桥场景（跨域内容）不得出现 native
  const result = await page.evaluate(() => {
    const shots = window.__wsSends
      .filter(s => s.includes('controlScreenshot'))
      .slice(-3)
      .map(s => JSON.parse(s));
    return { shots, bridgeCalls: window.__bridgeCalls || [] };
  });
  const modes = result.shots.map(s => s.mode);
  if (NO_BRIDGE) {
    assert(!modes.includes('native'), '无桥场景不应出现 native 截图，实际: ' + JSON.stringify(modes));
    console.log('PASS: 无桥回归（跨域内容回退现有链，无 native 截图）');
  } else {
    assert(result.bridgeCalls.some(c => c[0] === 'takeScreenshot'), '桥 takeScreenshot 应被调用');
    const nativeShot = result.shots.find(s => s.mode === 'native');
    assert(nativeShot, '应存在 mode=native 的截图消息，实际: ' + JSON.stringify(modes));
    assert(nativeShot.dataUrl === FAKE_JPEG, 'dataUrl 应为桥回调值');
    console.log('PASS: 桥截图链（native 优先, mode=native, dataUrl 透传）');
  }

  // ===== 输入注入断言 =====
  // 控制模式截图定时器仍在跑：过滤 takeScreenshot，只统计输入类桥调用
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    // 鼠标点击（50%,50%）→ 屏幕坐标 = rect 偏移 + 容器一半
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'controlInput', event: 'mousedown', x: 50, y: 50, button: 0
    }) }));
    // 滚轮
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'controlInput', event: 'wheel', x: 50, y: 50, deltaX: 0, deltaY: 120
    }) }));
    // 键盘 Enter（DOM keyCode 13 → Android 66）
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'controlInput', event: 'keydown', key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false
    }) }));
    // 中文文本
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'controlInput', event: 'text', text: '中文测试'
    }) }));
  });
  await new Promise(r => setTimeout(r, 500));

  const inputCalls = await page.evaluate(() =>
    (window.__bridgeCalls || []).filter(c => c[0] !== 'takeScreenshot')
  );
  if (NO_BRIDGE) {
    assert(inputCalls.length === 0, '无桥场景不应调用桥，实际: ' + JSON.stringify(inputCalls));
    console.log('PASS: 无桥输入回归（走 JS 合成，不调桥）');
  } else {
    assert(inputCalls.some(c => c[0] === 'injectTouch' && c[1] > 0 && c[2] > 0 && c[3] === 'down'), 'injectTouch(down) 应被调用并带屏幕坐标: ' + JSON.stringify(inputCalls));
    assert(inputCalls.some(c => c[0] === 'injectWheel'), 'injectWheel 应被调用');
    assert(inputCalls.some(c => c[0] === 'injectKey' && c[1] === 66), 'Enter 应映射 Android keyCode 66: ' + JSON.stringify(inputCalls));
    assert(inputCalls.some(c => c[0] === 'injectText' && c[1] === '中文测试'), 'injectText 应透传中文');
    console.log('PASS: 桥输入注入（touch/wheel/key/text）');
  }

  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
