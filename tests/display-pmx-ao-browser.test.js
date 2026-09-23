const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');

const PUBLIC_DIR = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const MODEL_DIR = path.resolve(__dirname, '../res/models/mmd');
const CHROME = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium'
].find((candidate) => candidate && fs.existsSync(candidate));

const startStaticServer = async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<script type="importmap">{"imports":{"three":"/js/vendor/three/three.module.js","three/addons/":"/js/vendor/three/"}}</script>');
      return;
    }
    const relative = decodeURIComponent((request.url || '').split('?')[0]).replace(/^\/+/, '');
    const isModel = relative.startsWith('models/mmd/');
    const root = isModel ? MODEL_DIR : PUBLIC_DIR;
    const assetPath = isModel ? relative.slice('models/mmd/'.length) : relative;
    const absolute = path.resolve(root, assetPath);
    if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('Content-Type', relative.endsWith('.png') ? 'image/png'
      : relative.endsWith('.mjs') || relative.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : 'application/octet-stream');
    response.end(fs.readFileSync(absolute));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

test('PMX AO darkens nearby geometry while keeping the stage transparent', { skip: !CHROME }, async () => {
  const server = await startStaticServer();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createPmxAmbientOcclusion } = await import('/js/display-pmx-ao.mjs');
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.setSize(128, 128);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
      camera.position.z = 4;
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 0.1), material);
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.08), material);
      front.position.z = 0.15;
      scene.add(back, front);
      const ao = createPmxAmbientOcclusion({ THREE, renderer, scene, camera });
      ao.resize(128, 128);
      ao.setRadius(0.25);
      const read = () => {
        const pixels = new Uint8Array(128 * 128 * 4);
        renderer.getContext().readPixels(0, 0, 128, 128, renderer.getContext().RGBA,
          renderer.getContext().UNSIGNED_BYTE, pixels);
        return pixels;
      };
      ao.setEnabled(false);
      ao.render();
      const withoutAo = read();
      ao.setEnabled(true);
      ao.render();
      const withAo = read();
      ao.setIntensity(0);
      ao.render();
      const zeroIntensity = read();
      ao.setIntensity(1);
      ao.setColor('#ff0000');
      ao.render();
      const tinted = read();
      ao.setColor('#000000');
      ao.setRadius(0.1);
      ao.render();
      const smallRadius = read();
      ao.setRadius(0.4);
      ao.render();
      const largeRadius = read();
      let darkened = 0;
      let changedAlpha = 0;
      let occupied = 0;
      let minWithout = 255;
      let minWith = 255;
      let zeroIntensityDifference = 0;
      let tintedRedLoss = 0;
      let tintedGreenLoss = 0;
      let smallRadiusLoss = 0;
      let largeRadiusLoss = 0;
      for (let index = 0; index < withAo.length; index += 4) {
        if (withoutAo[index + 3] !== withAo[index + 3]) changedAlpha += 1;
        if (withoutAo[index + 3] === 255) {
          occupied += 1;
          minWithout = Math.min(minWithout, withoutAo[index]);
          minWith = Math.min(minWith, withAo[index]);
          if (withAo[index] < withoutAo[index] - 5) darkened += 1;
          zeroIntensityDifference = Math.max(zeroIntensityDifference,
            Math.abs(zeroIntensity[index] - withoutAo[index]));
          tintedRedLoss += Math.max(0, withoutAo[index] - tinted[index]);
          tintedGreenLoss += Math.max(0, withoutAo[index + 1] - tinted[index + 1]);
          smallRadiusLoss += Math.max(0, withoutAo[index] - smallRadius[index]);
          largeRadiusLoss += Math.max(0, withoutAo[index] - largeRadius[index]);
        }
      }
      const glError = renderer.getContext().getError();
      const farIndex = (64 * 128 + 40) * 4;
      const farColorBefore = withoutAo[farIndex];
      const farColorAfter = withAo[farIndex];
      let jitter = 0;
      let jitterSamples = 0;
      for (let x = 47; x <= 50; x++) {
        for (let y = 58; y < 70; y++) {
          const first = (y * 128 + x) * 4;
          const second = ((y + 1) * 128 + x) * 4;
          const firstOcclusion = withoutAo[first] - withAo[first];
          const secondOcclusion = withoutAo[second] - withAo[second];
          jitter += Math.abs(firstOcclusion - secondOcclusion);
          jitterSamples += 1;
        }
      }
      const targetSizes = [];
      const originalSetSize = THREE.WebGLRenderTarget.prototype.setSize;
      THREE.WebGLRenderTarget.prototype.setSize = function setSize(width, height, depth) {
        targetSizes.push([width, height]);
        return originalSetSize.call(this, width, height, depth);
      };
      ao.setResolution('full');
      ao.render();
      const fullSizes = targetSizes.slice();
      targetSizes.length = 0;
      ao.setResolution('half');
      ao.render();
      const halfSizes = targetSizes.slice();
      THREE.WebGLRenderTarget.prototype.setSize = originalSetSize;
      const resizeGlError = renderer.getContext().getError();
      ao.dispose();
      renderer.dispose();
      return { supported: ao.supported, darkened, changedAlpha, cornerAlpha: withAo[3],
        occupied, minWithout, minWith, glError, farColorBefore, farColorAfter,
        jitter: jitter / jitterSamples, zeroIntensityDifference, tintedRedLoss,
        tintedGreenLoss, smallRadiusLoss, largeRadiusLoss, fullSizes, halfSizes, resizeGlError };
    });
    assert.equal(result.supported, true);
    assert.equal(result.cornerAlpha, 0);
    assert.equal(result.changedAlpha, 0);
    assert.ok(result.darkened > 10, JSON.stringify(result));
    assert.ok(Math.abs(result.farColorBefore - result.farColorAfter) <= 3, JSON.stringify(result));
    assert.ok(result.jitter < 2, JSON.stringify(result));
    assert.ok(result.zeroIntensityDifference <= 3, JSON.stringify(result));
    assert.ok(result.tintedGreenLoss > result.tintedRedLoss * 2, JSON.stringify(result));
    assert.ok(result.largeRadiusLoss > result.smallRadiusLoss, JSON.stringify(result));
    assert.ok(result.fullSizes.filter(([width, height]) => width === 128 && height === 128).length >= 3,
      JSON.stringify(result));
    assert.ok(result.halfSizes.filter(([width, height]) => width === 64 && height === 64).length >= 2,
      JSON.stringify(result));
    assert.equal(result.resizeGlError, 0);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('real local PMX keeps the same visible alpha with AO enabled', {
  skip: !CHROME || !fs.existsSync(path.join(MODEL_DIR, 'miya/miya.pmx'))
}, async () => {
  const server = await startStaticServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { MMDLoader } = await import('/js/vendor/three/loaders/MMDLoader.js');
      const { createPmxAmbientOcclusion } = await import('/js/display-pmx-ao.mjs');
      const manager = new THREE.LoadingManager();
      const mesh = await new Promise((resolve, reject) => {
        let loaded;
        let allLoaded = false;
        manager.onLoad = () => { allLoaded = true; if (loaded) resolve(loaded); };
        manager.onError = (url) => reject(new Error(`asset failed: ${url}`));
        new MMDLoader(manager).load('/models/mmd/miya/miya.pmx', (model) => {
          loaded = model;
          if (allLoaded) resolve(model);
        }, undefined, reject);
      });
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x000000, 0);
      renderer.setSize(256, 256);
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 2));
      scene.add(mesh);
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const height = box.getSize(new THREE.Vector3()).y;
      const camera = new THREE.PerspectiveCamera(28, 1, 0.01, height * 20);
      camera.position.set(center.x, center.y, center.z + height * 2.6);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      const ao = createPmxAmbientOcclusion({ THREE, renderer, scene, camera });
      ao.resize(256, 256);
      ao.setRadius(height * 0.06);
      const read = () => {
        const bytes = new Uint8Array(256 * 256 * 4);
        const gl = renderer.getContext();
        gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        return bytes;
      };
      ao.setEnabled(false);
      ao.render();
      const before = read();
      ao.setEnabled(true);
      ao.render();
      const after = read();
      let alphaChanged = 0;
      let visiblePixels = 0;
      let darkenedPixels = 0;
      for (let index = 0; index < after.length; index += 4) {
        if (before[index + 3] !== after[index + 3]) alphaChanged += 1;
        if (before[index + 3] > 0) visiblePixels += 1;
        if (before[index + 3] > 0 && after[index] < before[index] - 3) darkenedPixels += 1;
      }
      ao.dispose();
      renderer.dispose();
      return { alphaChanged, visiblePixels, darkenedPixels };
    });
    assert.equal(result.alphaChanged, 0);
    assert.ok(result.visiblePixels > 1000, JSON.stringify(result));
    assert.ok(result.darkenedPixels > 10, JSON.stringify(result));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PMX ignores material ambient color when both scene lights are zero', {
  skip: !CHROME || !fs.existsSync(path.join(MODEL_DIR, 'miya/miya.pmx'))
}, async () => {
  const server = await startStaticServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const { createDisplayPmxRuntime } = await import('/js/display-pmx-runtime.js');
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const runtime = createDisplayPmxRuntime({ canvas });
      runtime.resize(256, 256, 1);
      runtime.setLighting({ ambientIntensity: 0, keyIntensity: 0, pmxAoEnabled: false });
      const loaded = await runtime.load({
        modelType: 'pmx', modelUrl: '/models/mmd/miya/miya.pmx',
        motionResourceId: null, playMode: 'loop'
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const gl = canvas.getContext('webgl2');
      const pixels = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let occupied = 0;
      let brightest = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] < 250) continue;
        occupied += 1;
        brightest = Math.max(brightest, pixels[index], pixels[index + 1], pixels[index + 2]);
      }
      runtime.dispose();
      return { loaded, occupied, brightest };
    });
    assert.equal(result.loaded, true);
    assert.ok(result.occupied > 1000, JSON.stringify(result));
    assert.ok(result.brightest <= 2, JSON.stringify(result));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PMX runtime applies AO switch without reloading the model', { skip: !CHROME }, async () => {
  const server = await startStaticServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const { createDisplayPmxRuntime } = await import('/js/display-pmx-runtime.js');
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const runtime = createDisplayPmxRuntime({ canvas });
      const defaults = runtime.setLighting({});
      const maxLimit = runtime.setLighting({ rotationPhysicsLimit: 2000 }).rotationPhysicsLimit;
      const disabled = runtime.setLighting({ pmxAoEnabled: false }).pmxAoEnabled;
      const adjusted = runtime.setLighting({
        pmxAoEnabled: true, pmxAoColor: '#336699', pmxAoIntensity: 1.4,
        pmxAoRadiusPercent: 12, pmxAoResolution: 'full', pmxToonEnabled: false,
        rimLights: [
          { enabled: true, color: '#123456', intensity: 1.5, direction: { longitude: -120, latitude: 20 } },
          { enabled: false, color: '#654321', intensity: 2, direction: { longitude: 120, latitude: 30 } }
        ]
      });
      const retainedRims = runtime.setLighting({ keyIntensity: 1.2 }).rimLights.map((rim) => rim.enabled);
      runtime.dispose();
      return { defaultValue: defaults.pmxAoEnabled, defaultColor: defaults.pmxAoColor,
        defaultIntensity: defaults.pmxAoIntensity, defaultRadius: defaults.pmxAoRadiusPercent,
        defaultResolution: defaults.pmxAoResolution,
        defaultLimit: defaults.rotationPhysicsLimit, defaultToon: defaults.pmxToonEnabled,
        maxLimit, disabled, adjusted, retainedRims };
    });
    assert.deepEqual(result, {
      defaultValue: true, defaultColor: '#931231', defaultIntensity: 0.6, defaultRadius: 6,
      defaultResolution: 'half',
      defaultLimit: 720, defaultToon: false, maxLimit: 1440,
      disabled: false,
      retainedRims: [true, false],
      adjusted: { ambientColor: '#ffffff', ambientIntensity: 1.8, keyColor: '#ffffff',
        keyIntensity: 2.3, keyDirection: { longitude: 31, latitude: 46 }, shadowEnabled: true,
        pmxToonEnabled: false,
        fillEnabled: false, fillColor: '#ffffff', fillIntensity: 1,
        fillDirection: { longitude: -45, latitude: 25 },
        rimLights: [
          { enabled: true, color: '#123456', intensity: 1.5, direction: { longitude: -120, latitude: 20 } },
          { enabled: false, color: '#654321', intensity: 2, direction: { longitude: 120, latitude: 30 } }
        ],
        physicsFps: 65, rotationPhysicsLimit: 1440,
        pmxAoEnabled: true, pmxAoColor: '#336699', pmxAoIntensity: 1.4,
        pmxAoRadiusPercent: 12, pmxAoResolution: 'full' }
    });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
