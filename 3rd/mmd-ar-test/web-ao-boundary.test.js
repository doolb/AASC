'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');
const { WEB_PANEL_GROUP_JS } = require('./web-panel-groups');

async function withBrowser(run) {
  const root = path.join(__dirname, 'web-dist');
  const $ = cheerio.load(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  $('script').remove();
  $('body').append(`<script>${WEB_PANEL_GROUP_JS}</script>`);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/' || pathname === '/ui') {
      res.setHeader('Content-Type', 'text/html');
      res.end(pathname === '/ui' ? $.html() : '<!doctype html><body></body>');
      return;
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
    fs.createReadStream(file).pipe(res);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    await run(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

test('边界开关默认开启，保存选择，全分辨率禁用并在切回时恢复', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/ui');
    const read = () => page.evaluate(() => {
      const input = document.querySelector('.mmd-ar-edge-correction input');
      return { checked: input.checked, disabled: input.disabled, flag: window.MmdArTestEdgeCorrection };
    });
    assert.deepEqual(await read(), { checked: true, disabled: false, flag: true });
    await page.evaluate(() => {
      const input = document.querySelector('.mmd-ar-edge-correction input');
      input.checked = false;
      input.dispatchEvent(new Event('change'));
    });
    await page.reload();
    assert.deepEqual(await read(), { checked: false, disabled: false, flag: false });
    await page.evaluate(() => {
      const resolution = document.getElementById('displayMmdPmxAoResolution');
      resolution.value = 'full'; resolution.dispatchEvent(new Event('change'));
    });
    assert.equal((await read()).disabled, true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mmd-ar-ao-size', { detail: { reduced: true } })));
    assert.deepEqual(await read(), { checked: false, disabled: false, flag: false });
    const blocked = await browser.newPage();
    await blocked.evaluateOnNewDocument(() => {
      Storage.prototype.getItem = () => { throw new Error('blocked'); };
      Storage.prototype.setItem = () => { throw new Error('blocked'); };
    });
    await blocked.goto(origin + '/ui');
    assert.equal(await blocked.evaluate(() => window.MmdArTestEdgeCorrection), true);
    await blocked.evaluate(() => {
      const input = document.querySelector('.mmd-ar-edge-correction input');
      input.checked = false; input.dispatchEvent(new Event('change'));
    });
    assert.equal(await blocked.evaluate(() => window.MmdArTestEdgeCorrection), false);
  });
});

test('重叠前景边界的法线与 AO 修正、全尺寸旁路及开关耗时对照', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /shader|compile|webgl/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(origin);
    const report = await page.evaluate(async () => {
      const THREE = await import('/js/vendor/three/three.module.js');
      const { createPmxAmbientOcclusion } = await import('/js/display-pmx-ao.mjs');
      const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x172031, 0);
      const scene = new THREE.Scene();
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const back = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), material);
      back.rotation.set(0.1, 0.15, 0);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(12, 15), material);
      front.rotation.set(0.1, -0.4, 0.2);
      front.position.set(0.17, 0.13, 5);
      const thin = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 12), material);
      thin.position.set(10.17, 0, 4);
      scene.add(back, front, thin);
      const camera = new THREE.PerspectiveCamera(50, 1, 24, 75);
      camera.position.z = 40;
      const ao = createPmxAmbientOcclusion({ THREE, renderer, scene, camera });
      ao.setRadius(5);
      ao.setBlurPasses(1, [3, 3, 3]);
      const gl = renderer.getContext();
      const reports = [];
      for (const [width, height, intersecting] of [[128, 128, false], [129, 127, false], [97, 1441, false], [128, 128, true]]) {
        front.position.z = intersecting ? 0 : 5;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        ao.resize(width, height);
        const draw = (resolution, preview, correction) => {
          ao.setResolution(resolution);
          window.MmdArTestNormalPreview = preview;
          window.MmdArTestEdgeCorrection = correction;
          ao.render();
          const bytes = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          return bytes;
        };
        for (const preview of [true, false]) {
          const full = draw('full', preview, false);
          const fullOn = draw('full', preview, true);
          const half = draw('half', preview, false);
          const halfOn = draw('half', preview, true);
          let offError = 0, onError = 0, badOff = 0, badOn = 0, bypassDifference = 0, alphaDifference = 0;
          for (let i = 0; i < full.length; i += 4) {
            let pixelOff = 0, pixelOn = 0;
            for (let c = 0; c < 3; c++) {
              pixelOff = Math.max(pixelOff, Math.abs(full[i + c] - half[i + c]));
              pixelOn = Math.max(pixelOn, Math.abs(full[i + c] - halfOn[i + c]));
              bypassDifference += Math.abs(full[i + c] - fullOn[i + c]);
            }
            offError += pixelOff; onError += pixelOn;
            if (pixelOff > 8) badOff++;
            if (pixelOn > 8) badOn++;
            if (full[i + 3] !== halfOn[i + 3]) alphaDifference++;
          }
          reports.push({ width, height, intersecting, preview, offError, onError, badOff, badOn, bypassDifference, alphaDifference });
        }
      }
      // 小尺寸多次同步读回用于相对耗时观察，不能当作手机 GPU 的绝对帧率。
      renderer.setSize(128, 128); camera.aspect = 1; camera.updateProjectionMatrix(); ao.resize(128, 128);
      front.position.z = 5;
      const timings = [];
      window.MmdArTestNormalPreview = false;
      for (const dense of [false, true]) {
        const extra = [];
        if (dense) {
          for (let i = 0; i < 24; i++) {
            const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 14), material);
            strip.position.set((i - 12) * 0.7, 0, 3 + i % 3);
            scene.add(strip); extra.push(strip);
          }
        }
        for (const enabled of [false, true]) {
          ao.setResolution('half'); window.MmdArTestEdgeCorrection = enabled;
          ao.render(); gl.finish();
          const start = performance.now();
          for (let i = 0; i < 5; i++) { ao.render(); gl.finish(); }
          timings.push({ dense, enabled, milliseconds: (performance.now() - start) / 5 });
        }
        for (const strip of extra) { scene.remove(strip); strip.geometry.dispose(); }
      }
      const glError = gl.getError();
      ao.dispose(); renderer.dispose();
      for (const object of [back, front, thin]) object.geometry.dispose();
      material.dispose();
      return { reports, timings, glError };
    });
    console.log(JSON.stringify(report));
    assert.deepEqual(errors, []);
    assert.equal(report.glError, 0);
    for (const result of report.reports) {
      assert.equal(result.bypassDifference, 0, '全分辨率开关必须完全旁路');
      assert.equal(result.alphaDifference, 0, '不能裁掉轮廓及细条');
      if (result.preview) assert.ok(result.badOn < result.badOff, JSON.stringify(result));
      else assert.ok(result.onError <= result.offError, JSON.stringify(result));
    }
  });
});
