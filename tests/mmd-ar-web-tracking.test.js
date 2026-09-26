'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');

const WEB_ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium']
  .find((candidate) => candidate && fs.existsSync(candidate));

test('MindAR 网页使用 A-Frame 锚点显示蓝色矩形和十字，并支持自定义图重启', {
  skip: !CHROME || !fs.existsSync(path.join(WEB_ROOT, 'index.html')),
  timeout: 120000,
}, async () => {
  const html = fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');
  assert.match(html, /MmdArTestAframeMode = true/u);
  assert.match(html, /mindar-image-target="targetIndex: 0"/u);
  assert.match(html, /mmdArAframeTargetRect/u);
  assert.match(html, /mmdArAframeCrossH/u);
  assert.match(html, /mmdArAframeCrossV/u);
  assert.match(html, /color: #229cff; opacity: 0\.35/u);
  assert.doesNotMatch(html, /mmdArLocationTestMarker/u);
  assert.match(html, /id="displayMmdCanvas"/u);
  assert.equal(fs.existsSync(path.join(WEB_ROOT, 'js/display-mmd-ar-aframe.js')), true);
  const arSource = fs.readFileSync(path.join(WEB_ROOT, 'js/display-mmd-ar.js'), 'utf8');
  assert.match(arSource, /MmdArTestAframeTracking\?\.cancelPending/u);
  assert.match(arSource, /root\.MmdArTestAframeMode === true[\s\S]*?stopCamera\(\)/u);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/mnt/mmd-ar/')) return void response.writeHead(404).end();
    if (pathname === '/mnt/mmd-ar/testimg/mindar.JPG') {
      response.setHeader('Content-Type', 'image/jpeg');
      fs.createReadStream(path.resolve(WEB_ROOT, '../testimg/mindar.JPG')).pipe(response);
      return;
    }
    const relative = decodeURIComponent(pathname.slice('/mnt/mmd-ar/'.length)) || 'index.html';
    const absolute = path.resolve(WEB_ROOT, relative);
    if (!absolute.startsWith(`${WEB_ROOT}${path.sep}`) || !fs.existsSync(absolute)
      || !fs.statSync(absolute).isFile()) return void response.writeHead(404).end();
    response.setHeader('Content-Type', /\.m?js$/u.test(absolute) ? 'text/javascript'
      : /\.html$/u.test(absolute) ? 'text/html'
        : /\.png$/u.test(absolute) ? 'image/png' : 'application/octet-stream');
    fs.createReadStream(absolute).pipe(response);
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 120000,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/mnt/mmd-ar/testimg/mindar.JPG') {
        void request.respond({ status: 200, contentType: 'image/jpeg',
          body: fs.readFileSync(path.resolve(WEB_ROOT, '../testimg/mindar.JPG')) });
      }
      else if (pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    const pageUrl = process.env.MMD_AR_TEST_URL || `http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`;
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AFRAME && window.DisplayMmdImageTargetTracker?.start
      && document.getElementById('mmdArAframeScene')?.hasLoaded
      && window.DisplayMmdAr?.getState?.().targetCount > 0, { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const response = await fetch('/mnt/mmd-ar/assets/mindar-official-card.png');
      const blob = await response.blob();
      const image = await createImageBitmap(await (await fetch('/mnt/mmd-ar/testimg/mindar.JPG')).blob());
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext('2d');
      const drawTarget = () => {
        context.fillStyle = '#555';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 22, 1280, 676);
      };
      drawTarget();
      const drawTimer = setInterval(drawTarget, 50);
      const stream = canvas.captureStream(20);
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const originalDisplayMmd = window.DisplayMmd;
      let cameraCalls = 0;
      let poseCalls = 0;
      let suspendCalls = 0;
      let poseReady = true;
      navigator.mediaDevices.getUserMedia = async () => { cameraCalls += 1; return stream; };
      // 本用例不加载 PMX 模型；替身记录适配器是否在重锁后继续提交有效锚点位姿。
      window.DisplayMmd = {
        ...originalDisplayMmd,
        setArCameraPose: () => { poseCalls += 1; return poseReady; },
        suspendArCameraPose: () => { suspendCalls += 1; }
      };
      let session;
      let blankTimer;
      try {
        let updates = 0;
        document.getElementById('mmdArAframeAnchor').addEventListener('targetUpdate', () => { updates += 1; });
        session = await window.DisplayMmdImageTargetTracker.start({
          targetId: 'builtin:mindar-official-card', referenceImageBlob: blob,
          selectedQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
          compiledTargetData: null,
        });
        const host = document.getElementById('mmdArAframeHost');
        const anchor = document.getElementById('mmdArAframeAnchor');
        const rectangle = document.getElementById('mmdArAframeTargetRect');
        const deadline = performance.now() + 15000;
        let found = false;
        while (performance.now() < deadline && !found) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          found = (await session.processFrame()).visible === true;
        }
        const system = document.getElementById('mmdArAframeScene').systems['mindar-image-system'];
        const foundState = { found, anchorVisible: anchor.object3D.visible,
          hostVisible: !host.hidden, width: Number(rectangle.getAttribute('width')),
          height: Number(rectangle.getAttribute('height')), cameraCalls,
          videoSize: [system.video?.videoWidth, system.video?.videoHeight],
          anchors: system.anchorEntities?.length,
          controller: Boolean(system.controller),
          sceneSize: [system.el?.clientWidth, system.el?.clientHeight], updates,
          videoReadyState: system.video?.readyState, videoTime: system.video?.currentTime,
          poseSync: window.MmdArTestAframeTracking.getPoseSyncState(), poseCalls };
        clearInterval(drawTimer);
        blankTimer = setInterval(() => {
          context.fillStyle = '#555';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }, 50);
        const lostDeadline = performance.now() + 12000;
        let lost = false;
        while (found && performance.now() < lostDeadline && !lost) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          lost = (await session.processFrame()).visible === false;
        }
        const hiddenAfterLost = !anchor.object3D.visible;
        const lostSync = window.MmdArTestAframeTracking.getPoseSyncState();
        // 冻结识别器后模拟重锁：只发送 found，不发送 update，验证逐帧补偿会读取可见锚点。
        system.pause(true);
        poseReady = false;
        anchor.object3D.matrix = new window.AFRAME.THREE.Matrix4().makeTranslation(0.25, 0, -3);
        anchor.object3D.visible = true;
        const callsBeforeRefound = poseCalls;
        anchor.emit('targetFound');
        await new Promise((resolve) => setTimeout(resolve, 120));
        const rejectedSync = window.MmdArTestAframeTracking.getPoseSyncState();
        poseReady = true;
        const retryDeadline = performance.now() + 2000;
        while (!window.MmdArTestAframeTracking.getPoseSyncState().synced
          && performance.now() < retryDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        const refound = { poseCalls, callsBeforeRefound,
          rejectedSync, poseSync: window.MmdArTestAframeTracking.getPoseSyncState(), suspendCalls };
        return { foundState, lost, hiddenAfterLost, lostSync, refound };
      } finally {
        clearInterval(drawTimer);
        clearInterval(blankTimer);
        await session?.stop();
        navigator.mediaDevices.getUserMedia = originalGetUserMedia;
        window.DisplayMmd = originalDisplayMmd;
        image.close();
      }
    });
    assert.equal(result.foundState.cameraCalls, 1);
    assert.equal(result.foundState.hostVisible, true);
    assert.equal(result.foundState.found, true, `A-Frame 未识别目标：${JSON.stringify(result)}; errors=${pageErrors.join(' | ')}`);
    assert.equal(result.foundState.anchorVisible, true);
    assert.equal(result.foundState.width, 1);
    assert.ok(result.foundState.height > 0);
    assert.equal(result.lost, true);
    assert.equal(result.hiddenAfterLost, true);
    assert.equal(result.foundState.poseSync.synced, true, '首锁后 PMX 适配器应收到位姿');
    assert.equal(result.lostSync.synced, false, '失锁后适配器不应继续声称角色相机已同步');
    assert.ok(result.refound.suspendCalls > 0, '失锁应冻结 PMX 相机');
    assert.ok(result.refound.poseCalls > result.refound.callsBeforeRefound,
      '目标重锁但未再发 targetUpdate 时，逐帧补偿仍应提交新位姿');
    assert.equal(result.refound.rejectedSync.synced, false, 'PMX 拒绝位姿时不得误报同步成功');
    assert.ok(result.refound.rejectedSync.failures > 0, 'PMX 暂未就绪时应记录失败并等待重试');
    assert.equal(result.refound.poseSync.synced, true);
    const stopped = await page.evaluate(() => ({
      hostHidden: document.getElementById('mmdArAframeHost').hidden,
      videoCount: document.querySelectorAll('#mmdArAframeHost video').length,
      controllerGone: !document.getElementById('mmdArAframeScene').systems['mindar-image-system'].controller,
    }));
    assert.deepEqual(stopped, { hostHidden: true, videoCount: 0, controllerGone: true });
    const custom = await page.evaluate(async () => {
      const blob = await (await fetch('/mnt/mmd-ar/assets/mindar-official-card.png')).blob();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d');
      context.fillStyle = '#567';
      context.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(15);
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async () => stream;
      let session;
      try {
        session = await window.DisplayMmdImageTargetTracker.start({
          targetId: 'user:compile-test', referenceImageBlob: blob,
          selectedQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
        });
        const system = document.getElementById('mmdArAframeScene').systems['mindar-image-system'];
        return { usesCompiledBlob: system.imageTargetSrc.startsWith('blob:'),
          hostVisible: !document.getElementById('mmdArAframeHost').hidden };
      } finally {
        await session?.stop();
        navigator.mediaDevices.getUserMedia = original;
      }
    });
    assert.deepEqual(custom, { usesCompiledBlob: true, hostVisible: true });
    assert.equal(await page.$eval('#mmdArAframeHost', (host) => host.hidden), true);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
