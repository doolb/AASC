'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..', '3rd', 'mind-basic');
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const pageUrl = process.env.MIND_BASIC_TEST_URL || null;
const useRealCompiler = process.env.MIND_BASIC_REAL_COMPILER === '1';

function injectBrowserFixture(html) {
  const withoutExternalEngines = html
    .replace(/\s*<script src="https:\/\/aframe\.io\/releases\/1\.5\.0\/aframe\.min\.js"><\/script>/u, '')
    .replace(/\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/mind-ar@1\.2\.5\/dist\/mindar-image-aframe\.prod\.js"><\/script>/u, '');
  const fixture = `<script>
    window.AFRAME = { components: {}, registerComponent(name, definition) { this.components[name] = definition; } };
    customElements.define('a-scene', class extends HTMLElement {
      connectedCallback() {
        const scene = this;
        this.systems = { 'mindar-image-system': {
          imageTargetSrc: '',
          _resize() {},
          start() { scene.dispatchEvent(new Event('arReady')); },
          pause() {}
        } };
        this.hasLoaded = true;
      }
    });
  </script>`;
  return withoutExternalEngines.replace(/<script src="\.\/mind-basic-imu\.js(?:\?[^" ]*)?"><\/script>/u,
    (script) => `${fixture}\n    ${script}`);
}

async function startLocalServer() {
  const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
  };
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.resolve(root, relativePath);
    if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== path.join(root, 'index.html')) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
      response.end(content);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`
  };
}

test('蓝框叠加拍摄、移动、缩放、重拍、保存和 MindAR 编译浏览器流程', { timeout: 90000 }, async (t) => {
  if (!fs.existsSync(executablePath)) {
    t.skip(`Chromium 不存在：${executablePath}`);
    return;
  }
  const localServer = pageUrl ? null : await startLocalServer();
  const targetPageUrl = pageUrl || localServer.url;
  let browser = null;
  const pageErrors = [];
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          async getUserMedia() {
            const source = document.createElement('canvas');
            source.width = 800;
            source.height = 600;
            const context = source.getContext('2d');
            context.fillStyle = '#27618e';
            context.fillRect(0, 0, source.width, source.height);
            context.fillStyle = '#d43e3e';
            context.fillRect(0, 0, 80, source.height);
            context.fillRect(720, 0, 80, source.height);
            context.fillRect(0, 0, source.width, 60);
            context.fillRect(0, 540, source.width, 60);
            for (let y = 64; y < 536; y += 16) {
              for (let x = 84; x < 716; x += 16) {
                const parity = (Math.floor(x / 16) + Math.floor(y / 16)) % 2;
                context.fillStyle = parity ? '#e5c75b' : '#23476b';
                context.fillRect(x, y, 13, 13);
                context.fillStyle = parity ? '#355f40' : '#d89052';
                context.fillRect(x + 4, y + 4, 5, 5);
              }
            }
            return source.captureStream(24);
          }
        }
      });
      Object.defineProperty(window, 'DeviceMotionEvent', {
        configurable: true,
        value: class DeviceMotionFixture {
          static async requestPermission() {
            return 'granted';
          }
        }
      });
    });
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
        const requestUrl = new URL(request.url());
        if (!useRealCompiler && requestUrl.pathname.endsWith('/mindar-image.prod.js')) {
          await request.respond({
            status: 200,
            contentType: 'text/javascript',
            headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
            body: 'export class Compiler { async compileImageTargets(images, progress) { if (images.length !== 1) throw new Error("expected one image"); progress(100); } async exportData() { return new Uint8Array([1, 2, 3]); } }'
          });
          return;
        }
        const isDocument = request.isNavigationRequest()
          && (requestUrl.pathname.endsWith('/') || requestUrl.pathname.endsWith('/index.html'));
        if (isDocument) {
          const html = pageUrl
            ? await (await fetch(request.url())).text()
            : fs.readFileSync(path.join(root, 'index.html'), 'utf8');
          await request.respond({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: injectBrowserFixture(html)
          });
          return;
        }
        await request.continue();
      } catch (error) {
        if (!request.isInterceptResolutionHandled()) await request.abort('failed');
        pageErrors.push(error.message);
      }
    });

    await page.goto(targetPageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('mindBasicStatus')?.textContent.includes('定位已启动'),
      { timeout: 8000 }).catch(async (error) => {
      const status = await page.$eval('#mindBasicStatus', (element) => element.textContent).catch(() => 'missing');
      throw new Error(`${error.message}; status=${status}; errors=${pageErrors.join(' | ')}`);
    });
    assert.equal(await page.$eval('#mindBasicControlsToggle', (button) => button.getAttribute('aria-expanded')), 'true');
    assert.equal(await page.$eval('#mindBasicControlsBody', (body) => getComputedStyle(body).display !== 'none'), true);
    await page.click('#mindBasicControlsToggle');
    assert.equal(await page.$eval('#mindBasicControlsToggle', (button) => button.getAttribute('aria-expanded')), 'false');
    assert.equal(await page.$eval('#mindBasicControlsBody', (body) => getComputedStyle(body).display === 'none'), true);
    await page.click('#mindBasicControlsToggle');
    assert.equal(await page.$eval('#mindBasicControlsToggle', (button) => button.getAttribute('aria-expanded')), 'true');

    await page.click('#mindBasicImuToggle');
    await page.waitForFunction(() => document.getElementById('mindBasicImuStatus')
      ?.textContent.includes('正在校准陀螺仪偏置'));
    await page.evaluate(() => {
      const originalNow = performance.now.bind(performance);
      let calibrationNow = originalNow();
      Object.defineProperty(performance, 'now', { configurable: true, value: () => calibrationNow });
      for (let index = 0; index < 24; index += 1) {
        calibrationNow += 60;
        const event = new Event('devicemotion');
        Object.defineProperties(event, {
          rotationRate: { value: { alpha: 0, beta: 0, gamma: 0 } },
          acceleration: { value: { x: 0, y: 0, z: 0 } }
        });
        window.dispatchEvent(event);
      }
      Object.defineProperty(performance, 'now', { configurable: true, value: originalNow });
    });
    await page.waitForFunction(() => document.getElementById('mindBasicImuStatus')
      ?.textContent.includes('IMU 已校准'));
    assert.equal(await page.$eval('#mindBasicImuToggle', (button) => button.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.$eval('#mindBasicImuStabilize', (input) => input.disabled), false);
    await page.click('#mindBasicImuToggle');
    assert.equal(await page.$eval('#mindBasicImuToggle', (button) => button.getAttribute('aria-pressed')), 'false');
    assert.match(await page.$eval('#mindBasicImuStatus', (element) => element.textContent), /IMU 已关闭/u);
    await page.evaluate(() => {
      const makeVector = (values) => ({
        x: values[0], y: values[1], z: values[2], w: values[3],
        toArray() { return values.slice(); },
        clone() { return makeVector(values.slice()); },
        set(...next) {
          values.splice(0, next.length, ...next);
          [this.x, this.y, this.z, this.w] = next;
        }
      });
      const anchor = document.getElementById('mindBasicTargetAnchor');
      const stage = document.getElementById('mindBasicImuStage');
      anchor.object3D = {
        position: makeVector([0.25, 0.5, -1]),
        quaternion: makeVector([0, 0, 0, 1]),
        scale: makeVector([1, 1, 1])
      };
      anchor.object3D.matrixAutoUpdate = false;
      anchor.object3D.matrix = {
        position: [0.25, 0.5, -1],
        decompose(position, quaternion, scale) {
          position.set(...this.position);
          quaternion.set(0, 0, 0, 1);
          scale.set(1, 1, 1);
        }
      };
      // 模拟真实 MindAR：只更新矩阵，分量保持旧值；应用必须分解矩阵读取。
      anchor.object3D.position.set(99, 99, 99);
      stage.object3D = {
        position: makeVector([0, 0, 0]),
        quaternion: makeVector([0, 0, 0, 1]),
        scale: makeVector([1, 1, 1]),
        updateMatrix() {}
      };
      document.getElementById('mindBasicCameraRig').object3D = {
        position: makeVector([0, 0, 0]),
        quaternion: makeVector([0, 0, 0, 1]),
        scale: makeVector([1, 1, 1]),
        updateMatrix() {}
      };
      anchor.dispatchEvent(new Event('targetFound'));
      anchor.dispatchEvent(new Event('targetUpdate'));
    });
    await page.waitForFunction(() => document.getElementById('mindBasicCameraRig')
      ?.object3D?.position.x === -0.25);
    assert.equal(await page.$eval('#mindBasicImuStage', (stage) => stage.object3D.visible), true);
    await page.click('#mindBasicImuToggle');
    await page.evaluate(() => {
      const originalNow = performance.now.bind(performance);
      window.imuClock = originalNow();
      Object.defineProperty(performance, 'now', { configurable: true, value: () => window.imuClock });
      window.restoreImuClock = () => Object.defineProperty(performance, 'now', { configurable: true, value: originalNow });
      window.emitImu = (rate = { alpha: 0, beta: 0, gamma: 0 }, acceleration = { x: 0, y: 0, z: 0 }) => {
        const event = new Event('devicemotion');
        Object.defineProperties(event, {
          rotationRate: { value: rate }, acceleration: { value: acceleration }
        });
        window.dispatchEvent(event);
      };
      window.tickImu = () => AFRAME.components['mind-basic-imu-frame'].tick(performance.now());
      for (let i = 0; i < 24; i += 1) { window.imuClock += 60; window.emitImu(); }
      document.getElementById('mindBasicTargetAnchor').dispatchEvent(new Event('targetUpdate'));
    });
    assert.equal(await page.$('#mindBasicImuTranslationEnabled'), null);
    assert.equal(await page.$eval('#mindBasicImuBridge', (input) => input.checked), true);
    const predictions = await page.evaluate(async () => {
      window.emitImu();
      const camera = document.getElementById('mindBasicCameraRig').object3D;
      const before = camera.quaternion.toArray();
      window.imuClock += 25;
      window.emitImu({ alpha: 0, beta: 0, gamma: 90 });
      window.tickImu();
      const first = camera.quaternion.toArray();
      window.imuClock += 25;
      window.emitImu({ alpha: 0, beta: 0, gamma: 90 });
      window.tickImu();
      return { before, first, second: camera.quaternion.toArray() };
    });
    assert.ok(predictions.first[1] > predictions.before[1], '视觉没有新帧时仍须更新 IMU 预测的相机旋转');
    assert.ok(predictions.second[1] > predictions.first[1]);
    await page.evaluate(async () => {
      window.imuClock += 280;
      window.tickImu();
    });
    assert.equal(await page.$eval('#mindBasicCameraRig', (camera) => camera.object3D.quaternion.y), predictions.second[1],
      '传感器过期时保留已融合的相机旋转，不跳回旧视觉矩阵');
    await page.evaluate(async () => {
      const anchor = document.getElementById('mindBasicTargetAnchor');
      anchor.dispatchEvent(new Event('targetUpdate'));
      await Promise.resolve();
      window.emitImu();
      window.imuClock += 25;
      window.emitImu();
      const hold = document.getElementById('mindBasicImuHold');
      hold.value = '200';
      hold.dispatchEvent(new Event('input'));
      anchor.dispatchEvent(new Event('targetLost'));
      window.tickImu();
    });
    assert.equal(await page.$eval('#mindBasicImuStage', (stage) => stage.object3D.visible), true);
    await page.evaluate(async () => {
      for (let i = 0; i < 6; i += 1) {
        window.imuClock += 40;
        window.emitImu();
        window.tickImu();
      }
    });
    assert.equal(await page.$eval('#mindBasicImuStage', (stage) => stage.object3D.visible), true,
      '平移预测超时仍保留模型，陀螺仪继续驱动旋转');
    await page.evaluate(() => {
      document.getElementById('mindBasicTargetAnchor').dispatchEvent(new Event('targetFound'));
    });
    await page.waitForFunction(() => document.getElementById('mindBasicImuStage').object3D.visible);
    await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
    assert.equal(await page.$eval('#mindBasicImuStage', (stage) => stage.object3D.visible), false);
    await page.evaluate(() => { window.imuClock += 1; document.getElementById('mindBasicTargetAnchor').dispatchEvent(new Event('targetUpdate')); });
    await page.waitForFunction(() => document.getElementById('mindBasicImuStage').object3D.visible);
    await page.evaluate(async () => {
      window.emitImu();
      for (let i = 0; i < 15; i += 1) {
        window.imuClock += 40;
        window.emitImu();
        window.tickImu();
      }
    });
    assert.equal(await page.$eval('#mindBasicImuStage', (stage) => stage.object3D.visible), true,
      '没有视觉新观测时保留模型并继续旋转预测');
    await page.evaluate(() => { window.imuClock += 1; document.getElementById('mindBasicTargetAnchor').dispatchEvent(new Event('targetUpdate')); });
    await page.waitForFunction(() => document.getElementById('mindBasicImuStage').object3D.visible);
    const translation = await page.evaluate(async () => {
      const anchor = document.getElementById('mindBasicTargetAnchor');
      const camera = document.getElementById('mindBasicCameraRig').object3D;
      const system = document.getElementById('mindBasicScene').systems['mindar-image-system'];
      system.controller = { trackingStates: [{ isTracking: true }] };
      for (let i = 0; i < 4; i += 1) {
        window.imuClock += 20;
        window.emitImu();
        anchor.dispatchEvent(new Event('targetUpdate'));
        await Promise.resolve();
      }
      const before = camera.position.x;
      for (let i = 0; i < 3; i += 1) {
        window.imuClock += 20;
        window.emitImu(undefined, { x: 1, y: 0, z: 0 });
        window.tickImu();
      }
      const after = camera.position.x;
      system.controller.trackingStates[0].isTracking = false;
      anchor.object3D.matrix.position = [99, 99, -99];
      anchor.dispatchEvent(new Event('targetUpdate'));
      await Promise.resolve();
      const afterStale = camera.position.x;
      anchor.object3D.matrix.position = [0.25, 0.5, -1];
      system.controller.trackingStates[0].isTracking = true;
      // 未收到正式 targetLost 的短暂失败也必须走三帧重获确认。
      const recovery = [];
      for (let i = 0; i < 3; i += 1) {
        window.imuClock += 20;
        anchor.dispatchEvent(new Event('targetUpdate'));
        await Promise.resolve();
        recovery.push(camera.position.x);
      }
      return { before, after, afterStale, recovery };
    });
    assert.ok(translation.after > translation.before, '跟踪期间向右加速，更新世界中的相机位置');
    assert.equal(translation.afterStale, translation.after, '跟踪失败时重复的旧矩阵不得覆盖融合结果');
    assert.equal(translation.recovery[0], translation.afterStale);
    assert.equal(translation.recovery[1], translation.afterStale);
    assert.notEqual(translation.recovery[2], translation.afterStale, '第三帧稳定观测后恢复纠偏');
    const phaseSwitches = await page.evaluate(async () => {
      const anchor = document.getElementById('mindBasicTargetAnchor');
      const stage = document.getElementById('mindBasicImuStage').object3D;
      const camera = document.getElementById('mindBasicCameraRig').object3D;
      const visible = document.getElementById('mindBasicImuStabilize');
      const hidden = document.getElementById('mindBasicImuBridge');
      const set = (input, checked) => { input.checked = checked; input.dispatchEvent(new Event('change')); };
      const move = () => {
        for (let i = 0; i < 3; i += 1) {
          window.imuClock += 20;
          window.emitImu({ alpha: 0, beta: 0, gamma: 90 }, { x: 1, y: 0, z: 0 });
          window.tickImu();
        }
      };
      const snapshot = () => ({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), visible: stage.visible });
      set(visible, false);
      const beforeVisibleOff = snapshot(); move(); const afterVisibleOff = snapshot();
      anchor.dispatchEvent(new Event('targetLost'));
      const beforeHiddenOn = snapshot(); move(); const afterHiddenOn = snapshot();
      set(hidden, false);
      const beforeHiddenOff = snapshot(); move(); const afterHiddenOff = snapshot();
      set(visible, true); move(); const onlyVisibleOnWhileLost = snapshot();
      set(hidden, true); move(); const resumed = snapshot();
      anchor.dispatchEvent(new Event('targetFound'));
      return { beforeVisibleOff, afterVisibleOff, beforeHiddenOn, afterHiddenOn,
        beforeHiddenOff, afterHiddenOff, onlyVisibleOnWhileLost, resumed };
    });
    assert.deepEqual(phaseSwitches.afterVisibleOff, phaseSwitches.beforeVisibleOff,
      '可见场景关闭时，旋转和平移都停止预测');
    assert.notDeepEqual(phaseSwitches.afterHiddenOn.position, phaseSwitches.beforeHiddenOn.position);
    assert.notDeepEqual(phaseSwitches.afterHiddenOn.quaternion, phaseSwitches.beforeHiddenOn.quaternion);
    assert.deepEqual(phaseSwitches.afterHiddenOff, phaseSwitches.beforeHiddenOff,
      '不可见场景关闭时模型保持显示，旋转和平移都冻结');
    assert.deepEqual(phaseSwitches.onlyVisibleOnWhileLost, phaseSwitches.afterHiddenOff,
      '失锁时仅开启可见场景不会偷偷预测');
    assert.notDeepEqual(phaseSwitches.resumed.quaternion, phaseSwitches.afterHiddenOff.quaternion);
    assert.equal(phaseSwitches.resumed.visible, true);
    await page.click('#mindBasicImuToggle');
    await page.evaluate(() => {
      const anchor = document.getElementById('mindBasicTargetAnchor');
      window.restoreImuClock();
      anchor.object3D.matrix.position = [0.4, 0.5, -1];
      anchor.dispatchEvent(new Event('targetUpdate'));
    });
    await page.waitForFunction(() => document.getElementById('mindBasicCameraRig').object3D.position.x === -0.4);
    await page.evaluate(() => document.getElementById('mindBasicTargetAnchor')
      .dispatchEvent(new Event('targetLost')));
    assert.equal(await page.$eval('#mindBasicImuStage', (stage) => stage.object3D.visible), true);

    await page.click('#mindBasicCaptureButton');
    assert.equal(await page.$eval('#mindBasicImuStage', (stage) => stage.object3D.visible), false,
      '停止跟踪并进入拍照时必须清除旧模型');
    await page.waitForFunction(() => {
      const video = document.getElementById('mindBasicCameraVideo');
      return video.videoWidth === 800 && video.videoHeight === 600
        && document.getElementById('mindBasicCropFrame').hidden;
    });
    await page.click('#mindBasicTakePhotoButton');
    await page.waitForFunction(() => !document.getElementById('mindBasicCalibrationCanvas').hidden
      && !document.getElementById('mindBasicCropFrame').hidden);
    let frameRatios = await page.evaluate(() => {
      const canvas = document.getElementById('mindBasicCalibrationCanvas').getBoundingClientRect();
      const frame = document.getElementById('mindBasicCropFrame').getBoundingClientRect();
      return {
        left: (frame.left - canvas.left) / canvas.width,
        top: (frame.top - canvas.top) / canvas.height,
        width: frame.width / canvas.width,
        height: frame.height / canvas.height
      };
    });
    for (const key of ['left', 'top']) assert.ok(Math.abs(frameRatios[key] - 0.1) < 0.015, `${key}: ${frameRatios[key]}`);
    for (const key of ['width', 'height']) assert.ok(Math.abs(frameRatios[key] - 0.8) < 0.02, `${key}: ${frameRatios[key]}`);
    let sourceSize = await page.$eval('#mindBasicCalibrationCanvas', (canvas) => ({
      width: canvas.width,
      height: canvas.height
    }));
    assert.deepEqual(sourceSize, { width: 800, height: 600 });
    assert.equal(await page.$('#mindBasicCropPreview'), null);
    assert.equal(await page.$eval('#mindBasicCropFrame', (frame) => getComputedStyle(frame).borderTopColor), 'rgb(34, 156, 255)');

    const canvasBounds = await page.$eval('#mindBasicCalibrationCanvas', (canvas) => canvas.getBoundingClientRect().toJSON());
    const initialFrame = await page.$eval('#mindBasicCropFrame', (frame) => frame.getBoundingClientRect().toJSON());
    await page.mouse.move(initialFrame.x + initialFrame.width / 2, initialFrame.y + initialFrame.height / 2);
    await page.mouse.down();
    await page.mouse.move(initialFrame.x + initialFrame.width / 2 + canvasBounds.width * 0.1,
      initialFrame.y + initialFrame.height / 2 + canvasBounds.height * 0.05, { steps: 4 });
    await page.mouse.up();
    frameRatios = await page.evaluate(() => {
      const canvas = document.getElementById('mindBasicCalibrationCanvas').getBoundingClientRect();
      const frame = document.getElementById('mindBasicCropFrame').getBoundingClientRect();
      return { left: (frame.left - canvas.left) / canvas.width, top: (frame.top - canvas.top) / canvas.height,
        width: frame.width / canvas.width, height: frame.height / canvas.height };
    });
    assert.ok(Math.abs(frameRatios.left - 0.2) < 0.02, `moved left: ${frameRatios.left}`);
    assert.ok(Math.abs(frameRatios.top - 0.15) < 0.02, `moved top: ${frameRatios.top}`);

    const northWestHandle = await page.$('[data-crop-handle="nw"]');
    const northWestBounds = await northWestHandle.boundingBox();
    await page.mouse.move(northWestBounds.x + northWestBounds.width / 2, northWestBounds.y + northWestBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(northWestBounds.x + northWestBounds.width / 2 + canvasBounds.width * 0.05,
      northWestBounds.y + northWestBounds.height / 2 + canvasBounds.height * 0.05, { steps: 4 });
    await page.mouse.up();
    frameRatios = await page.evaluate(() => {
      const canvas = document.getElementById('mindBasicCalibrationCanvas').getBoundingClientRect();
      const frame = document.getElementById('mindBasicCropFrame').getBoundingClientRect();
      return { left: (frame.left - canvas.left) / canvas.width, top: (frame.top - canvas.top) / canvas.height,
        width: frame.width / canvas.width, height: frame.height / canvas.height };
    });
    assert.ok(Math.abs(frameRatios.left - 0.25) < 0.02, `resized left: ${frameRatios.left}`);
    assert.ok(Math.abs(frameRatios.top - 0.2) < 0.02, `resized top: ${frameRatios.top}`);
    assert.deepEqual(await page.$eval('#mindBasicCalibrationCanvas', (canvas) => ({ width: canvas.width, height: canvas.height })),
      { width: 800, height: 600 });

    await page.click('#mindBasicRetakeButton');
    await page.waitForFunction(() => document.getElementById('mindBasicCameraVideo').videoWidth === 800
      && document.getElementById('mindBasicCropFrame').hidden);
    await page.click('#mindBasicTakePhotoButton');
    await page.waitForFunction(() => !document.getElementById('mindBasicCalibrationCanvas').hidden
      && !document.getElementById('mindBasicCropFrame').hidden);
    sourceSize = await page.$eval('#mindBasicCalibrationCanvas', (canvas) => ({ width: canvas.width, height: canvas.height }));
    assert.deepEqual(sourceSize, { width: 800, height: 600 });
    assert.equal(await page.$('#mindBasicCropPreviewPanel'), null);
    const eastHandle = await page.$('[data-crop-handle="e"]');
    const eastBounds = await eastHandle.boundingBox();
    const secondCanvasBounds = await page.$eval('#mindBasicCalibrationCanvas', (canvas) => canvas.getBoundingClientRect().toJSON());
    await page.mouse.move(eastBounds.x + eastBounds.width / 2, eastBounds.y + eastBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(eastBounds.x + eastBounds.width / 2 + secondCanvasBounds.width * 0.02,
      eastBounds.y + eastBounds.height / 2, { steps: 3 });
    await page.mouse.up();
    frameRatios = await page.evaluate(() => {
      const canvas = document.getElementById('mindBasicCalibrationCanvas').getBoundingClientRect();
      const frame = document.getElementById('mindBasicCropFrame').getBoundingClientRect();
      return { width: frame.width / canvas.width, height: frame.height / canvas.height };
    });
    assert.ok(Math.abs(frameRatios.width - 0.82) < 0.02, `resized width: ${frameRatios.width}`);
    assert.ok(Math.abs(frameRatios.height - 0.8) < 0.02, `resized height: ${frameRatios.height}`);

    await page.$eval('#mindBasicTargetName', (input) => { input.value = '浏览器矩形测试'; });
    await page.click('#mindBasicSaveButton');
    await page.waitForFunction(() => document.getElementById('mindBasicStatus')?.textContent.includes('定位已启动'));
    const records = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('mind-basic-targets', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('targets', 'readonly');
        const getAll = transaction.objectStore('targets').getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      };
    }));
    assert.equal(records.length, 1);
    assert.equal(records[0].name, '浏览器矩形测试');
    assert.ok(Math.abs(records[0].cropRect.x - 0.1) < 0.01);
    assert.ok(Math.abs(records[0].cropRect.y - 0.1) < 0.01);
    assert.ok(Math.abs(records[0].cropRect.width - 0.82) < 0.01);
    assert.ok(Math.abs(records[0].cropRect.height - 0.8) < 0.01);
    assert.equal(Object.hasOwn(records[0], 'selectedQuad'), false);
    assert.match(await page.$eval('#mindBasicTargetSelect', (select) => select.value), /^[-\w]+/u);
    assert.deepEqual(pageErrors, []);
  } finally {
    if (browser) await browser.close();
    if (localServer) await new Promise((resolve) => localServer.server.close(resolve));
  }
});
