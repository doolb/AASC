'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer');

const WEB_ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), '/usr/bin/chromium']
  .find((candidate) => candidate && fs.existsSync(candidate));

function createWebServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const relative = pathname === '/api/mmd/resources' ? 'mmd-resources.json'
      : decodeURIComponent(pathname.replace(/^\/mnt\/mmd-ar\//u, '/').slice(1)) || 'index.html';
    const absolute = path.resolve(WEB_ROOT, relative);
    if (!absolute.startsWith(`${WEB_ROOT}${path.sep}`) || !fs.existsSync(absolute)
      || !fs.statSync(absolute).isFile()) return void response.writeHead(404).end();
    const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
      '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' };
    response.setHeader('Content-Type', types[path.extname(absolute)] || 'application/octet-stream');
    fs.createReadStream(absolute).pipe(response);
  });
}

test('独立静态页资源清单引用已打包的模型和动作', {
  skip: !fs.existsSync(path.join(WEB_ROOT, 'mmd-resources.json'))
}, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(WEB_ROOT, 'mmd-resources.json'), 'utf8'));
  assert.ok(manifest.resources.length > 0);
  for (const profile of manifest.resources) {
    for (const key of ['modelUrl', 'motionUrl']) {
      if (!profile[key]) continue;
      assert.match(profile[key], /^\.\/mmd\//u, `${key}不能依赖静态站点不存在的服务API`);
      assert.ok(fs.existsSync(path.resolve(WEB_ROOT, profile[key])), `${key}必须指向已打包文件`);
    }
  }
});

test('真实模型普通预览前后台及pagehide保留平移、旋转、缩放和相机', {
  skip: !CHROME || !fs.existsSync(path.join(WEB_ROOT, 'mmd/miya/miya.pmx')),
  timeout: 120000,
}, async () => {
  const server = createWebServer();
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 480, height: 640 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?safePhysics=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady
      && window.DisplayMmdAr?.getState, { timeout: 60000 });
    const before = await page.evaluate(async () => {
      const bridge = window.DisplayMmd.getEditorBridge();
      bridge.context.helper.enable('physics', false);
      bridge.context.helper.enable('animation', false);
      window.DisplayMmd.zoomCameraBy(1.8);
      window.DisplayMmd.translateModelByPixels(80, 40);
      window.DisplayMmd.setCameraViewRotation(0.3, 0.1);
      // 等待相机旋转缓动收敛，再比较生命周期事件前后的实际根变换。
      for (let i = 0; i < 90; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
      window.__previewSnapshot = () => {
        const state = window.DisplayMmd.getArCameraState();
        const pivot = bridge.context.mesh.parent;
        return { modelPosition: state.modelPosition, modelScale: state.modelScale,
          modelQuaternion: pivot.quaternion.toArray(), cameraPosition: state.cameraPosition,
          cameraQuaternion: state.cameraQuaternion, cameraZoomFactor: state.cameraZoomFactor };
      };
      return window.__previewSnapshot();
    });
    assert.equal(before.cameraZoomFactor, 1.8);
    assert.ok(Math.abs(before.modelPosition[0]) > 0.1, '必须先实际拖动角色');
    const compare = (actual, label) => {
      for (const [key, expected] of Object.entries(before)) {
        const values = Array.isArray(expected) ? expected : [expected];
        const observed = Array.isArray(actual[key]) ? actual[key] : [actual[key]];
        values.forEach((value, index) => assert.ok(Math.abs(value - observed[index]) < 1e-5,
          `${label} ${key}[${index}]不应被重置：${value}→${observed[index]}`));
      }
    };
    for (let cycle = 0; cycle < 2; cycle += 1) {
      // 同时覆盖测试蓝框模式和共享控制器直接复位相机的分支，避免只修好一个入口。
      await page.evaluate((markerMode) => { window.MmdArLocationMarkerTest = markerMode; }, cycle === 0);
      for (const visibility of ['hidden', 'visible']) {
        const actual = await page.evaluate(async (value) => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value });
          document.dispatchEvent(new Event('visibilitychange'));
          for (let i = 0; i < 3; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
          return window.__previewSnapshot();
        }, visibility);
        compare(actual, `${cycle}:${visibility}`);
      }
      await page.evaluate(async () => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        window.DisplayMmd.resize(480, 640, 1);
        for (let i = 0; i < 3; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      compare(await page.evaluate(() => window.__previewSnapshot()), `${cycle}:pagehide/resize`);
    }
    const picture = await page.evaluate(() => {
      const { renderer, ambientOcclusion } = window.DisplayMmd.getEditorBridge().context;
      ambientOcclusion.render();
      const gl = renderer.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels.filter((value, index) => index % 4 === 3 && value > 127).length;
    });
    assert.ok(picture > 1000, '前后台恢复后必须实际绘制角色');
    for (const eventType of ['visibilitychange', 'pagehide']) {
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        canvas.getContext('2d').fillRect(0, 0, 32, 32);
        window.__lateCameraStream = canvas.captureStream(10);
        navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
          window.__resolveLateCamera = () => resolve(window.__lateCameraStream);
        });
        document.getElementById('displayArCalibrationButton').click();
      });
      await page.waitForFunction(() => window.DisplayMmdAr.getState().status === 'requestingCamera');
      const pending = await page.evaluate(() => {
        window.DisplayMmd.zoomCameraBy(1.6);
        window.DisplayMmd.translateModelByPixels(50, 20);
        return window.__previewSnapshot();
      });
      await page.evaluate((type) => {
        if (type === 'visibilitychange') {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
          document.dispatchEvent(new Event(type));
        } else window.dispatchEvent(new PageTransitionEvent(type, { persisted: true }));
        window.__resolveLateCamera();
      }, eventType);
      await page.waitForFunction(() => window.__lateCameraStream.getTracks().every((track) => track.readyState === 'ended')
        && document.getElementById('displayArCalibration').hidden);
      const released = await page.evaluate(async () => {
        for (let i = 0; i < 3; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
        return window.__previewSnapshot();
      });
      assert.deepEqual(released.modelPosition, pending.modelPosition, `${eventType}取消迟到请求仍保留角色位置`);
      assert.equal(released.cameraZoomFactor, pending.cameraZoomFactor);
    }
    const exited = await page.evaluate(async () => {
      const THREE = window.DisplayMmd.getEditorBridge().context.THREE;
      const applied = window.DisplayMmd.setArCameraPose({
        anchorMatrix: new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0, -3).toArray(),
        projectionMatrix: new THREE.PerspectiveCamera(55, 480 / 640, 0.01, 100).projectionMatrix.toArray()
      });
      const active = window.DisplayMmd.getArCameraState().active;
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      for (let i = 0; i < 3; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
      return { applied, active, after: window.DisplayMmd.getArCameraState() };
    });
    assert.equal(exited.applied, true);
    assert.equal(exited.active, true);
    assert.equal(exited.after.active, false, '实际AR相机仍须退出，不能一概跳过复位');
    const manual = await page.evaluate(async () => {
      window.DisplayMmd.zoomCameraBy(1.8);
      window.DisplayMmd.translateModelByPixels(80, 40);
      await window.DisplayMmdAr.stop();
      return window.__previewSnapshot();
    });
    assert.equal(manual.cameraZoomFactor, 1, '手动停止保持显式复位语义');
    assert.equal(manual.modelPosition[0], 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('模拟定位切后台释放视频，回前台以新轨道恢复；手动停止不恢复', {
  skip: !CHROME || !fs.existsSync(path.join(WEB_ROOT, 'index.html')),
  timeout: 90000,
}, async () => {
  const server = createWebServer();
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 90000,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.DisplayMmdAr?.getState?.().targetCount > 0
      && window.MmdArTestSimCamera?.getStream && window.DisplayMmd?.getState, { timeout: 30000 });
    await page.select('#mmdArInputMode', 'simulated');
    const input = await page.$('#mmdArSimFile');
    await input.uploadFile(path.resolve(__dirname, '../3rd/mmd-ar-test/testimg/mindar.JPG'));
    await page.waitForFunction(() => window.MmdArTestSimCamera.getState().imageReady);
    await page.evaluate(() => {
      window.DisplayMmd = Object.freeze({ ...window.DisplayMmd,
        getState: () => ({ visible: true, modelReady: true }) });
      window.__arTestTracks = [];
      window.DisplayMmdImageTargetTracker = Object.freeze({
        start: async () => {
          const stream = await window.MmdArTestSimCamera.getStream();
          window.__arTestTracks.push(stream.getVideoTracks()[0]);
          return { processFrame: async () => ({ visible: false, newSample: false }),
            stop: async () => window.MmdArTestSimCamera.releaseStream() };
        }
      });
      document.getElementById('displayArStartButton').click();
    });
    await page.waitForFunction(() => window.DisplayMmdAr.getState().tracking
      && window.__arTestTracks.length === 1, { timeout: 15000 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => !window.DisplayMmdAr.getState().tracking
      && !window.MmdArTestSimCamera.getState().streaming
      && window.__arTestTracks[0].readyState === 'ended', { timeout: 15000 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.DisplayMmdAr.getState().tracking
      && window.MmdArTestSimCamera.getState().streaming
      && window.__arTestTracks.length === 2, { timeout: 15000 });
    const tracks = await page.evaluate(() => window.__arTestTracks.map((track) => track.id));
    assert.notEqual(tracks[0], tracks[1]);
    await page.evaluate(() => window.DisplayMmdAr.stop());
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => !window.DisplayMmdAr.getState().tracking
      && !window.MmdArTestSimCamera.getState().streaming, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__arTestTracks.length), 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
