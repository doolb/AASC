const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const PUBLIC_DIR = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const CHROME = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium'
].find((candidate) => candidate && fs.existsSync(candidate));

test('PMX 普通光照背向主光为暗，补光从正面照入仍生效', { skip: !CHROME }, async () => {
    const server = http.createServer((request, response) => {
        if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end('<script type="importmap">{"imports":{"three":"/js/vendor/three/three.module.js"}}</script>');
            return;
        }
        const relative = decodeURIComponent((request.url || '').split('?')[0]).replace(/^\/+/, '');
        const target = path.resolve(PUBLIC_DIR, relative);
        if (!target.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(target)) {
            response.writeHead(404);
            response.end();
            return;
        }
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(fs.readFileSync(target));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
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
            const { MMDToonShader } = await import('/js/vendor/three/shaders/MMDToonShader.js');
            const { preparePmxLightingMaterial, setPmxLightingMode, setPmxRimLights } =
                await import('/js/display-pmx-lighting-mode.mjs');
            const canvas = document.createElement('canvas');
            document.body.append(canvas);
            const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, preserveDrawingBuffer: true });
            renderer.setSize(64, 64);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
            camera.position.z = 3;
            const uniforms = THREE.UniformsUtils.clone(MMDToonShader.uniforms);
            uniforms.diffuse.value.setRGB(1, 1, 1);
            uniforms.specular.value.setRGB(0, 0, 0);
            uniforms.emissive.value.setRGB(0, 0, 0);
            const material = new THREE.ShaderMaterial({
                uniforms,
                vertexShader: MMDToonShader.vertexShader,
                fragmentShader: MMDToonShader.fragmentShader,
                defines: { TOON: true },
                lights: true
            });
            material.isMMDToonMaterial = true;
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
            scene.add(mesh);
            const key = new THREE.DirectionalLight(0xffffff, 0.8);
            key.position.z = -3;
            scene.add(key, key.target);
            const fill = new THREE.DirectionalLight(0xffffff, 0);
            fill.position.z = 3;
            fill.castShadow = false;
            scene.add(fill, fill.target);
            preparePmxLightingMaterial(material, true);
            const sample = () => {
                renderer.render(scene, camera);
                const pixel = new Uint8Array(4);
                const gl = renderer.getContext();
                gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                return pixel[0];
            };
            const toonBack = sample();
            setPmxLightingMode(mesh, false);
            const standardBack = sample();
            fill.intensity = 0.8;
            const standardFill = sample();
            key.intensity = 0;
            fill.intensity = 0;
            const rimPixel = () => {
                renderer.render(scene, camera);
                const pixel = new Uint8Array(4);
                const gl = renderer.getContext();
                gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                return [pixel[0], pixel[1], pixel[2]];
            };
            setPmxRimLights(mesh, [
                { enabled: true, color: '#ff0000', intensity: 3, direction: { longitude: 90, latitude: 0 } },
                { enabled: false, color: '#0000ff', intensity: 3, direction: { longitude: -90, latitude: 0 } }
            ]);
            const centerWithRim = rimPixel();
            mesh.rotation.y = Math.PI / 3;
            const rightRim = rimPixel();
            setPmxRimLights(mesh, [
                { enabled: false, color: '#ff0000', intensity: 3, direction: { longitude: 90, latitude: 0 } },
                { enabled: true, color: '#0000ff', intensity: 3, direction: { longitude: -90, latitude: 0 } }
            ]);
            mesh.rotation.y = -Math.PI / 3;
            const leftRim = rimPixel();
            setPmxRimLights(mesh, []);
            const disabledRim = rimPixel();
            renderer.dispose();
            return { toonBack, standardBack, standardFill, centerWithRim, rightRim, leftRim, disabledRim };
        });
        assert.ok(result.toonBack > 30, JSON.stringify(result));
        assert.ok(result.standardBack < 3, JSON.stringify(result));
        assert.ok(result.standardFill > 30, JSON.stringify(result));
        assert.ok(result.centerWithRim.every((value) => value < 3), JSON.stringify(result));
        assert.ok(result.rightRim[0] > 30 && result.rightRim[2] < 20, JSON.stringify(result));
        assert.ok(result.leftRim[2] > 30 && result.leftRim[0] < 20, JSON.stringify(result));
        assert.ok(result.disabledRim.every((value) => value < 3), JSON.stringify(result));
    } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
