/* 正式 MindAR One Euro 参数；修改后在下一次开始定位时应用。 */
(function exposeMindArOptions(root) {
    'use strict';
    const key = 'aasc.display.mmd.mindarFilter.v1';
    const fields = [
        ['mmdArFilterMinCF', 'filterMinCF', 0.001, 0.0001, 0.02, 4],
        ['mmdArFilterBeta', 'filterBeta', 1000, 0, 2000, 0]
    ];
    const settings = { filterMinCF: 0.001, filterBeta: 1000 };
    root.DisplayMmdMindArOptions = Object.freeze({ get: () => ({ ...settings }) });
    function initialize() {
        let saved = {};
        try { saved = JSON.parse(root.localStorage.getItem(key) || '{}') || {}; }
        catch (error) { /* 缺失或损坏的偏好使用默认滤波。 */ }
        for (const [id, property, fallback, minimum, maximum, digits] of fields) {
            const input = document.getElementById(id), output = document.getElementById(id + 'Value');
            if (!input || !output) continue;
            const normalize = value => typeof value === 'number' && Number.isFinite(value)
                ? Math.max(minimum, Math.min(maximum, value)) : fallback;
            const apply = () => {
                input.value = String(settings[property]);
                output.textContent = settings[property].toFixed(digits);
            };
            settings[property] = normalize(saved[property]); apply();
            input.addEventListener('input', () => {
                settings[property] = normalize(Number(input.value)); apply();
                try { root.localStorage.setItem(key, JSON.stringify(settings)); }
                catch (error) { /* 当前值仍在下次开始时使用。 */ }
            });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})(window);
