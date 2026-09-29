'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const { addAoNormalPreview } = require('./web-ao-preview');
const { alignAoDepthTexels } = require('./web-ao-texel');

// 用已知法线的倾斜平面验证低分辨率差分，避免只检查 shader 文本而漏掉屏幕条带。
test('AO 整数深度像素在全/半分辨率、奇数尺寸和预算缩放下还原一致法线', async () => {
  const root = path.join(__dirname, 'web-dist');
  const baseline = addAoNormalPreview(fs.readFileSync(path.join(__dirname,
    '../../src/apps/web-mediacenter/ui/public/js/display-pmx-ao.mjs'), 'utf8')
    .replaceAll('uniform sampler2D tDepth;', 'uniform highp sampler2D tDepth;'))
    .replace("'./display-pmx-ao-size.mjs'", "'./js/display-pmx-ao-size.mjs'");
  const edgeBaseline = alignAoDepthTexels(baseline);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><body></body>');
      return;
    }
    res.setHeader('Content-Type', 'text/javascript');
    if (url.pathname === '/baseline.mjs') { res.end(baseline); return; }
    if (url.pathname === '/edge-baseline.mjs') { res.end(edgeBaseline); return; }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    fs.createReadStream(file).pipe(res);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /shader|compile|webgl/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const results = await page.evaluate(async () => {
      const THREE = await import('/js/vendor/three/three.module.js');
      const fixed = await import('/js/display-pmx-ao.mjs');
      const old = await import('/baseline.mjs');
      const oldEdges = await import('/edge-baseline.mjs');
      const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0, 0);
      const scene = new THREE.Scene();
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial());
      mesh.rotation.set(0.3, 0.2, 0);
      scene.add(mesh);
      const camera = new THREE.PerspectiveCamera(50, 1, 24, 75);
      camera.position.z = 40;
      const expectedNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      const expected = expectedNormal.toArray().map(value => Math.round((value * 0.5 + 0.5) * 255));
      const results = [];
      window.MmdArTestNormalPreview = true;
      for (const [name, module] of [['before', old], ['after', fixed]]) {
        const ao = module.createPmxAmbientOcclusion({ THREE, renderer, scene, camera });
        for (const [width, height] of [[320, 240], [321, 239], [129, 1471], [1, 1]]) {
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          ao.resize(width, height);
          for (const resolution of ['half', 'full']) {
            ao.setResolution(resolution);
            ao.render();
            const gl = renderer.getContext();
            const w = Math.min(20, width), h = Math.min(20, height);
            const bytes = new Uint8Array(w * h * 4);
            gl.readPixels(Math.floor((width - w) / 2), Math.floor((height - h) / 2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
            const target = width === 1 ? [128, 128, 255] : expected;
            let maxError = 0;
            for (let i = 0; i < bytes.length; i += 4) {
              for (let c = 0; c < 3; c++) maxError = Math.max(maxError, Math.abs(bytes[i + c] - target[c]));
            }
            results.push({ name, width, height, resolution, maxError, glError: gl.getError() });
          }
        }
        window.MmdArTestNormalPreview = false;
        ao.render();
        window.MmdArTestNormalPreview = true;
        ao.dispose();
      }
      // 倾斜轮廓和细条覆盖部分低分辨率像素，检查背景白色是否污染前景、细条是否被裁掉。
      renderer.setSize(128, 128);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      mesh.scale.setScalar(0.04);
      mesh.position.x = 0.17;
      const thin = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 10), mesh.material);
      thin.position.x = 10.17;
      scene.add(thin);
      for (const [variant, module] of [['before', oldEdges], ['after', fixed]]) {
        const ao = module.createPmxAmbientOcclusion({ THREE, renderer, scene, camera });
        ao.resize(128, 128);
        for (const backgroundAlpha of [0, 1]) {
          renderer.setClearColor(0x172031, backgroundAlpha);
          const reads = [];
          for (const resolution of ['full', 'half']) {
            ao.setResolution(resolution);
            ao.render();
            const gl = renderer.getContext();
            const bytes = new Uint8Array(128 * 128 * 4);
            gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
            reads.push(bytes);
          }
          let whitePixels = 0, alphaMismatch = 0;
          for (let i = 0; i < reads[1].length; i += 4) {
            if (reads[1][i + 3] > 0 && reads[1][i] > 250 && reads[1][i + 1] > 250
              && reads[1][i + 2] > 250) whitePixels++;
            if (reads[0][i + 3] !== reads[1][i + 3]) alphaMismatch++;
          }
          results.push({ name: 'edges', variant, backgroundAlpha, whitePixels, alphaMismatch });
        }
        ao.dispose();
      }
      thin.geometry.dispose();
      renderer.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
      return results;
    });
    console.log(JSON.stringify(results));
    assert.deepEqual(errors, []);
    for (const result of results.filter(item => item.name === 'after')) {
      assert.equal(result.glError, 0);
      assert.ok(result.maxError <= 3, JSON.stringify(result));
    }
    const edges = results.filter(item => item.name === 'edges');
    assert.ok(edges.some(item => item.variant === 'before' && item.whitePixels > 0), '应复现旧预览白边');
    for (const result of edges.filter(item => item.variant === 'after')) {
      assert.equal(result.whitePixels, 0, JSON.stringify(result));
      assert.equal(result.alphaMismatch, 0, '全/半预览轮廓及细条透明度应一致');
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
