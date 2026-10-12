'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const modules = [
    ['独立', '../3rd/mmd-ar-test/web-render-settings.mjs', '../3rd/mmd-ar-test/web-temporal-aa.mjs'],
    ['正式', '../src/apps/web-mediacenter/ui/public/js/mmd-render-settings.mjs', '../src/apps/web-mediacenter/ui/public/js/mmd-temporal-aa.mjs']
];

for (const [label, settingsPath, temporalPath] of modules) {
    test(`${label}FSR重建设置兼容旧存储，只接受1/2/4倍`, async () => {
        const settings = await import(settingsPath);
        assert.equal(settings.normalizeRenderSettings({}).fsr2ReconstructionScale, 1);
        for (const scale of [1, 2, 4]) assert.equal(settings.normalizeRenderSettings({ fsr2ReconstructionScale: String(scale) }).fsr2ReconstructionScale, scale);
        for (const scale of [0, -1, 3, 2.1, 8, '', null, true, NaN, Infinity, 'bad']) {
            assert.equal(settings.normalizeRenderSettings({ fsr2ReconstructionScale: scale }).fsr2ReconstructionScale, 1);
        }
    });

    test(`${label}FSR提高输出倍率不增加输入，普通TAA与关闭保留基础尺寸`, async () => {
        const { calculateRenderSize } = await import(settingsPath);
        const config = { taaEnabled: true, aaMode: 'fsr2', canvasScale: .25, fsr2Scale: 1 };
        for (const [factor, width, height] of [[1, 320, 180], [2, 640, 360], [4, 1280, 720]]) {
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

    test(`${label}输出设备上限与奇数尺寸不反向缩小输入，倍率可超过原Canvas范围`, async () => {
        const { calculateRenderSize, calculateTemporalInputSize } = await import(settingsPath);
        const config = { taaEnabled: true, aaMode: 'fsr2', canvasScale: .25, fsr2Scale: 1, fsr2ReconstructionScale: 4 };
        const limited = calculateRenderSize(1280, 720, 1, config, 512);
        assert.deepEqual([limited.inputWidth, limited.inputHeight, limited.width, limited.height], [320, 180, 512, 288]);
        assert.equal(limited.limited, true);
        assert.deepEqual(calculateTemporalInputSize(512, 288, config, limited), [320, 180]);
        const odd = calculateRenderSize(65, 97, 1, config);
        assert.deepEqual([odd.inputWidth, odd.inputHeight, odd.width, odd.height], [16, 24, 65, 97]);
        const large = calculateRenderSize(1000, 500, 2, { ...config, canvasScale: 2 }, 8192);
        assert.deepEqual([large.inputWidth, large.inputHeight, large.width, large.height], [4000, 2000, 8192, 4096]);
        // 不匹配的元数据不得套用到导出或外部指定的绘制目标。
        assert.deepEqual(calculateTemporalInputSize(64, 96, config, limited), [16, 24]);
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
        for (const factor of [1, 2, 4]) render(factor);
        temporal.render(() => { draws += 1; }, () => depth);
        assert.equal(temporal.getState().lastHistoryUsed, true);
        assert.equal(draws, 4, '每帧仍只有一次场景绘制');
        temporal.dispose(); depth.dispose();
    });
}
