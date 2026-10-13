'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const modules = [
    ['独立', '../3rd/mmd-ar-test/web-render-settings.mjs', '../3rd/mmd-ar-test/web-temporal-aa.mjs', [1]],
    ['正式', '../src/apps/web-mediacenter/ui/public/js/mmd-render-settings.mjs', '../src/apps/web-mediacenter/ui/public/js/mmd-temporal-aa.mjs', [1]]
];

for (const [label, settingsPath, temporalPath, supportedScales] of modules) {
    test(`${label}FSR重建倍率只保留1x并兼容旧存储`, async () => {
        const settings = await import(settingsPath);
        assert.equal(settings.normalizeRenderSettings({}).fsr2ReconstructionScale, 1);
        for (const scale of [.25, .5, 1, 2, 4]) {
            assert.equal(settings.normalizeRenderSettings({ fsr2ReconstructionScale: String(scale) }).fsr2ReconstructionScale,
                supportedScales.includes(scale) ? scale : 1);
        }
        for (const scale of [0, -1, .75, 1.5, 3, 2.1, 8, '', null, true, NaN, Infinity, 'bad']) {
            assert.equal(settings.normalizeRenderSettings({ fsr2ReconstructionScale: scale }).fsr2ReconstructionScale, 1);
        }
    });

    test(`${label}FSR唯一1x保持基础输出尺寸，普通TAA与关闭沿用基础尺寸`, async () => {
        const { calculateRenderSize } = await import(settingsPath);
        const config = { taaEnabled: true, aaMode: 'fsr2', canvasScale: .25, fsr2Scale: 1 };
        const outputSizes = new Map([[1, [320, 180]]]);
        for (const factor of supportedScales) {
            const [width, height] = outputSizes.get(factor);
            const size = calculateRenderSize(1280, 720, 1, { ...config, fsr2ReconstructionScale: factor });
            assert.deepEqual([size.inputWidth, size.inputHeight, size.width, size.height], [320, 180, width, height]);
            assert.equal(size.limited, false);
            const half = calculateRenderSize(1280, 720, 1, { ...config, fsr2Scale: .5, fsr2ReconstructionScale: factor });
            assert.deepEqual([half.inputWidth, half.inputHeight], [160, 90]);
        }
        for (const disabled of [{ taaEnabled: false }, { aaMode: 'taa' }]) {
            const size = calculateRenderSize(1280, 720, 1, { ...config, fsr2ReconstructionScale: 4, ...disabled });
            assert.deepEqual([size.inputWidth, size.inputHeight, size.width, size.height], [320, 180, 320, 180]);
        }
        const unsupported = calculateRenderSize(1280, 720, 1, { ...config, fsr2ReconstructionScale: 4 }, 8192, false);
        assert.deepEqual([unsupported.inputWidth, unsupported.width], [320, 320]);
    });

    test(`${label}唯一1x输出遵循基础尺寸上限和奇数尺寸取整`, async () => {
        const { calculateRenderSize, calculateTemporalInputSize } = await import(settingsPath);
        const config = { taaEnabled: true, aaMode: 'fsr2', canvasScale: .25, fsr2Scale: .5, fsr2ReconstructionScale: 4 };
        const limited = calculateRenderSize(1280, 720, 1, config, 256);
        assert.deepEqual([limited.inputWidth, limited.inputHeight, limited.width, limited.height], [128, 72, 256, 144]);
        assert.equal(limited.limited, true);
        assert.deepEqual(calculateTemporalInputSize(256, 144, config, limited), [128, 72]);
        const odd = calculateRenderSize(65, 97, 1, config);
        assert.deepEqual([odd.inputWidth, odd.inputHeight, odd.width, odd.height], [8, 12, 16, 24]);
        const large = calculateRenderSize(1000, 500, 2, { ...config, canvasScale: 2 }, 8192);
        assert.deepEqual([large.inputWidth, large.inputHeight, large.width, large.height], [2000, 1000, 4000, 2000]);
        // 不匹配的元数据不得套用到导出或外部指定的绘制目标。
        assert.deepEqual(calculateTemporalInputSize(64, 96, config, limited), [32, 48]);
    });

    test(`${label}时域输入和jitter保持，重建变更清历史且目标采用实际输出`, async () => {
        const { calculateRenderSize } = await import(settingsPath);
        const { createTemporalAA } = await import(temporalPath);
        const camera = new THREE.PerspectiveCamera(45, 1, .1, 100); camera.position.z = 8; camera.updateMatrixWorld();
        const base = camera.projectionMatrix.clone();
        let target = null, draws = 0, size;
        const renderer = { capabilities: { isWebGL2: true }, extensions: { has: () => false }, domElement: new EventTarget(),
            getRenderTarget: () => target, setRenderTarget(value) { target = value; },
            getDrawingBufferSize(out) { return out.set(size.width, size.height); }, clear() {}, render() {} };
        const config = { taaEnabled: true, aaMode: 'fsr2', canvasScale: .25, fsr2Scale: 1, taaJitterScale: 1, fsr2ReconstructionScale: 1 };
        const temporal = createTemporalAA({ THREE, renderer, camera, getSettings: () => config });
        const depth = new THREE.DepthTexture(64, 64);
        const render = factor => {
            config.fsr2ReconstructionScale = factor;
            size = calculateRenderSize(256, 256, 1, config);
            camera.userData.mmdArRenderSize = size;
            temporal.render(() => { draws += 1; assert.deepEqual([target.width, target.height], [64, 64]);
                assert.equal(camera.projectionMatrix.elements[9], base.elements[9] + 1 / (3 * 64)); }, () => depth);
            assert.deepEqual([temporal.getState().width, temporal.getState().height], [64 * factor, 64 * factor]);
            assert.equal(temporal.getState().lastHistoryUsed, false);
            assert.deepEqual(camera.projectionMatrix.elements, base.elements);
        };
        for (const factor of supportedScales) render(factor);
        temporal.render(() => { draws += 1; }, () => depth);
        assert.equal(temporal.getState().lastHistoryUsed, true);
        assert.equal(draws, supportedScales.length + 1, '每帧仍只有一次场景绘制');
        temporal.dispose(); depth.dispose();
    });
}
