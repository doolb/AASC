// 正式显示端渲染设置：与独立测试页分开保存，范围与渲染算法保持一致。
export const defaults = Object.freeze({ taaEnabled: false, aaMode: 'taa', fsr2Scale: .67, taaHistoryWeight: .9, canvasScale: 1, taaJitterScale: 1, taaJitterSamples: 8 });
export const jitterSampleCounts = Object.freeze([4, 8, 16, 32]);
export const storageKey = 'aasc.display.mmd.render.v1';
const number = (raw, fallback, min, max) => raw == null || raw === '' || typeof raw === 'boolean' || !Number.isFinite(Number(raw))
    ? fallback : Math.min(max, Math.max(min, Number(raw)));
export function normalizeRenderSettings(input) {
    const samples = number(input?.taaJitterSamples, 8, -Infinity, Infinity);
    return { taaEnabled: input?.taaEnabled === true, aaMode: input?.aaMode === 'fsr2' ? 'fsr2' : 'taa',
        fsr2Scale: Math.round(number(input?.fsr2Scale, .67, .5, 1) * 100) / 100,
        taaHistoryWeight: number(input?.taaHistoryWeight, .9, 0, .95),
        canvasScale: Math.round(number(input?.canvasScale, 1, .25, 2) * 4) / 4,
        taaJitterScale: number(input?.taaJitterScale, 1, 0, 2),
        taaJitterSamples: jitterSampleCounts.includes(samples) ? samples : 8 };
}
export function calculateCanvasSize(width, height, dpr, scale, limit = 8192) {
    const cssWidth = Math.max(1, Number(width) || 1), cssHeight = Math.max(1, Number(height) || 1);
    const automaticDpr = number(dpr, 1, 1, 2);
    const requestedRatio = automaticDpr * normalizeRenderSettings({ canvasScale: scale }).canvasScale;
    const safeLimit = Math.max(1, Math.floor(Number(limit) || 8192));
    const ratio = Math.min(requestedRatio, safeLimit / Math.max(cssWidth, cssHeight));
    return { width: Math.max(1, Math.floor(cssWidth * ratio)), height: Math.max(1, Math.floor(cssHeight * ratio)),
        pixelRatio: ratio, limited: ratio < requestedRatio, automaticDpr };
}
export function initRenderSettings() {
    const panel = document.getElementById('mmdArTemporalAA');
    if (!panel || panel.dataset.initialized === 'true') return;
    panel.dataset.initialized = 'true';
    let value = normalizeRenderSettings({});
    try { value = normalizeRenderSettings(JSON.parse(localStorage.getItem(storageKey))); } catch (error) { /* 损坏或受限存储使用默认设置。 */ }
    const apply = (persist = false) => {
        value = normalizeRenderSettings(value);
        window.DisplayMmdRenderSettings = Object.freeze({ ...value });
        for (const input of document.querySelectorAll('[data-render-setting]')) {
            const name = input.dataset.renderSetting;
            if (input.type === 'checkbox') input.checked = value[name]; else input.value = String(value[name]);
        }
        document.querySelector('[data-render-value="taaHistoryWeight"]').textContent = value.taaHistoryWeight.toFixed(2);
        document.querySelector('[data-render-value="taaJitterScale"]').textContent = value.taaJitterScale.toFixed(2);
        document.querySelector('[data-render-value="fsr2Scale"]').textContent = `${value.fsr2Scale.toFixed(2)}×`;
        document.querySelector('[data-render-value="canvasScale"]').textContent = `${value.canvasScale.toFixed(2)}×`;
        if (persist) try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch (error) { /* 当前会话仍可调整。 */ }
        window.dispatchEvent(new Event('mmd-ar-render-settings'));
    };
    for (const input of document.querySelectorAll('[data-render-setting]')) input.addEventListener('input', () => {
        value[input.dataset.renderSetting] = input.type === 'checkbox' ? input.checked : input.value;
        apply(true);
    });
    document.getElementById('displayMmdLightingReset')?.addEventListener('click', () => { value = { ...defaults }; apply(true); });
    const status = () => {
        const info = window.DisplayMmdRenderInfo || {};
        for (const input of panel.querySelectorAll('input, select')) input.disabled = info.taaSupported === false;
        panel.querySelector('[data-taa-status]').textContent = info.taaSupported === false
            ? '当前设备不支持WebGL2，TAA/FSR2不可用。'
            : value.taaEnabled && value.aaMode === 'fsr2'
                ? 'FSR2模式为时域升采样近似，不读取物体运动矢量；动态角色可能残影。'
                : value.taaEnabled ? 'TAA多帧减少锯齿和采样闪烁；快速运动可能产生残影。' : '选择TAA或FSR2；快速运动可能产生残影。';
        document.querySelector('[data-render-limit]').textContent = info.limited ? '已按设备尺寸上限限制' : '';
    };
    window.addEventListener('mmd-ar-render-capability', status);
    apply(); status();
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRenderSettings, { once: true });
    else initRenderSettings();
}
