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
  return withoutExternalEngines.replace('<script src="./mind-basic-geometry.js"></script>',
    `${fixture}\n    <script src="./mind-basic-geometry.js"></script>`);
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

    await page.click('#mindBasicCaptureButton');
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
