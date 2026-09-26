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

test('测试网页复用主光阴影系数，正式 PMX 材质保持原 shader', async () => {
  const [{ MMDToonShader }, lighting] = await Promise.all([
    import('three/addons/shaders/MMDToonShader.js'),
    import('../src/apps/web-mediacenter/ui/public/js/display-pmx-lighting-mode.mjs'),
  ]);
  const makeMaterial = () => ({ isMMDToonMaterial: true, fragmentShader: MMDToonShader.fragmentShader, uniforms: {} });
  const regular = makeMaterial();
  const web = makeMaterial();
  lighting.preparePmxLightingMaterial(regular, false);
  lighting.preparePmxLightingMaterial(web, false, true);
  assert.equal(regular.uniforms.pmxFillUsesKeyShadow, undefined);
  assert.match(regular.fragmentShader, /#include <lights_fragment_begin>/u);
  assert.ok(web.fragmentShader.includes('pmxKeyShadowMask = pmxThisShadowMask'));
  assert.ok(web.fragmentShader.includes('directLight.color *= mix( 1.0, pmxKeyShadowMask, pmxFillUsesKeyShadow )'));
  assert.ok(web.uniforms.pmxFillUsesKeyShadow);
  const mesh = { isMesh: true, material: web };
  const root = { traverse(callback) { callback(mesh); } };
  lighting.setPmxFillShadowMode(root, true);
  assert.equal(web.uniforms.pmxFillUsesKeyShadow.value, 1);
  lighting.setPmxFillShadowMode(root, false);
  assert.equal(web.uniforms.pmxFillUsesKeyShadow.value, 0);
});

test('生成的 HTTPS 网页真实加载 PMX 时双光阴影 shader 能编译', {
  skip: !CHROME || !fs.existsSync(path.join(WEB_ROOT, 'index.html')),
}, async () => {
  const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      .replace(/^\/mnt\/mmd-ar\/?/u, '') || 'index.html';
    const absolute = path.resolve(WEB_ROOT, relative);
    if (!absolute.startsWith(`${WEB_ROOT}${path.sep}`) || !fs.existsSync(absolute)
      || !fs.statSync(absolute).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', /\.m?js$/u.test(absolute) ? 'text/javascript'
      : /\.html$/u.test(absolute) ? 'text/html' : 'application/octet-stream');
    fs.createReadStream(absolute).pipe(response);
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.DisplayMmd?.getState?.().modelReady === true, { timeout: 30000 });
    const modes = await page.evaluate(async () => {
      const values = [];
      for (const [keyShadowEnabled, shadowSource] of [
        [true, 'none'], [true, 'key'], [true, 'fill'],
        [false, 'none'], [false, 'key'], [false, 'fill'],
      ]) {
        values.push(window.DisplayMmd.setLighting({ fillEnabled: true, keyShadowEnabled, shadowSource }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return values.map(({ keyShadowEnabled, shadowSource, shadowEnabled, webFillShadowMode }) =>
        ({ keyShadowEnabled, shadowSource, shadowEnabled, webFillShadowMode }));
    });
    assert.deepEqual(modes, [
      { keyShadowEnabled: true, shadowSource: 'none', shadowEnabled: true, webFillShadowMode: true },
      { keyShadowEnabled: true, shadowSource: 'key', shadowEnabled: true, webFillShadowMode: true },
      { keyShadowEnabled: true, shadowSource: 'fill', shadowEnabled: true, webFillShadowMode: true },
      { keyShadowEnabled: false, shadowSource: 'none', shadowEnabled: false, webFillShadowMode: true },
      { keyShadowEnabled: false, shadowSource: 'key', shadowEnabled: false, webFillShadowMode: true },
      { keyShadowEnabled: false, shadowSource: 'fill', shadowEnabled: true, webFillShadowMode: true },
    ]);
    assert.equal(errors.filter((message) => /shader|webgl program|compile/i.test(message)).length, 0, errors.join('\n'));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
