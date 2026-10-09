'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');
const project = path.resolve(__dirname, '..'), root = path.join(project, '3rd/mmd-ar-test/web-dist');
const chrome = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe']
    .find(file => file && fs.existsSync(file));

async function withBrowser(action) {
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
        const source = relative.startsWith('__source/');
        const directory = source ? project : root;
        const file = path.resolve(directory, source ? relative.slice(9) : (relative || 'index.html'));
        if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && /shader|webgl|compile|linkprogram/iu.test(message.text())) errors.push(message.text()); });
        const origin = `http://127.0.0.1:${server.address().port}`;
        await action(page, origin);
        assert.deepEqual(errors, [], '浏览器及真实Shader不得报错');
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

test('真实GPU TAA边缘收敛、颜色/透明alpha和揭露历史拒绝', { skip: !chrome, timeout: 60000 }, async context => {
    await withBrowser(async (page, origin) => {
        await page.goto(`${origin}/__source/package.json`);
        const result = await page.evaluate(async () => {
            const THREE = await import('/__source/node_modules/three/build/three.module.js');
            const { createTemporalAA } = await import('/__source/3rd/mmd-ar-test/web-temporal-aa.mjs');
            const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false }); renderer.setSize(64, 64);
            renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
            const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 20);
            camera.position.z = 4; camera.updateMatrixWorld();
            const material = new THREE.MeshBasicMaterial({ color: 0x4488cc });
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), material); mesh.rotation.z = .31; scene.add(mesh);
            const target = new THREE.WebGLRenderTarget(64, 64, { depthTexture: new THREE.DepthTexture(64, 64, THREE.UnsignedIntType) });
            const config = { taaEnabled: true, taaHistoryWeight: .9 };
            const taa = createTemporalAA({ THREE, renderer, camera, getSettings: () => config });
            // 场景颜色直接拷贝到TAA输入，保持线性预乘，不引入额外色彩变换。
            const copyMaterial = new THREE.ShaderMaterial({ toneMapped: false, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
                uniforms: { tColor: { value: target.texture } }, vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
                fragmentShader: 'uniform sampler2D tColor;varying vec2 vUv;void main(){gl_FragColor=texture2D(tColor,vUv);}' });
            const copyScene = new THREE.Scene(); copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial));
            const copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            const draw = () => {
                const output = renderer.getRenderTarget(); renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera);
                renderer.setRenderTarget(output); renderer.clear(); renderer.render(copyScene, copyCamera);
            };
            const gl = renderer.getContext();
            const pixels = () => { const values = new Uint8Array(64 * 64 * 4); gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, values); return values; };
            renderer.render(scene, camera); const baseline = pixels();
            for (let frame = 0; frame < 16; frame += 1) taa.render(draw, () => target.depthTexture);
            const accumulated = pixels();
            const partial = values => { let count = 0; for (let i = 3; i < values.length; i += 4) if (values[i] > 1 && values[i] < 254) count += 1; return count; };
            const center = values => [...values.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)];
            const state = taa.getState(), colored = center(accumulated), original = center(baseline);
            material.color.set(0x0000ff); taa.render(draw, () => target.depthTexture); const changed = center(pixels());
            scene.remove(mesh); taa.render(draw, () => target.depthTexture); const cleared = center(pixels());
            scene.add(mesh); material.transparent = true; material.opacity = .5; material.needsUpdate = true;
            taa.invalidate(); taa.render(draw, () => target.depthTexture); const transparent = center(pixels());
            const { createPmxAmbientOcclusion } = await import('/js/display-pmx-ao.mjs');
            const ao = createPmxAmbientOcclusion({ THREE, renderer, camera, scene }); ao.resize(64, 64); ao.setIntensity(0);
            window.MmdArRenderSettings = { taaEnabled: false, taaHistoryWeight: .9 };
            ao.render(); const transparentAoOff = center(pixels());
            window.MmdArRenderSettings = { taaEnabled: true, taaHistoryWeight: .9 };
            for (let i = 0; i < 8; i += 1) ao.render(); const transparentAoOn = center(pixels());
            ao.dispose();
            // 用真实GPU强制走RGBA8颜色回退，验证无浮点目标设备的呈现路径。
            const hasExtension = renderer.extensions.has.bind(renderer.extensions);
            renderer.extensions.has = name => name === 'EXT_color_buffer_float' ? false : hasExtension(name);
            const byteTaa = createTemporalAA({ THREE, renderer, camera, getSettings: () => config });
            byteTaa.render(draw, () => target.depthTexture); const byteTransparent = center(pixels()); byteTaa.dispose();
            renderer.extensions.has = hasExtension;
            camera.position.x = 20; camera.updateMatrixWorld(); taa.render(draw, () => target.depthTexture); const cut = taa.getState();
            const error = gl.getError(); taa.dispose(); target.dispose(); renderer.dispose();
            return { original, colored, changed, cleared, transparent, byteTransparent, transparentAoOff, transparentAoOn, basePartial: partial(baseline), taaPartial: partial(accumulated), state, cut, error };
        });
        context.diagnostic(JSON.stringify(result));
        assert.ok(result.taaPartial > result.basePartial + 10, 'TAA必须实际增加轮廓覆盖的中间alpha');
        for (let index = 0; index < 4; index += 1) assert.ok(Math.abs(result.original[index] - result.colored[index]) <= 2, '静态内部颜色保持');
        assert.ok(result.changed[0] < 3 && result.changed[1] < 3 && result.changed[2] > 150, '动态颜色不能残留旧帧');
        assert.deepEqual(result.cleared, [0, 0, 0, 0], '揭露背景必须拒绝旧遮挡');
        assert.ok(result.transparent[3] >= 126 && result.transparent[3] <= 129);
        assert.ok(result.transparent[2] > 100 && result.transparent[2] <= result.transparent[3] + 1, '预乘alpha不能重复乘而变黑');
        for (let index = 0; index < 4; index += 1) assert.ok(Math.abs(result.transparentAoOff[index] - result.transparentAoOn[index]) <= 2, '真实AO合成链在TAA开/关时半透明内部颜色一致');
        for (let index = 0; index < 4; index += 1) assert.ok(Math.abs(result.byteTransparent[index] - result.transparent[index]) <= 2, 'RGBA8回退的透明颜色保持');
        assert.equal(result.state.lastHistoryUsed, true); assert.equal(result.cut.lastHistoryUsed, false); assert.equal(result.error, 0);
    });
});

test('真实GPU FSR2模式编译并将低分辨率TAA输入升采样到输出画布', { skip: !chrome, timeout: 60000 }, async context => {
    await withBrowser(async (page, origin) => {
        await page.goto(`${origin}/__source/package.json`);
        const result = await page.evaluate(async () => {
            const THREE = await import('/__source/node_modules/three/build/three.module.js');
            const { createTemporalAA } = await import('/__source/3rd/mmd-ar-test/web-temporal-aa.mjs');
            const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false }); renderer.setSize(64, 64);
            const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 20);
            camera.position.z = 4; camera.updateMatrixWorld();
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, .35), new THREE.MeshBasicMaterial({ color: 0x54aadd }));
            scene.add(mesh);
            const input = new THREE.WebGLRenderTarget(32, 32, { depthTexture: new THREE.DepthTexture(32, 32, THREE.UnsignedIntType) });
            const inputFull = new THREE.WebGLRenderTarget(64, 64, { depthTexture: new THREE.DepthTexture(64, 64, THREE.UnsignedIntType) });
            const copyMaterial = new THREE.ShaderMaterial({ toneMapped: false, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
                uniforms: { tColor: { value: input.texture } }, vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
                fragmentShader: 'uniform sampler2D tColor;varying vec2 vUv;void main(){gl_FragColor=texture2D(tColor,vUv);}' });
            const copyScene = new THREE.Scene(); copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial));
            const copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            const config = { taaEnabled: true, aaMode: 'fsr2', fsr2Scale: .5, taaHistoryWeight: .9, taaJitterScale: 1, taaJitterSamples: 8 };
            const taa = createTemporalAA({ THREE, renderer, camera, getSettings: () => config }); let activeInput = input;
            const draw = () => {
                const target = renderer.getRenderTarget(); renderer.setRenderTarget(activeInput); renderer.clear(); renderer.render(scene, camera);
                renderer.setRenderTarget(target); renderer.clear(); copyMaterial.uniforms.tColor.value = activeInput.texture; renderer.render(copyScene, copyCamera);
            };
            const gl = renderer.getContext();
            const pixels = () => { const values = new Uint8Array(64 * 64 * 4); gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, values); return values; };
            let forceEdgeAaOff = false; const originalRender = renderer.render;
            renderer.render = function(passScene, passCamera, ...args) {
                const material = passScene.children?.[0]?.material;
                if (forceEdgeAaOff && material?.uniforms?.edgeAaEnabled) material.uniforms.edgeAaEnabled.value = false;
                return originalRender.call(this, passScene, passCamera, ...args);
            };
            const sampleSequence = (edgeAa, angle) => {
                mesh.rotation.z = angle; mesh.updateMatrixWorld(true);
                forceEdgeAaOff = !edgeAa; taa.invalidate(); let previous = null, changed = 0, pairs = 0, finalPixels = null;
                for (let frame = 0; frame < 17; frame += 1) {
                    taa.render(draw, () => activeInput.depthTexture); finalPixels = pixels();
                    if (frame >= 8 && previous) {
                        for (let index = 3; index < finalPixels.length; index += 4) {
                            const difference = finalPixels[index] - previous[index]; changed += difference * difference;
                        }
                        pairs += finalPixels.length / 4;
                    }
                    previous = finalPixels;
                }
                let partial = 0;
                for (let index = 3; index < finalPixels.length; index += 4) if (finalPixels[index] > 8 && finalPixels[index] < 247) partial += 1;
                const center = [...finalPixels.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)];
                return { partial, temporalChange: Number(Math.sqrt(changed / pairs).toFixed(4)), center };
            };
            let state, fullState; const lowResults = [], fullResults = [], angles = [0, Math.PI / 4, Math.PI / 2];
            try {
                for (const angle of angles) lowResults.push({ angle, baseline: sampleSequence(false, angle), filtered: sampleSequence(true, angle) });
                state = taa.getState(); config.fsr2Scale = 1; activeInput = inputFull;
                for (const angle of angles) fullResults.push({ angle, baseline: sampleSequence(false, angle), filtered: sampleSequence(true, angle) });
                fullState = taa.getState();
            } finally { renderer.render = originalRender; }
            const error = gl.getError(); taa.dispose(); input.dispose(); inputFull.dispose(); copyMaterial.dispose(); copyScene.children[0].geometry.dispose(); renderer.dispose();
            return { state, fullState, lowResults, fullResults, error };
        });
        context.diagnostic(JSON.stringify(result));
        assert.equal(result.state.mode, 'fsr2');
        assert.deepEqual([result.state.inputWidth, result.state.inputHeight, result.state.width, result.state.height], [32, 32, 64, 64]);
        assert.equal(result.state.historyValid, true); assert.equal(result.state.lastHistoryUsed, true);
        assert.deepEqual([result.fullState.inputWidth, result.fullState.inputHeight, result.fullState.width, result.fullState.height], [64, 64, 64, 64]);
        for (const [scale, cases] of [[.5, result.lowResults], [1, result.fullResults]]) {
            for (const { angle, baseline, filtered } of cases) {
                const degrees = Math.round(angle * 180 / Math.PI);
                // 重建本身现在保留覆盖率；部分覆盖数量只验证路径生效，轮廓质量由独立空间参考测试判断。
                if (scale < 1) assert.ok(baseline.partial > 10, `FSR2 ${degrees}度低分辨率重建必须保留中间覆盖率`);
                assert.ok(filtered.partial > 10, `FSR2 ${degrees}度最终输出必须存在中间覆盖率`);
                assert.ok(filtered.temporalChange < baseline.temporalChange, `FSR2 ${degrees}度边缘跨jitter变化应降低`);
                assert.ok(filtered.center[3] > 240, `FSR2 ${degrees}度输出中心应保持不透明`);
                for (let index = 0; index < 4; index += 1) assert.ok(Math.abs(baseline.center[index] - filtered.center[index]) <= 2,
                    `FSR2 ${degrees}度平坦内部颜色不应变化`);
            }
        }
        assert.equal(result.error, 0);
    });
});

test('真实GPU FSR2覆盖重建保持像素中心与多角度轮廓面积', { skip: !chrome, timeout: 60000 }, async context => {
    await withBrowser(async (page, origin) => {
        await page.goto(`${origin}/__source/package.json`);
        const result = await page.evaluate(async () => {
            const THREE = await import('/__source/node_modules/three/build/three.module.js');
            const { vertexShader, resolveShader, presentShader } = await import('/__source/3rd/mmd-ar-test/web-temporal-aa-shader.mjs');
            const size = 64, renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
            renderer.setSize(size, size); renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
            const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 20);
            const scene = new THREE.Scene(), geometry = new THREE.PlaneGeometry(2, 2);
            const resolved = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
            const presented = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
            const uniform = value => ({ value });
            const resolve = new THREE.ShaderMaterial({ vertexShader, fragmentShader: resolveShader,
                depthTest: false, depthWrite: false, blending: THREE.NoBlending, uniforms: {
                    tCurrent: uniform(null), tDepth: uniform(null), tHistory: uniform(null), tHistoryDepth: uniform(null),
                    inputSize: uniform(new THREE.Vector2()), outputSize: uniform(new THREE.Vector2(size, size)),
                    inverseProjection: uniform(camera.projectionMatrixInverse), cameraWorld: uniform(new THREE.Matrix4()),
                    previousView: uniform(new THREE.Matrix4()), previousProjection: uniform(camera.projectionMatrix),
                    previousInverseProjection: uniform(camera.projectionMatrixInverse), historyWeight: uniform(0),
                    historyValid: uniform(false), upscaleEnabled: uniform(true)
                } });
            const present = new THREE.ShaderMaterial({ vertexShader, fragmentShader: presentShader,
                depthTest: false, depthWrite: false, blending: THREE.NoBlending,
                uniforms: { tColor: uniform(resolved.texture), outputSize: uniform(new THREE.Vector2(size, size)), edgeAaEnabled: uniform(true) } });
            const quad = new THREE.Mesh(geometry, resolve); scene.add(quad);
            const read = target => { const values = new Uint8Array(size * size * 4); renderer.readRenderTargetPixels(target, 0, 0, size, size, values); return values; };
            const render = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera); return read(target); };
            const cases = [];
            // 参考轮廓来自解析半平面内的16×16子像素覆盖，独立于被测GLSL的采样/权重算法。
            for (const scale of [1, .5]) for (const degrees of [0, 15, 30, 45, 60, 75, 90, -15, -30, -45, -60, -75]) {
                for (const offset of [0, .37]) for (const opaque of [false, true]) {
                    const inputSize = size * scale, normalX = Math.cos(degrees * Math.PI / 180), normalY = Math.sin(degrees * Math.PI / 180);
                    const inside = (x, y) => (x - size / 2) * normalX + (y - size / 2) * normalY > offset;
                    const foreground = [224, 112, 64, 255], background = opaque ? [16, 32, 48, 255] : [0, 0, 0, 0];
                    const colors = new Uint8Array(inputSize * inputSize * 4), depths = new Float32Array(inputSize * inputSize);
                    for (let y = 0; y < inputSize; y += 1) for (let x = 0; x < inputSize; x += 1) {
                        const filled = inside((x + .5) / scale, (y + .5) / scale), index = y * inputSize + x;
                        colors.set(filled ? foreground : background, index * 4); depths[index] = filled ? .5 : 1;
                    }
                    const colorTexture = new THREE.DataTexture(colors, inputSize, inputSize, THREE.RGBAFormat);
                    const depthTexture = new THREE.DataTexture(depths, inputSize, inputSize, THREE.RedFormat, THREE.FloatType);
                    colorTexture.needsUpdate = true; depthTexture.needsUpdate = true;
                    resolve.uniforms.inputSize.value.set(inputSize, inputSize);
                    resolve.uniforms.tCurrent.value = colorTexture; resolve.uniforms.tDepth.value = depthTexture;
                    const reconstruction = render(resolve, resolved), filtered = render(present, presented);
                    let centerError = 0, area = 0, filteredArea = 0, referenceArea = 0, error = 0, filteredError = 0;
                    const centroid = [0, 0], filteredCentroid = [0, 0], referenceCentroid = [0, 0];
                    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
                        const index = (y * size + x) * 4;
                        if (scale === 1) for (let channel = 0; channel < 4; channel += 1) {
                            centerError = Math.max(centerError, Math.abs(reconstruction[index + channel] - colors[index + channel]));
                        }
                        let coverage = 0;
                        for (let sy = 0; sy < 16; sy += 1) for (let sx = 0; sx < 16; sx += 1) {
                            if (inside(x + (sx + .5) / 16, y + (sy + .5) / 16)) coverage += 1 / 256;
                        }
                        const value = opaque ? (reconstruction[index] - 16) / 208 : reconstruction[index + 3] / 255;
                        const filteredValue = opaque ? (filtered[index] - 16) / 208 : filtered[index + 3] / 255;
                        area += value; filteredArea += filteredValue; referenceArea += coverage;
                        centroid[0] += value * (x + .5); centroid[1] += value * (y + .5);
                        filteredCentroid[0] += filteredValue * (x + .5); filteredCentroid[1] += filteredValue * (y + .5);
                        referenceCentroid[0] += coverage * (x + .5); referenceCentroid[1] += coverage * (y + .5);
                        error += Math.abs(value - coverage); filteredError += Math.abs(filteredValue - coverage);
                    }
                    const shift = (position, weight) => Math.hypot(position[0] / weight - referenceCentroid[0] / referenceArea,
                        position[1] / weight - referenceCentroid[1] / referenceArea);
                    cases.push({ scale, degrees, offset, opaque, centerError, centroidShift: shift(centroid, area), filteredCentroidShift: shift(filteredCentroid, filteredArea),
                        areaBias: area - referenceArea, filteredAreaBias: filteredArea - referenceArea,
                        error: error / (size * size), filteredError: filteredError / (size * size) });
                    colorTexture.dispose(); depthTexture.dispose();
                }
            }
            const glError = renderer.getContext().getError();
            geometry.dispose(); resolve.dispose(); present.dispose(); resolved.dispose(); presented.dispose(); renderer.dispose();
            return { cases, glError };
        });
        context.diagnostic(JSON.stringify({ worstCenterError: Math.max(...result.cases.map(item => item.centerError)),
            worstAreaBias: Math.max(...result.cases.map(item => Math.abs(item.areaBias))),
            worstFilteredAreaBias: Math.max(...result.cases.map(item => Math.abs(item.filteredAreaBias))),
            worstCentroidShift: Math.max(...result.cases.map(item => item.centroidShift)),
            worstFilteredCentroidShift: Math.max(...result.cases.map(item => item.filteredCentroidShift)),
            meanError: result.cases.reduce((sum, item) => sum + item.error, 0) / result.cases.length,
            meanFilteredError: result.cases.reduce((sum, item) => sum + item.filteredError, 0) / result.cases.length }));
        for (const item of result.cases) {
            const label = `比例${item.scale} ${item.degrees}度 偏移${item.offset} ${item.opaque ? '双色' : '透明'}`;
            assert.ok(item.centerError <= 1, `${label}：比例1重建不得用邻接前景替代背景或其他颜色中心，误差${item.centerError}`);
            // 边缘采样相位允许有限面积量化差，但禁止整条边一像素的系统扩张。
            assert.ok(Math.abs(item.areaBias) <= 32, `${label}：重建轮廓面积偏差${item.areaBias}`);
            assert.ok(Math.abs(item.filteredAreaBias) <= 32, `${label}：最终轮廓面积偏差${item.filteredAreaBias}`);
            // 单帧低分辨率输入存在像素中心量化：半个输入像素在输出中对应0.5/scale像素。
            assert.ok(item.centroidShift <= .5 / item.scale && item.filteredCentroidShift <= .5 / item.scale,
                `${label}：轮廓覆盖重心不得偏移超过半个输入像素`);
            assert.ok(item.filteredError <= item.error + .003, `${label}：最终滤波不能明显增加空间覆盖误差`);
        }
        assert.equal(result.glError, 0);
    });
});

test('真实模型倍率/DPR/保存复位、TAA组合和后台相机保留', {
    // 软件GPU要逐帧完成周期和大倍率测量，允许显式增加总时限，不改变任何断言。
    skip: !chrome || !fs.existsSync(path.join(root, 'mmd/miya/miya.pmx')), timeout: process.env.MMD_AR_SLOW_GPU === '1' ? 480000 : 180000
}, async context => {
    await withBrowser(async (page, origin) => {
        await page.setViewport({ width: 320, height: 400 });
        // 保留真实骨骼动画，渲染回归不依赖Ammo刚体初始化及步进。
        await page.evaluateOnNewDocument(() => localStorage.setItem('aasc.mmdArTest.physicsEnabled.v1', 'false'));
        await page.goto(`${origin}/?safePhysics=1`, { waitUntil: 'domcontentloaded' });
        const ready = () => page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 45000 });
        await ready();
        const update = async (name, value) => page.$eval(`[data-render-setting="${name}"]`, (node, setting) => {
            if (node.type === 'checkbox') node.checked = setting; else node.value = String(setting);
            node.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        const size = async (width, height) => {
            try {
                await page.waitForFunction((w, h) => {
                    const c = window.DisplayMmd.getEditorBridge().context.renderer.domElement; return c.width === w && c.height === h;
                }, {}, width, height);
            } catch (error) {
                context.diagnostic(JSON.stringify({ expected: [width, height], actual: await page.evaluate(() => {
                    const c = window.DisplayMmd.getEditorBridge().context.renderer;
                    return { size: [c.domElement.width, c.domElement.height], dpr: devicePixelRatio,
                        info: window.MmdArRenderInfo, settings: window.MmdArRenderSettings };
                }) }));
                throw error;
            }
        };
        for (const dpr of [1, 2]) {
            await page.setViewport({ width: 320, height: 400, deviceScaleFactor: dpr });
            for (const scale of [.25, .5, 1, 1.5, 2]) { await update('canvasScale', scale); await size(320 * dpr * scale, 400 * dpr * scale); }
        }
        await update('canvasScale', .5); await update('taaEnabled', true);
        await size(320, 400);
        const picture = await page.evaluate(async () => {
            const bridge = window.DisplayMmd.getEditorBridge(), c = bridge.context;
            c.helper.enable('physics', false); c.helper.enable('animation', false); bridge.rest();
            const state = () => ({ root: c.currentPivot.position.toArray(), rotation: c.currentPivot.quaternion.toArray(), scale: c.currentPivot.scale.toArray(),
                camera: c.camera.position.toArray(), cameraRotation: c.camera.quaternion.toArray(), zoom: c.camera.zoom, projection: c.camera.projectionMatrix.toArray() });
            const before = state(); const coverage = [];
            for (const [contactEnabled, giEnabled] of [[false,false],[true,false],[false,true],[true,true]]) {
                window.MmdArScreenLighting = { ...window.MmdArScreenLighting, contactEnabled, giEnabled };
                for (let i = 0; i < 3; i += 1) c.ambientOcclusion.render();
                const gl = c.renderer.getContext(), data = new Uint8Array(320 * 400 * 4);
                gl.readPixels(0, 0, 320, 400, gl.RGBA, gl.UNSIGNED_BYTE, data);
                coverage.push({ pixels: data.filter((value, index) => index % 4 === 3 && value > 127).length,
                    error: gl.getError(), temporal: c.ambientOcclusion.getTemporalState() });
            }
            window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pageshow'));
            const reset = c.ambientOcclusion.getTemporalState();
            c.ambientOcclusion.render();
            return { before, after: state(), reset, coverage };
        });
        assert.deepEqual(picture.after, picture.before, '后台与绘制只清历史，角色和相机不复位');
        assert.equal(picture.reset.historyValid, false);
        for (const sample of picture.coverage) { assert.ok(sample.pixels > 1000); assert.equal(sample.error, 0); assert.equal(sample.temporal.lastHistoryUsed, true); }
        const jitter = await page.evaluate(() => {
            const c = window.DisplayMmd.getEditorBridge().context, renderer = c.renderer;
            const projection = c.camera.projectionMatrix.toArray(), render = renderer.render;
            const samples = []; let current;
            renderer.render = function(scene, camera) {
                if (scene === c.scene) { current.draws += 1; current.matrix = camera.projectionMatrix.toArray(); current.phase = camera.userData.mmdArTaaPhase; }
                return render.call(this, scene, camera);
            };
            const update = (name, value) => {
                const node = document.querySelector(`[data-render-setting="${name}"]`); node.value = String(value);
                node.dispatchEvent(new Event('input', { bubbles: true }));
            };
            try {
                for (const count of [4, 8, 16, 32]) {
                    update('taaJitterSamples', count);
                    const cleared = c.ambientOcclusion.getTemporalState().historyValid, frames = [];
                    for (let i = 0; i <= count; i += 1) {
                        current = { draws: 0 }; c.ambientOcclusion.render(); frames.push(current);
                    }
                    // 同姿态/参数，两次预热后三次计时；等待GPU完成，周期比较不混合分辨率。
                    const gl = renderer.getContext(), pixel = new Uint8Array(4), times = [];
                    for (let i = 0; i < 5; i += 1) {
                        current = { draws: 0 }; gl.finish(); const begin = performance.now(); c.ambientOcclusion.render();
                        gl.readPixels(160, 200, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); gl.finish();
                        if (i >= 2) times.push(performance.now() - begin);
                    }
                    times.sort((a, b) => a - b);
                    samples.push({ count, cleared, frames, medianMs: Number(times[1].toFixed(2)), targets: c.ambientOcclusion.getTemporalState().targetCount });
                }
                update('taaJitterScale', 0); current = { draws: 0 }; c.ambientOcclusion.render();
                const zero = current.matrix;
                update('taaJitterScale', 2); const scaleCleared = c.ambientOcclusion.getTemporalState().historyValid;
                current = { draws: 0 }; c.ambientOcclusion.render();
                const doubled = current.matrix;
                update('taaJitterSamples', 8); update('taaJitterScale', 1);
                return { samples, projection, zero, doubled, scaleCleared, settings: window.MmdArRenderSettings,
                    restored: c.camera.projectionMatrix.toArray(), error: renderer.getContext().getError() };
            } finally { renderer.render = render; }
        });
        for (const sample of jitter.samples) {
            assert.equal(sample.cleared, false);
            assert.deepEqual(sample.frames[sample.count], sample.frames[0]);
            for (let i = 0; i < sample.count; i += 1) assert.equal(sample.frames[i].phase, i);
            assert.equal(new Set(sample.frames.map(frame => frame.draws)).size, 1);
            assert.equal(sample.frames[0].draws, jitter.samples[0].frames[0].draws, '周期不增加每帧场景绘制次数');
            assert.equal(sample.targets, 5, '周期不增加历史目标数');
        }
        assert.deepEqual(jitter.zero, jitter.projection, '强度0实际GPU场景无投影偏移');
        assert.notDeepEqual(jitter.doubled, jitter.projection); assert.equal(jitter.scaleCleared, false);
        assert.deepEqual(jitter.restored, jitter.projection); assert.equal(jitter.error, 0);
        context.diagnostic(`同条件周期GPU完成耗时：${JSON.stringify(jitter.samples.map(({ count, medianMs, targets }) => ({ count, medianMs, targets })))}`);
        const motion = await page.evaluate(async () => {
            const bridge = window.DisplayMmd.getEditorBridge(), c = bridge.context;
            const positions = c.mesh.skeleton.bones.map(bone => bone.quaternion.toArray());
            c.helper.enable('animation', true); bridge.seek(.4);
            const seekReset = c.ambientOcclusion.getTemporalState().historyValid;
            for (let i = 0; i < 8; i += 1) await new Promise(resolve => requestAnimationFrame(resolve));
            const changed = c.mesh.skeleton.bones.some((bone, index) => bone.quaternion.toArray().some((value, component) => Math.abs(value - positions[index][component]) > 1e-5));
            const frame = c.ambientOcclusion.getTemporalState();
            c.helper.enable('animation', false); bridge.rest();
            const capture = await bridge.capture(160, 200, true);
            const bitmap = await createImageBitmap(capture), imageSize = [bitmap.width, bitmap.height]; bitmap.close();
            return { seekReset, changed, frame, imageSize, bytes: capture.size, width: c.renderer.domElement.width, height: c.renderer.domElement.height };
        });
        assert.equal(motion.seekReset, false); assert.equal(motion.changed, true, '真实动画骨骼应实际运动');
        assert.equal(motion.frame.lastHistoryUsed, true); assert.deepEqual(motion.imageSize, [160, 200]);
        assert.ok(motion.bytes > 1000); assert.deepEqual([motion.width, motion.height], [320, 400]);
        await update('aaMode', 'fsr2'); await update('fsr2Scale', .5);
        const fsr2 = await page.evaluate(() => {
            const c = window.DisplayMmd.getEditorBridge().context, gl = c.renderer.getContext();
            const samples = [], pixel = new Uint8Array(4);
            for (let i = 0; i < 7; i += 1) {
                gl.finish(); const begin = performance.now(); c.ambientOcclusion.render();
                gl.readPixels(160, 200, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); gl.finish();
                if (i >= 2) samples.push(performance.now() - begin);
            }
            samples.sort((a, b) => a - b);
            const state = c.ambientOcclusion.getTemporalState();
            return { state, pixel: [...pixel], medianMs: Number(samples[2].toFixed(2)), error: gl.getError(),
                colorBytes: c.renderer.extensions.has('EXT_color_buffer_float') ? 8 : 4 };
        });
        assert.equal(fsr2.state.mode, 'fsr2'); assert.deepEqual([fsr2.state.width, fsr2.state.height], [320, 400]);
        assert.deepEqual([fsr2.state.inputWidth, fsr2.state.inputHeight], [160, 200]);
        assert.equal(fsr2.state.lastHistoryUsed, true); assert.equal(fsr2.error, 0);
        assert.ok(fsr2.pixel[3] > 100, 'FSR2输出分辨率画布必须存在模型画面');
        const fsr2Capture = await page.evaluate(async () => {
            const bridge = window.DisplayMmd.getEditorBridge(), c = bridge.context;
            const before = [c.renderer.domElement.width, c.renderer.domElement.height], originalRender = c.renderer.render, sceneTargets = [];
            c.renderer.render = function(scene, camera, ...args) {
                if (scene === c.scene && camera === c.camera) {
                    const target = this.getRenderTarget();
                    sceneTargets.push([this.domElement.width, this.domElement.height, target?.width || 0, target?.height || 0]);
                }
                return originalRender.call(this, scene, camera, ...args);
            };
            let blob, size;
            try {
                blob = await bridge.capture(160, 200, true); const bitmap = await createImageBitmap(blob);
                size = [bitmap.width, bitmap.height]; bitmap.close();
            } finally { c.renderer.render = originalRender; }
            return { size, before, after: [c.renderer.domElement.width, c.renderer.domElement.height], sceneTargets };
        });
        assert.deepEqual(fsr2Capture.size, [160, 200]); assert.deepEqual(fsr2Capture.after, fsr2Capture.before);
        assert.ok(fsr2Capture.sceneTargets.some(([width, height, targetWidth, targetHeight]) =>
            width === 160 && height === 200 && targetWidth === 160 && targetHeight === 200), '导出场景必须用请求尺寸绘制');
        assert.ok(!fsr2Capture.sceneTargets.some(([width, height, targetWidth, targetHeight]) =>
            width === 160 && height === 200 && targetWidth === 80 && targetHeight === 100), '导出不能再应用FSR2内部比例');
        const fsr2Timing = { scale: .5, mode: 'fsr2', input: `${fsr2.state.inputWidth}x${fsr2.state.inputHeight}`,
            output: `${fsr2.state.width}x${fsr2.state.height}`, medianMs: fsr2.medianMs, targets: fsr2.state.targetCount,
            extraBytes: fsr2.state.inputWidth * fsr2.state.inputHeight * fsr2.colorBytes
                + fsr2.state.width * fsr2.state.height * (2 * fsr2.colorBytes + 8) };
        await update('aaMode', 'taa'); await update('fsr2Scale', .67);
        const timings = [];
        for (const scale of [.5, 1, 2]) {
            await update('canvasScale', scale); await size(640 * scale, 800 * scale);
            for (const enabled of [false, true]) {
                await update('taaEnabled', enabled);
                timings.push(await page.evaluate(() => {
                    const c = window.DisplayMmd.getEditorBridge().context, gl = c.renderer.getContext();
                    window.MmdArScreenLighting = { ...window.MmdArScreenLighting, contactEnabled: true, giEnabled: false };
                    const samples = [], pixel = new Uint8Array(4);
                    for (let i = 0; i < 5; i += 1) {
                        gl.finish(); const begin = performance.now(); c.ambientOcclusion.render();
                        gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                        gl.finish(); if (i > 1) samples.push(performance.now() - begin);
                    }
                    samples.sort((a, b) => a - b);
                    if (gl.getError()) throw new Error('GPU计时期间渲染失败');
                    const state = c.ambientOcclusion.getTemporalState();
                    return { scale: window.MmdArRenderSettings.canvasScale, taa: window.MmdArRenderSettings.taaEnabled,
                        width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, medianMs: Number(samples[1].toFixed(2)),
                        targets: state.targetCount, extraBytes: state.targetCount ? state.width * state.height * (c.renderer.extensions.has('EXT_color_buffer_float') ? 32 : 20) : 0 };
                }));
            }
        }
        context.diagnostic(`完整GPU完成耗时（软件GPU）：${JSON.stringify({ timings, fsr2Timing })}`);
        await update('canvasScale', .5); await update('taaEnabled', true); await size(320, 400);
        await update('taaJitterScale', .35); await update('taaJitterSamples', 32);
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await size(320, 400);
        assert.deepEqual(await page.evaluate(() => window.MmdArRenderSettings),
            { taaEnabled: true, aaMode: 'taa', fsr2Scale: .67, taaHistoryWeight: .9, canvasScale: .5, taaJitterScale: .35, taaJitterSamples: 32 });
        await page.$eval('#displayMmdLightingReset', node => node.click()); await size(640, 800);
        assert.equal(await page.evaluate(() => window.MmdArRenderSettings.taaEnabled), false);
        assert.equal(await page.evaluate(() => window.MmdArRenderSettings.taaJitterScale), 1);
        assert.equal(await page.evaluate(() => window.MmdArRenderSettings.taaJitterSamples), 8);
        await page.click('#displayMmdLightingToggle');
        const layout = await page.$eval('[data-render-setting="canvasScale"]', node => {
            const bounds = node.getBoundingClientRect(), panel = document.getElementById('displayMmdLightingPanel').getBoundingClientRect();
            return { left: bounds.left, right: bounds.right, panelLeft: panel.left, panelRight: panel.right };
        });
        assert.ok(layout.left >= layout.panelLeft && layout.right <= layout.panelRight, '窄屏倍率滑块不能超出面板');
        if (process.env.MMD_AR_TAA_SCREENSHOT) await page.screenshot({ path: process.env.MMD_AR_TAA_SCREENSHOT.replace('.png', '-top.png') });
        await page.click('#mmdArTemporalAA [data-group-title="抗锯齿"]');
        assert.equal(await page.$eval('#mmdArTemporalAABody', node => node.hidden), false);
        const capability = await page.evaluate(() => {
            const prior = window.MmdArRenderInfo;
            window.MmdArRenderInfo = { ...prior, taaSupported: false }; window.dispatchEvent(new Event('mmd-ar-render-capability'));
            const disabled = [...document.querySelectorAll('#mmdArTemporalAA input, #mmdArTemporalAA select')].every(node => node.disabled);
            const scaleEnabled = !document.querySelector('[data-render-setting="canvasScale"]').disabled;
            window.MmdArRenderInfo = prior; window.dispatchEvent(new Event('mmd-ar-render-capability'));
            return { disabled, scaleEnabled, enabled: !document.querySelector('[data-render-setting="taaJitterSamples"]').disabled };
        });
        assert.deepEqual(capability, { disabled: true, scaleEnabled: true, enabled: true });
        await page.$eval('[data-render-setting="taaJitterSamples"]', node => node.scrollIntoView({ block: 'end' }));
        if (process.env.MMD_AR_TAA_SCREENSHOT) await page.screenshot({ path: process.env.MMD_AR_TAA_SCREENSHOT });
        context.diagnostic(`四种屏幕光照组合有效像素：${picture.coverage.map(row => row.pixels).join(',')}`);
        await update('taaEnabled', true); await update('canvasScale', .5);
        await page.goto(`${origin}/?safePhysics=1&character=xishi`, { waitUntil: 'domcontentloaded' }); await ready();
        const staticPicture = await page.evaluate(() => {
            const c = window.DisplayMmd.getEditorBridge().context;
            for (let i = 0; i < 3; i += 1) c.ambientOcclusion.render();
            const gl = c.renderer.getContext(), data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
            return { type: window.DisplayMmd.getModelProfile().modelType,
                pixels: data.filter((value, index) => index % 4 === 3 && value > 127).length, state: c.ambientOcclusion.getTemporalState(), error: gl.getError() };
        });
        assert.equal(staticPicture.type, 'glb'); assert.ok(staticPicture.pixels > 1000);
        assert.equal(staticPicture.state.lastHistoryUsed, true); assert.equal(staticPicture.error, 0);
        context.diagnostic(`静态GLB有效像素：${staticPicture.pixels}`);
    });
});
