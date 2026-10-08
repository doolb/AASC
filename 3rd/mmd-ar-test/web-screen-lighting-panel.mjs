const defaults = Object.freeze({ contactEnabled: false, giEnabled: false, contactStrength: .5, contactDistance: .3, giStrength: 1, giRadius: 2, quality: 'low' });
const key = 'aasc.mmdArTest.screenLighting.v1';
const ranges = { contactStrength: [0, 1], contactDistance: [.02, 3], giStrength: [0, 4], giRadius: [.1, 10] };
function normalize(input) {
    const value = { ...defaults };
    for (const name of ['contactEnabled', 'giEnabled']) value[name] = input?.[name] === true;
    for (const [name, [min, max]] of Object.entries(ranges)) {
        const raw = input?.[name], number = Number(raw);
        if (raw != null && raw !== '' && Number.isFinite(number)) value[name] = Math.max(min, Math.min(max, number));
    }
    if (['low', 'medium', 'high'].includes(input?.quality)) value.quality = input.quality;
    return value;
}
function init() {
    const panel = document.getElementById('mmdArScreenLighting');
    if (!panel) return;
    let value = { ...defaults };
    try { value = normalize(JSON.parse(localStorage.getItem(key))); } catch (error) { /* 坏存储回到默认关闭。 */ }
    const apply = (persist = false) => {
        value = normalize(value); window.MmdArScreenLighting = Object.freeze({ ...value });
        for (const [name, setting] of Object.entries(value)) {
            const input = panel.querySelector(`[data-screen-lighting="${name}"]`);
            if (input.type === 'checkbox') input.checked = setting; else input.value = String(setting);
            const output = panel.querySelector(`[data-screen-value="${name}"]`);
            if (output) output.textContent = Number(setting).toFixed(2);
        }
        if (persist) try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* 当前页面设置仍有效。 */ }
    };
    for (const input of panel.querySelectorAll('[data-screen-lighting]')) input.addEventListener('input', () => {
        value[input.dataset.screenLighting] = input.type === 'checkbox' ? input.checked : input.value; apply(true);
    });
    document.getElementById('displayMmdLightingReset')?.addEventListener('click', () => { value = { ...defaults }; apply(true); });
    const status = () => {
        const supported = window.MmdArScreenLightingSupported;
        panel.querySelector('[data-screen-status]').textContent = supported === false ? '当前渲染器不支持 WebGL2，实验效果不可用。' : '实验效果：仅当前可见表面参与；间接光为彩色漫反射近似。质量越高开销越大。';
        for (const input of panel.querySelectorAll('input,select')) input.disabled = supported === false;
    };
    window.addEventListener('mmd-ar-screen-lighting-capability', status); apply(); status();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
