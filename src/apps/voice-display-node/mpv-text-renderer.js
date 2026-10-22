'use strict';

const { physicalPoint, escapeAss } = require('./mpv-overlay');
const { normalizeRotation } = require('./mpv-geometry');
const { assColor, paletteFor } = require('./mpv-appearance');
const DEFAULT_STYLE = Object.freeze({ background: '#FFF4B8', color: '#333333', fontSize: 'auto', lineHeight: 'normal', pageMargin: 'normal' });
const FONTS = { auto: 32, small: 24, medium: 32, large: 40 };
const HEIGHTS = { compact: 1.35, normal: 1.6, loose: 1.9 };
const MARGINS = { small: 24, normal: 48, large: 80 };

/** 保守估计常见Arial字符宽度，宽拉丁字母不能按平均半角宽度裁掉行尾。 */
function characterWidth(char, fontSize) {
    if (/\p{Mark}/u.test(char)) return 0;
    if (char === '\t') return fontSize * 2.6;
    if (/[MW@%&mw]/u.test(char)) return fontSize * 1.1;
    if (/[A-Z]/u.test(char)) return fontSize * 0.85;
    return fontSize * (/[\x20-\x7e]/u.test(char) ? 0.65 : 1);
}

function normalizeStyle(value = {}, previous = DEFAULT_STYLE) {
    if (!value || typeof value !== 'object') value = {};
    const style = { ...previous };
    for (const [key, choices] of [['fontSize', FONTS], ['lineHeight', HEIGHTS], ['pageMargin', MARGINS]]) {
        if (Object.hasOwn(choices, value[key])) style[key] = value[key];
    }
    for (const key of ['background', 'color']) {
        if (/^#[0-9a-f]{6}$/i.test(value[key])) style[key] = value[key];
    }
    return style;
}

/** Markdown仅提取可读正文；不会执行HTML、链接或内嵌指令。 */
function readableText(text, format) {
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
    if (format !== 'markdown') return text;
    return text.replace(/^\s*```[^\n]*$/gm, '').replace(/^\s*~~~[^\n]*$/gm, '')
        .replace(/!?\[([^\]]*)\]\([^\n)]*\)/g, '$1').replace(/<[^>\n]*>/g, '')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s*>\s?/gm, '')
        .replace(/(\*\*|__|~~)(.*?)\1/g, '$2').replace(/`([^`\n]+)`/g, '$1');
}

/** 单次扫描生成字符锚点和有界页面，全文不会经过信息字幕的2048字符截断。 */
function paginate(text, dimensions = {}, inputStyle = DEFAULT_STYLE) {
    const style = normalizeStyle(inputStyle);
    const rotation = normalizeRotation(dimensions.rotation || 0);
    const width = Math.max(1, dimensions.width || 1280);
    const height = Math.max(1, dimensions.height || 720);
    const logicalWidth = rotation % 180 ? height : width;
    const logicalHeight = rotation % 180 ? width : height;
    const margin = Math.min(MARGINS[style.pageMargin], logicalWidth / 6, logicalHeight / 6);
    const fontSize = Math.min(FONTS[style.fontSize], Math.max(8, (logicalHeight - 2 * margin - 32) / HEIGHTS[style.lineHeight]));
    const lineHeight = fontSize * HEIGHTS[style.lineHeight];
    const columns = Math.max(fontSize, logicalWidth - 2 * margin);
    const rows = Math.max(1, Math.floor((logicalHeight - 2 * margin - 32) / lineHeight));
    const pages = [];
    let start = 0;
    let offset = 0;
    let line = '';
    let lines = [];
    let size = 0;
    let count = 0;
    let lineCount = 0;
    const pushPage = () => {
        pages.push({ start, end: offset, text: text.slice(start, offset), lines });
        if (pages.length > 20000) throw new Error('文本分页超过20000页上限');
        start = offset; lines = []; count = 0;
    };
    const pushLine = () => {
        lines.push(line); line = ''; size = 0;
        if (++lineCount > 100000) throw new Error('文本超过100000行上限');
        if (lines.length >= rows) pushPage();
    };
    for (const char of text) {
        const next = characterWidth(char, fontSize);
        if (line && char !== '\n' && size + next > columns) pushLine();
        // 字幕负载上限通过分页处理，不能丢弃文档尾部。
        if (count >= 2048) { if (line) pushLine(); if (count) pushPage(); }
        offset += char.length; count++;
        if (char === '\n') { pushLine(); continue; }
        line += char; size += next;
    }
    if (line) pushLine();
    if (start < offset || !pages.length) { if (!lines.length) lines.push(''); pushPage(); }
    return { pages, style, width, height, rotation, logicalWidth, logicalHeight, margin, fontSize, lineHeight };
}

/** 正文使用独立低层OSD；旋转在窗口坐标完成，不受视频裁剪/平移影响。 */
function textAss(snapshot, appearance) {
    if (!snapshot) return { name: 'osd-overlay', id: 41, format: 'none', data: '' };
    const { layout, pageIndex } = snapshot;
    const { width, height, rotation, margin, fontSize, lineHeight, logicalWidth, logicalHeight, style } = layout;
    const textAt = (text, x, y, size, align = 7, color = style.color) => {
        const [px, py] = physicalPoint(layout, x, y);
        return `{\\rDefault\\an${align}\\pos(${px},${py})\\org(${px},${py})\\frz${-rotation}\\fnArial\\fs${size}\\bord0\\shad0\\1c&H${assColor(color)}&\\1a&H00&\\q2}${escapeAss(text.replace(/\t/g, '    '))}`;
    };
    const background = `{\\rDefault\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${assColor(style.background)}&\\1a&H00&\\p1}m 0 0 l ${width} 0 ${width} ${height} 0 ${height}{\\p0}`;
    const page = layout.pages[pageIndex];
    return { name: 'osd-overlay', id: 41, format: 'ass-events', res_x: width, res_y: height, z: 0,
        data: [background, ...page.lines.map((line, index) => textAt(line, margin, margin + index * lineHeight, fontSize)),
            textAt(`${pageIndex + 1} / ${layout.pages.length}`, logicalWidth / 2, logicalHeight - margin, 20, 2, paletteFor(appearance?.theme).secondary.color)].join('\n') };
}

module.exports = { DEFAULT_STYLE, normalizeStyle, readableText, paginate, textAss };
