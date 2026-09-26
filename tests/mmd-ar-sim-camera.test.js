'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');

const WEB_ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const NESTED_PATH = '/mnt/AASC/3rd/mmd-ar-test/web-dist/';
const PUBLIC_PATH = '/mnt/mmd-ar/';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium']
  .find((candidate) => candidate && fs.existsSync(candidate));

test('无摄像头电脑可用经纬度与缩放模拟画面定位，拖动平移并在停止后释放流', {
  skip: !CHROME || !fs.existsSync(path.join(WEB_ROOT, 'index.html')),
  timeout: 120000,
}, async () => {
  const html = fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="mmdArInputMode"/u);
  for (const id of ['mmdArSimZoom', 'mmdArSimLatitude', 'mmdArSimLongitude',
    'mmdArSimHorizontalRotation', 'mmdArSimReset']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'));
  }
  assert.doesNotMatch(html, /id="mmdArSimHandles"/u);
  assert.match(html, /display-mmd-ar-sim-camera\.js/u);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const prefix = [NESTED_PATH, PUBLIC_PATH].find((candidate) => pathname.startsWith(candidate));
    if (!prefix) return void response.writeHead(404).end();
    const relative = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
    const absolute = path.resolve(WEB_ROOT, relative);
    if (!absolute.startsWith(`${WEB_ROOT}${path.sep}`) || !fs.existsSync(absolute)
      || !fs.statSync(absolute).isFile()) return void response.writeHead(404).end();
    response.setHeader('Content-Type', /\.m?js$/u.test(absolute) ? 'text/javascript'
      : /\.html$/u.test(absolute) ? 'text/html'
        : /\.css$/u.test(absolute) ? 'text/css'
          : /\.json$/u.test(absolute) ? 'application/json'
            : /\.png$/u.test(absolute) ? 'image/png' : 'application/octet-stream');
    fs.createReadStream(absolute).pipe(response);
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 120000,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if ([NESTED_PATH, PUBLIC_PATH].some((prefix) => new URL(request.url()).pathname.startsWith(`${prefix}mmd/`))) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}${NESTED_PATH}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.DisplayMmd?.init && window.DisplayMmdAr?.getState?.().targetCount > 0
      && document.getElementById('mmdArAframeScene')?.hasLoaded, { timeout: 30000 });
    await page.evaluate(() => {
      window.__cameraCalls = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.__cameraCalls += 1;
        throw new Error('测试环境没有实体摄像头');
      };
      document.getElementById('displayArTargetPanel').hidden = false;
    });
    await page.select('#mmdArInputMode', 'simulated');
    const missingImage = await page.evaluate(async () => {
      try { await window.MmdArTestSimCamera.getStream(); return ''; }
      catch (error) { return error.message; }
    });
    assert.match(missingImage, /先选择模拟摄像头图片/u);
    assert.equal(await page.evaluate(() => window.__cameraCalls), 0);
    await page.$eval('#mmdArSimFile', (input) => { input.hidden = false; });
    const input = await page.$('#mmdArSimFile');
    await input.uploadFile(path.resolve(__dirname, '../3rd/mmd-ar-test/testimg/target.jpg'));
    await page.waitForFunction(() => window.MmdArTestSimCamera?.getState().imageWidth === 662);
    const portrait = await page.evaluate(() => {
      const canvas = document.getElementById('mmdArSimCanvas');
      const preview = document.getElementById('mmdArSimPreview');
      return { frame: [canvas.width, canvas.height], aspectRatio: preview.style.aspectRatio };
    });
    assert.deepEqual(portrait.frame, [960, Math.round(960 * 867 / 662)]);
    assert.equal(portrait.aspectRatio, '662 / 867');
    await page.waitForFunction(() => {
      const horizontal = document.getElementById('mmdArSimHorizontalRotation').getBoundingClientRect().width;
      const maximum = document.getElementById('mmdArSimPreview').getBoundingClientRect().height;
      const actual = document.getElementById('mmdArSimLatitude').getBoundingClientRect().height;
      const longitude = document.getElementById('mmdArSimLongitude').getBoundingClientRect().height;
      const expected = Math.min(maximum, Math.max(48, horizontal * 867 / 662));
      return Math.abs(actual - expected) < 2 && Math.abs(longitude - expected) < 2;
    }, { timeout: 5000 });
    await input.uploadFile(path.resolve(__dirname, '../3rd/mmd-ar-test/testimg/mindar.JPG'));
    await page.waitForFunction(() => window.MmdArTestSimCamera?.getState().imageWidth === 812);
    const expectedFrame = [960, Math.round(960 * 429 / 812)];
    assert.deepEqual(await page.$eval('#mmdArSimCanvas', (element) => [element.width, element.height]), expectedFrame);
    await page.waitForFunction(() => {
      const image = window.MmdArTestSimCamera.getState();
      const horizontal = document.getElementById('mmdArSimHorizontalRotation').getBoundingClientRect().width;
      const maximum = document.getElementById('mmdArSimPreview').getBoundingClientRect().height;
      const actual = document.getElementById('mmdArSimLatitude').getBoundingClientRect().height;
      const longitude = document.getElementById('mmdArSimLongitude').getBoundingClientRect().height;
      const expected = Math.min(maximum, Math.max(48, horizontal * image.imageHeight / image.imageWidth));
      return Math.abs(actual - expected) < 2 && Math.abs(longitude - expected) < 2;
    }, { timeout: 5000 });
    const layout = await page.evaluate(() => {
      const bounds = (id) => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      return { preview: bounds('mmdArSimPreview'), zoom: bounds('mmdArSimZoom'),
        latitude: bounds('mmdArSimLatitude'), longitude: bounds('mmdArSimLongitude'),
        horizontalRotation: bounds('mmdArSimHorizontalRotation') };
    });
    assert.ok(layout.zoom.bottom <= layout.preview.top, '缩放滑条应在画面上方');
    assert.ok(layout.latitude.left >= layout.preview.right, '纬度滑条应在画面右侧');
    assert.ok(layout.longitude.right <= layout.preview.left, '经度滑条应在画面左侧');
    assert.ok(layout.horizontalRotation.top >= layout.preview.bottom, '水平旋转滑条应在画面下方');
    const before = await page.evaluate(() => ({
      corners: window.MmdArTestSimCamera.getState().corners,
      frame: document.getElementById('mmdArSimCanvas').toDataURL(),
    }));
    await page.$eval('#mmdArSimLongitude', (slider) => { slider.value = '35'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    const yawOnly = await page.evaluate(() => window.MmdArTestSimCamera.getState().corners);
    assert.ok(Math.abs(yawOnly[0].x - yawOnly[3].x) < 0.001, '单独旋转经度时左边仍应投影为竖线');
    assert.ok(Math.abs(yawOnly[1].x - yawOnly[2].x) < 0.001, '单独旋转经度时右边仍应投影为竖线');
    assert.ok(Math.abs((yawOnly[3].y - yawOnly[0].y) - (yawOnly[2].y - yawOnly[1].y)) > 0.01,
      '两侧投影高度应随深度产生透视差');
    const rotationRange = await page.$eval('#mmdArSimHorizontalRotation', (slider) => {
      const range = [slider.min, slider.max];
      slider.value = '360'; slider.dispatchEvent(new Event('input', { bubbles: true }));
      return range;
    });
    assert.deepEqual(rotationRange, ['0', '360']);
    const fullCircle = await page.evaluate(() => window.MmdArTestSimCamera.getState().corners);
    fullCircle.forEach((point, index) => {
      assert.ok(Math.abs(point.x - yawOnly[index].x) < 0.001);
      assert.ok(Math.abs(point.y - yawOnly[index].y) < 0.001);
    });
    await page.$eval('#mmdArSimHorizontalRotation', (slider) => {
      slider.value = '90'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const spun = await page.evaluate(() => window.MmdArTestSimCamera.getState().corners);
    const frameAspect = expectedFrame[0] / expectedFrame[1];
    const yawRadians = 35 * Math.PI / 180;
    spun.forEach((point, index) => {
      const planeX = -(before.corners[index].y - 0.5);
      const planeY = (before.corners[index].x - 0.5) * frameAspect;
      const depth = -planeX * Math.sin(yawRadians);
      const perspective = 1.6 / (1.6 + depth);
      assert.ok(Math.abs(point.x - (0.5 + planeX * Math.cos(yawRadians) * perspective / frameAspect)) < 0.001,
        '水平旋转应先转动三维平面，再计算经度透视与画布宽高比');
      assert.ok(Math.abs(point.y - (0.5 + planeY * perspective)) < 0.001);
    });
    await page.$eval('#mmdArSimLatitude', (slider) => { slider.value = '-25'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.$eval('#mmdArSimZoom', (slider) => { slider.value = '130'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    const after = await page.evaluate(() => ({
      corners: window.MmdArTestSimCamera.getState().corners,
      frame: document.getElementById('mmdArSimCanvas').toDataURL(),
      pose: window.MmdArTestSimCamera.getState().pose,
    }));
    assert.notDeepEqual(after.corners, before.corners);
    assert.notEqual(after.frame, before.frame);
    assert.equal(after.pose.longitude, 35);
    assert.equal(after.pose.latitude, -25);
    assert.equal(after.pose.horizontalRotation, 90);
    assert.equal(after.pose.zoom, 1.3);
    const canvasHandle = await page.$('#mmdArSimCanvas');
    await canvasHandle.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'center' }));
    const bounds = await canvasHandle.boundingBox();
    assert.ok(bounds, '模拟画布应可见');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + bounds.height / 2 + 15, { steps: 4 });
    await page.mouse.up();
    const dragged = await page.evaluate(() => window.MmdArTestSimCamera.getState());
    assert.ok(dragged.pose.panX > 0 && dragged.pose.panY > 0, '拖动画面应仅修改平移参数');
    assert.equal(dragged.pose.longitude, 35);
    assert.equal(dragged.pose.latitude, -25);
    await page.click('#mmdArSimReset');
    assert.deepEqual(await page.evaluate(() => window.MmdArTestSimCamera.getState().corners), before.corners);
    assert.deepEqual(await page.evaluate(() => window.MmdArTestSimCamera.getState().pose),
      { zoom: 1, latitude: 0, longitude: 0, horizontalRotation: 0, panX: 0, panY: 0 });
    await page.click('#displayArCalibrationButton');
    await page.waitForFunction(() => !document.getElementById('displayArCalibration').hidden
      && document.getElementById('displayArCameraVideo').videoWidth === 960, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__cameraCalls), 0);
    assert.equal(await page.evaluate(() => window.MmdArTestSimCamera.getState().streaming), true);
    await page.click('#displayArCaptureButton');
    await page.waitForFunction(() => !document.getElementById('displayArCalibrationCanvas').hidden
      && !document.getElementById('displayArSaveButton').disabled);
    const capturedSize = await page.$eval('#displayArCalibrationCanvas', (element) => [element.width, element.height]);
    assert.deepEqual(capturedSize, expectedFrame);
    const selectionMessage = await page.evaluate(() => {
      const canvas = document.getElementById('displayArCalibrationCanvas');
      const drag = (start, end, pointerId) => {
        const bounds = canvas.getBoundingClientRect();
        const point = ([x, y]) => ({ clientX: bounds.left + x * bounds.width, clientY: bounds.top + y * bounds.height });
        canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId,
          isPrimary: true, button: 0, ...point(start) }));
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId,
          isPrimary: true, button: 0, ...point(end) }));
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId,
          isPrimary: true, button: 0, ...point(end) }));
      };
      drag([0.5, 0.5], [0.6, 0.55], 41);
      drag([0.95, 0.55], [0.8, 0.55], 42);
      return document.getElementById('displayArCalibrationHint').textContent;
    });
    assert.match(selectionMessage, /选区有效/u);
    const targetCountBeforeSave = await page.evaluate(() => window.DisplayMmdAr.getState().targetCount);
    await page.click('#displayArSaveButton');
    await page.waitForFunction((count) => window.DisplayMmdAr.getState().targetCount === count + 1,
      { timeout: 15000 }, targetCountBeforeSave);
    assert.equal(await page.evaluate(() => window.MmdArTestSimCamera.getState().streaming), false);
    const savedImageSize = await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('aasc-mmd-ar', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const targetId = window.DisplayMmdAr.getState().selectedTargetId;
      const target = await new Promise((resolve, reject) => {
        const request = database.transaction('targets', 'readonly').objectStore('targets').get(targetId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      const bitmap = await createImageBitmap(target.referenceImageBlob);
      const size = [bitmap.width, bitmap.height];
      bitmap.close();
      return { size, selectedQuad: target.selectedQuad };
    });
    assert.deepEqual(savedImageSize.size, expectedFrame);
    assert.ok(Math.abs(savedImageSize.selectedQuad[0].x - 0.25) < 0.01);
    assert.ok(Math.abs(savedImageSize.selectedQuad[0].y - 0.2) < 0.01);
    assert.ok(Math.abs(savedImageSize.selectedQuad[1].x - 0.8) < 0.01);
    assert.ok(Math.abs(savedImageSize.selectedQuad[1].y - 0.2) < 0.01);
    assert.equal(await page.evaluate(() => window.__cameraCalls), 0);
    const tracked = await page.evaluate(async () => {
      const originalMmd = window.DisplayMmd;
      let arPoseCalls = 0;
      window.DisplayMmd = Object.freeze({ ...originalMmd, setArCameraPose(pose) {
        if (pose?.anchorMatrix?.length === 16 && pose?.projectionMatrix?.length === 16) arPoseCalls += 1;
        return true;
      } });
      const blob = await (await fetch('./assets/mindar-official-card.png')).blob();
      const session = await window.DisplayMmdImageTargetTracker.start({
        targetId: 'builtin:mindar-official-card', referenceImageBlob: blob,
        selectedQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      });
      const system = document.getElementById('mmdArAframeScene').systems['mindar-image-system'];
      const videoTrack = system.video.srcObject.getVideoTracks()[0];
      let result;
      try {
        const deadline = performance.now() + 20000;
        let found = false;
        while (performance.now() < deadline && !found) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          found = (await session.processFrame()).visible === true;
        }
        result = { found, cameraCalls: window.__cameraCalls,
          arPoseCalls,
          streaming: window.MmdArTestSimCamera.getState().streaming,
          videoSize: [system.video?.videoWidth, system.video?.videoHeight] };
      } finally {
        await session.stop();
        window.DisplayMmd = originalMmd;
        if (result) result.trackAfterStop = videoTrack.readyState;
      }
      return result;
    });
    assert.equal(tracked.cameraCalls, 0);
    assert.ok(tracked.arPoseCalls > 0, '目标更新应把 A-Frame 锚点与投影交给 MMD 相机');
    assert.equal(tracked.streaming, true);
    assert.deepEqual(tracked.videoSize, expectedFrame);
    assert.equal(tracked.found, true, `模拟视频未识别目标：${JSON.stringify(tracked)}; errors=${errors.join(' | ')}`);
    assert.equal(tracked.trackAfterStop, 'ended');
    assert.equal(await page.evaluate(() => window.MmdArTestSimCamera.getState().streaming), false);
    await page.select('#mmdArInputMode', 'camera');
    assert.equal(await page.$eval('#mmdArSimControls', (element) => element.hidden), true);
    const realCameraError = await page.evaluate(async () => {
      try { await window.MmdArTestSimCamera.getStream(); return ''; }
      catch (error) { return error.message; }
    });
    assert.match(realCameraError, /没有实体摄像头/u);
    assert.equal(await page.evaluate(() => window.__cameraCalls), 1);
    assert.equal(errors.length, 0, errors.join(' | '));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
