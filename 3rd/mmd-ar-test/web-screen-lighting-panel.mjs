export const defaults = Object.freeze({
    contactEnabled: false, giEnabled: false, contactStrength: .5, contactDistance: .3, contactStepCount: 12,
    giStrength: 1, giRadius: 2, quality: 'low', giBlurPassCount: 1,
    giBlurRadii: Object.freeze([3, 3, 3]), contactBlurPassCount: 1,
    contactBlurRadii: Object.freeze([3, 3, 3])
});
const key = 'aasc.mmdArTest.screenLighting.v1';
const ranges = { contactStrength: [0, 1], contactDistance: [.02, 3], giStrength: [0, 4], giRadius: [.1, 10], giBlurPassCount: [0, 3], contactBlurPassCount: [0, 3] };

export function normalizeScreenLightingSettings(input) {
    const value = { ...defaults, giBlurRadii: [...defaults.giBlurRadii] };
    for (const name of ['contactEnabled', 'giEnabled']) value[name] = input?.[name] === true;
    for (const [name, [min, max]] of Object.entries(ranges)) {
        const raw = input?.[name], number = Number(raw);
        if (raw != null && raw !== '' && Number.isFinite(number)) value[name] = Math.max(min, Math.min(max, number));
    }
    for (const channel of ['gi', 'contact']) {
        value[`${channel}BlurPassCount`] = Math.round(value[`${channel}BlurPassCount`]);
        value[`${channel}BlurRadii`] = [0, 1, 2].map(index => {
            const raw = input?.[`${channel}BlurRadii`]?.[index], number = Number(raw);
            return raw != null && raw !== '' && Number.isFinite(number)
                ? Math.round(Math.max(1, Math.min(5, number))) : 3;
        });
    }
    if (['low', 'medium', 'high'].includes(input?.quality)) value.quality = input.quality;
    // 旧设置沿用原质量步数初始化；显式设置独立保存，不随SSGI质量再次变化。
    const rawSteps = input?.contactStepCount;
    const validSteps = (typeof rawSteps === 'number' || typeof rawSteps === 'string')
        && String(rawSteps).trim() !== '' && Number.isFinite(Number(rawSteps));
    value.contactStepCount = validSteps ? Math.round(Math.max(4, Math.min(64, Number(rawSteps))))
        : { low: 12, medium: 20, high: 32 }[value.quality];
    return value;
}

export function initScreenLightingPanel() {
    const panel = document.getElementById('mmdArScreenLighting');
    if (!panel) return;
    let value = { ...defaults };
    try { value = normalizeScreenLightingSettings(JSON.parse(localStorage.getItem(key))); } catch (error) { /* 坏存储回到默认关闭。 */ }
    const apply = (persist = false) => {
        value = normalizeScreenLightingSettings(value);
        window.MmdArScreenLighting = Object.freeze({ ...value, giBlurRadii: Object.freeze([...value.giBlurRadii]),
            contactBlurRadii: Object.freeze([...value.contactBlurRadii]) });
        for (const [name, setting] of Object.entries(value)) {
            if (name.endsWith('BlurRadii')) continue;
            const input = panel.querySelector(`[data-screen-lighting="${name}"]`);
            if (input.type === 'checkbox') input.checked = setting; else input.value = String(setting);
            const output = panel.querySelector(`[data-screen-value="${name}"]`);
            if (output) output.textContent = ['giBlurPassCount', 'contactBlurPassCount', 'contactStepCount'].includes(name) ? String(setting) : Number(setting).toFixed(2);
        }
        for (const channel of ['gi', 'contact']) value[`${channel}BlurRadii`].forEach((setting, index) => {
            const name = `${channel}BlurRadius${index + 1}`;
            const input = panel.querySelector(`[data-screen-lighting="${name}"]`);
            input.value = String(setting);
            const output = panel.querySelector(`[data-screen-value="${name}"]`);
            if (output) output.textContent = `${setting} px`;
            const attribute = channel === 'gi' ? 'data-screen-blur-round' : 'data-contact-blur-round';
            const field = panel.querySelector(`[${attribute}="${index + 1}"]`);
            if (field) field.hidden = index >= value[`${channel}BlurPassCount`];
        });
        if (persist) try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* 当前页面设置仍有效。 */ }
    };
    for (const input of panel.querySelectorAll('[data-screen-lighting]')) {
        const update = () => {
            const name = input.dataset.screenLighting;
            const radiusIndex = /^(gi|contact)BlurRadius([1-3])$/u.exec(name);
            if (radiusIndex) value[`${radiusIndex[1]}BlurRadii`][Number(radiusIndex[2]) - 1] = input.value;
            else value[name] = input.type === 'checkbox' ? input.checked : input.value;
            apply(true);
        };
        input.addEventListener('input', update);
        if (input.type === 'select-one') input.addEventListener('change', update);
    }
    document.getElementById('displayMmdLightingReset')?.addEventListener('click', () => { value = { ...defaults }; apply(true); });
    const status = () => {
        const supported = window.MmdArScreenLightingSupported;
        panel.querySelector('[data-screen-status]').textContent = supported === false
            ? '当前渲染器不支持 WebGL2，接触阴影和SSGI不可用。'
            : '前帧场景颜色重投影失效时回退当前帧；动态物体可能拒绝历史样本。SSGI为屏幕空间漫反射近似。';
        for (const input of panel.querySelectorAll('input,select')) input.disabled = supported === false;
    };
    window.addEventListener('mmd-ar-screen-lighting-capability', status); apply(); status();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initScreenLightingPanel, { once: true }); else initScreenLightingPanel();
}
