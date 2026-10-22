'use strict';

// 调色板取自网页theme.css；浏览器自测逐一核对实际计算样式。独立包无需依赖网页目录。
const COLOR_ROWS = {
    "dark": ["#16213e", "#ffffff", "#a0a0a0", "#00d2ff", "#38ef7d", "#ef4444", "rgba(0, 0, 0, 0.3)"],
    "light": ["#e7edf6", "#1f2937", "#526174", "#087ea4", "#16834a", "#c93434", "rgba(41, 55, 75, 0.16)"],
    "warm": ["#fff0c9", "#4a3520", "#7a6246", "#c27a12", "#2f855a", "#c53030", "rgba(112, 76, 15, 0.16)"],
    "pink": ["#ffe7ef", "#4a2735", "#7a5261", "#c23b70", "#2f855a", "#c53030", "rgba(139, 56, 96, 0.15)"],
    "lavender-yellow": ["#f3eaff", "#433854", "#73647f", "#8b6fc0", "#2f855a", "#c53030", "rgba(99, 76, 151, 0.15)"],
    "red-blue": ["#edf2ff", "#202f4d", "#52627f", "#d33f49", "#2f855a", "#b42318", "rgba(44, 72, 130, 0.15)"],
    "gold": ["#f8e6b0", "#4b3515", "#796039", "#b8860b", "#2f855a", "#b42318", "rgba(129, 92, 10, 0.18)"],
    "mint": ["#dff5ee", "#21443d", "#4f7169", "#159a86", "#2f855a", "#c53030", "rgba(29, 105, 89, 0.15)"],
    "ocean": ["#dceeff", "#183b5b", "#4f6d87", "#087ea4", "#2f855a", "#c53030", "rgba(31, 86, 135, 0.16)"],
    "forest": ["#e0f0e1", "#25432c", "#58705c", "#398a49", "#227a46", "#b42318", "rgba(43, 95, 48, 0.15)"],
    "slate": ["#e5e9ee", "#27313d", "#596575", "#52677d", "#2f855a", "#b42318", "rgba(51, 65, 85, 0.15)"],
    "algae-salt": ["#e6f3ed", "#24473d", "#58766d", "#159a86", "#2f855a", "#c53030", "rgba(39, 102, 84, 0.14)"],
    "girl-pink": ["#ffdce9", "#552338", "#875067", "#f06a9b", "#2f855a", "#c53030", "rgba(184, 69, 116, 0.16)"],
    "rose-gold": ["#f8e5df", "#51353a", "#7d5d62", "#b76e79", "#2f855a", "#c53030", "rgba(139, 79, 88, 0.15)"],
    "new-year-red": ["#fbe1d5", "#5a2025", "#81484b", "#d9363e", "#2f855a", "#a61b24", "rgba(139, 32, 38, 0.16)"]
};
const THEMES = Object.freeze(Object.keys(COLOR_ROWS));
const DEFAULT_APPEARANCE = Object.freeze({ theme: 'dark', ttsOpacity: 0.2 });

/** 仅接受已知颜色格式，避免原始主题字段进入ASS覆盖指令。 */
function colorValue(value) {
    if (/^#[0-9a-f]{6}$/i.test(value)) return { color: value.toUpperCase(), opacity: 1 };
    const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/.exec(value);
    if (!rgba || rgba.slice(1, 4).some(channel => Number(channel) > 255)) throw new Error('非法ASS颜色');
    return { color: '#' + rgba.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, '0')).join('').toUpperCase(), opacity: Number(rgba[4]) };
}
const PALETTES = Object.freeze(Object.fromEntries(Object.entries(COLOR_ROWS).map(([theme, row]) => [theme,
    Object.freeze(Object.fromEntries(['background', 'primary', 'secondary', 'accent', 'success', 'danger', 'shadow']
        .map((key, index) => [key, Object.freeze(colorValue(row[index]))])))
])));

function normalizeAppearance(value = {}, previous = DEFAULT_APPEARANCE) {
    if (!value || typeof value !== 'object') value = {};
    const theme = THEMES.includes(value.theme) ? value.theme : previous.theme;
    const ttsOpacity = typeof value.ttsOpacity === 'number' && Number.isFinite(value.ttsOpacity) && value.ttsOpacity >= 0 && value.ttsOpacity <= 1
        ? Math.round(value.ttsOpacity * 100) / 100 : previous.ttsOpacity;
    return { theme, ttsOpacity };
}

function paletteFor(theme) { return PALETTES[THEMES.includes(theme) ? theme : 'dark']; }
function assColor(color) { return colorValue(color).color.slice(1).match(/../g).reverse().join(''); }
function assAlpha(opacity) {
    if (!Number.isFinite(opacity)) throw new Error('非法ASS透明度');
    return Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255).toString(16).padStart(2, '0').toUpperCase();
}

/** 字面与阴影分开绘制，保持白字、主题下影和黑影各自透明度，不额外添加黑色描边。 */
function textPaint(kind, palette) {
    if (kind === 'clock' || kind === 'tts') return {
        color: '#FFFFFF', opacity: 0.9, border: kind === 'tts' ? 0.5 : 0, borderColor: palette.accent.color,
        shadows: [{ x: 2, y: 2, blur: 4, color: '#000000', opacity: 0.8 },
            { x: 0, y: 2, blur: 0, color: palette.accent.color, opacity: 0.65 }]
    };
    if (kind === 'asr') return { ...palette.primary, border: 0,
        shadows: [{ x: 1, y: 1, blur: 2, ...palette.shadow }] };
    return { ...palette.primary, border: 0, shadows: [] };
}

/** 圆角背景使用贝塞尔路径，不依赖图片或媒体滤镜。 */
function roundedPath(width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    const k = r * 0.55228475;
    const n = value => Math.round(value * 1000) / 1000;
    return `m ${n(r)} 0 l ${n(width - r)} 0 b ${n(width - r + k)} 0 ${n(width)} ${n(r - k)} ${n(width)} ${n(r)} l ${n(width)} ${n(height - r)} b ${n(width)} ${n(height - r + k)} ${n(width - r + k)} ${n(height)} ${n(width - r)} ${n(height)} l ${n(r)} ${n(height)} b ${n(r - k)} ${n(height)} 0 ${n(height - r + k)} 0 ${n(height - r)} l 0 ${n(r)} b 0 ${n(r - k)} ${n(r - k)} 0 ${n(r)} 0`;
}

/** CSS渐变0/18/82/100%；两侧各6段，中间1段，峰值透明度独立且有界。 */
function gradientBands(height, opacity) {
    const bands = [];
    const edge = height * 0.18;
    for (let index = 0; index < 6; index++) {
        const start = edge * index / 6;
        const end = edge * (index + 1) / 6;
        const alpha = opacity * (index + 0.5) / 6;
        bands.push({ start, end, opacity: alpha }, { start: height - end, end: height - start, opacity: alpha });
    }
    bands.push({ start: edge, end: height - edge, opacity });
    return bands;
}

module.exports = { THEMES, PALETTES, DEFAULT_APPEARANCE, normalizeAppearance, paletteFor, colorValue, assColor, assAlpha, textPaint, roundedPath, gradientBands };
