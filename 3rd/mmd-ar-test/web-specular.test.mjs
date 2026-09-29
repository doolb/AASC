import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { normalizeSpecular } from './web-specular.mjs';
import {
  normalizeSpecular as normalizeProductionSpecular,
  preparePmxSpecular,
  setSpecular as setProductionSpecular
} from '../../src/apps/web-mediacenter/ui/public/js/display-pmx-specular.mjs';

test('高光参数默认与非法输入规范化', () => {
  assert.deepEqual(normalizeSpecular(null), { enabled: false, color: '#ffffff', intensity: 0.3, shininess: 30 });
  assert.deepEqual(normalizeSpecular({ enabled: 'true', color: 'red', intensity: Infinity, shininess: null }), normalizeSpecular(null));
  assert.deepEqual(normalizeSpecular({ enabled: true, color: '#AA0022', intensity: 9, shininess: -1 }), {
    enabled: true, color: '#aa0022', intensity: 2, shininess: 1,
  });
});

test('正式 PMX 高光沿用已验证参数和材质接口', () => {
  assert.deepEqual(normalizeProductionSpecular(null), normalizeSpecular(null));
  const original = 'reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;';
  const material = { isMMDToonMaterial: true, uniforms: {}, fragmentShader: original };
  preparePmxSpecular(material);
  assert.match(material.fragmentShader, /testSpecularEnabled/u);
  setProductionSpecular({ enabled: true, color: '#ff0000', intensity: 0.8, shininess: 90 });
  material.onBeforeRender();
  assert.equal(material.uniforms.testSpecularEnabled.value, 1);
  assert.equal(material.uniforms.testSpecularIntensity.value, 0.8);
  assert.equal(material.uniforms.testSpecularShininess.value, 90);
});

test('真实 WebGL 高光与面板持久化回归', async () => {
  const root = path.resolve('.');
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!file.startsWith(root + '/')) return res.writeHead(403).end();
      const content = await fs.readFile(file);
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/javascript');
      res.end(content);
    } catch (error) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.text().includes('Shader Error')) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/package.json`);
    await page.setContent(`<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>
      <div class="mmd-ar-specular"><label><input type="checkbox" data-specular="enabled"></label>
      <label><input type="color" data-specular="color"></label>
      <label><input type="range" min="0" max="2" step="0.01" data-specular="intensity"><output></output></label>
      <label><input type="range" min="1" max="256" data-specular="shininess"><output></output></label></div>`);
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { MMDToonShader } = await import('/node_modules/three/examples/jsm/shaders/MMDToonShader.js');
      const { prepareTestSpecular, setSpecular, initSpecularPanel } = await import('/3rd/mmd-ar-test/web-specular.mjs');
      const panel = document.querySelector('.mmd-ar-specular');
      const enabled = panel.querySelector('[data-specular="enabled"]');
      const intensity = panel.querySelector('[data-specular="intensity"]');
      const defaultDisabled = intensity.disabled && !enabled.checked;
      enabled.click();
      intensity.value = '0.75'; intensity.dispatchEvent(new Event('input'));
      const saved = JSON.parse(localStorage.getItem('aasc.mmdArTest.specular.v1'));
      const copy = panel.cloneNode(true); delete copy.dataset.bound; panel.replaceWith(copy);
      initSpecularPanel();
      const restored = copy.querySelector('[data-specular="intensity"]').value;
      delete copy.dataset.bound;
      initSpecularPanel(document, () => { throw new Error('存储禁用'); });
      const storageFallback = !copy.querySelector('[data-specular="enabled"]').checked;
      const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(64, 64);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10); camera.position.z = 3;
      const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(0, 0, 3); scene.add(light);
      const material = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(MMDToonShader.uniforms),
        vertexShader: MMDToonShader.vertexShader, fragmentShader: MMDToonShader.fragmentShader,
        defines: { ...MMDToonShader.defines }, lights: true });
      material.isMMDToonMaterial = true;
      material.uniforms.diffuse.value.setRGB(0, 0, 0);
      material.uniforms.emissive.value.setRGB(0, 0, 0);
      material.uniforms.specular.value.setRGB(0.1, 0.1, 0.1);
      prepareTestSpecular(material);
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 32), material));
      const target = new THREE.WebGLRenderTarget(64, 64); renderer.setRenderTarget(target);
      const render = settings => {
        setSpecular(settings); renderer.render(scene, camera);
        const bytes = new Uint8Array(64 * 64 * 4); renderer.readRenderTargetPixels(target, 0, 0, 64, 64, bytes);
        return [...bytes];
      };
      const original = render({});
      const zero = render({ enabled: true, intensity: 0 });
      const red = render({ enabled: true, color: '#ff0000', intensity: 1, shininess: 30 });
      const sharp = render({ enabled: true, color: '#ff0000', intensity: 1, shininess: 128 });
      const restoredPixels = render({ enabled: false });
      const sum = (pixels, channel) => pixels.reduce((total, v, i) => total + (i % 4 === channel ? v : 0), 0);
      const result = { defaultDisabled, saved, restored, storageFallback, originalSum: sum(original, 0),
        zeroSum: sum(zero, 0), red: sum(red, 0), green: sum(red, 1),
        sharper: red.some((v, i) => v !== sharp[i]), restoredExact: original.every((v, i) => v === restoredPixels[i]) };
      target.dispose(); material.dispose(); renderer.dispose();
      return result;
    });
    assert.deepEqual(errors, []);
    assert.equal(result.defaultDisabled, true);
    assert.equal(result.saved.intensity, 0.75);
    assert.equal(result.restored, '0.75');
    assert.equal(result.storageFallback, true);
    assert.ok(result.originalSum > 0);
    assert.equal(result.zeroSum, 0);
    assert.ok(result.red > result.green * 2);
    assert.equal(result.sharper, true);
    assert.equal(result.restoredExact, true);
    console.log(result);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
