'use strict';

const { normalizeRotation } = require('./mpv-geometry');
const { DEFAULT_APPEARANCE, normalizeAppearance, paletteFor, assColor, assAlpha, textPaint, roundedPath, gradientBands } = require('./mpv-appearance');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const cleanText = value => Array.from(String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')).slice(0, 2048).join('');

/** 与mpv escape-ass相同：阻断反斜杠指令，转义左花括号，真实换行才转换为ASS换行。 */
function escapeAss(value) {
    return cleanText(value).replace(/\\/g, '\\\u2060').replace(/\{/g, '\\{').replace(/\r?\n/g, '\\N');
}

function textWidth(text, fontSize) {
    return Array.from(text).reduce((total, char) => total + (/\p{Mark}/u.test(char) ? 0 : /[\u0020-\u007e]/u.test(char) ? 0.56 : 1), 0) * fontSize;
}

/** 按可用宽度限制中文行数；内部保留原文本，绘制内容始终有界。 */
function wrapText(text, width, fontSize, maxLines, tail = false) {
    const lines = [];
    for (const paragraph of cleanText(text).split('\n')) {
        let line = '';
        let size = 0;
        for (const char of paragraph) {
            const next = textWidth(char, fontSize);
            if (line && size + next > width) { lines.push(line); line = ''; size = 0; }
            line += char;
            size += next;
        }
        lines.push(line);
    }
    return tail ? lines.slice(-maxLines) : lines.slice(0, maxLines);
}

/** 复现网页版最终位置，而非applyRotation中随后被顶部布局覆盖的初始位置。 */
function overlayLayout({ width, height, rotation = 0, tts = '', asr = '' }) {
    const angle = normalizeRotation(rotation);
    const turned = angle % 180 !== 0;
    const layoutWidth = turned ? height : width;
    const layoutHeight = turned ? width : height;
    const shortSide = Math.min(layoutWidth, layoutHeight);
    const edgeMargin = Math.round(clamp(shortSide * 0.04, 8, 32));
    const availableWidth = Math.max(1, layoutWidth - edgeMargin * 2);
    const base = 36 * Math.min(clamp(shortSide / 720, 0.6, 1), clamp(availableWidth / 720, 0.6, 1));
    const fontSize = Math.round(clamp(base, 16, 36));
    // 网页padding使用物理CSS视口的vw，四方向都不能误换成逻辑宽度。
    const paddingX = clamp(width * 0.018, 10, 20);
    const paddingY = clamp(width * 0.012, 6, 12);
    const ttsBox = { x: edgeMargin, y: turned ? edgeMargin : 160, width: availableWidth,
        height: fontSize * 4.2 + paddingY * 2, fontSize, paddingX, paddingY };
    // 网页180度使用bottom-center变换原点，最终盒子朝物理下方展开，需保留这个最终位置。
    if (angle === 180) ttsBox.y -= ttsBox.height;
    const asrSize = Math.round(clamp(base * (tts ? 1 : clamp(1 - Math.max(Array.from(asr).length - 60, 0) / 500, 0.65, 1)), 16, 36));
    const maxLines = Math.max(1, Math.floor((layoutHeight - 210 - paddingY * 2) / (asrSize * 1.45)));
    const asrLines = wrapText(asr, Math.max(1, availableWidth - paddingX * 2), asrSize, maxLines);
    const asrWidth = Math.min(availableWidth, Math.max(...asrLines.map(line => textWidth(line, asrSize)), 0) + paddingX * 2);
    const asrHeight = Math.min(Math.max(1, layoutHeight - 210), asrLines.length * asrSize * 1.45 + paddingY * 2);
    // 对齐网页圆钮64px、状态行22px、两处8px间距及底部70px的占位，即使Node不绘制按钮。
    const asrBox = { x: (layoutWidth - asrWidth) / 2, y: layoutHeight - 172 - asrHeight,
        width: asrWidth, height: asrHeight, fontSize: asrSize, paddingX, paddingY, lines: asrLines };
    return { width, height, rotation: angle, layoutWidth, layoutHeight,
        clock: { x: layoutWidth - 20, y: 20, fontSize: width <= 768 ? 32 : 48, align: 9 },
        connection: { x: 20, y: 20, fontSize: width <= 768 ? 12 : 16, align: 7 }, tts: ttsBox, asr: asrBox };
}

function physicalPoint(layout, x, y) {
    return { 0: [x, y], 90: [layout.width - y, x],
        180: [layout.width - x, layout.height - y], 270: [y, layout.height - x] }[layout.rotation];
}

function assDocument(state, dimensions, rotation, now = new Date()) {
    const layout = overlayLayout({ ...dimensions, rotation, tts: state.tts, asr: state.asr });
    const events = [];
    const point = (x, y) => physicalPoint(layout, x, y).map(value => Math.round(value * 100) / 100).join(',');
    const tags = (x, y, align = 7) => `\\an${align}\\pos(${point(x, y)})\\org(${point(x, y)})\\frz${-layout.rotation}`;
    const appearance = normalizeAppearance(state.appearance);
    const palette = paletteFor(appearance.theme);
    const clipBox = box => {
        const [a, b] = [physicalPoint(layout, box.x, box.y), physicalPoint(layout, box.x + box.width, box.y + box.height)];
        return `\\clip(${Math.min(a[0], b[0])},${Math.min(a[1], b[1])},${Math.max(a[0], b[0])},${Math.max(a[1], b[1])})`;
    };
    const text = (value, x, y, size, align, paint, clip = '') => {
        const draw = (dx, dy, color, opacity, blur, border = 0) => {
            events.push(`{\\rDefault${tags(x + dx, y + dy, align)}\\fnArial\\fs${size}\\bord${border}\\shad0\\blur${blur}\\1c&H${assColor(color)}&\\1a&H${assAlpha(opacity)}&\\3c&H${assColor(paint.borderColor || color)}&\\3a&H00&${clip}}${escapeAss(value)}`);
        };
        for (const shadow of paint.shadows) draw(shadow.x, shadow.y, shadow.color, shadow.opacity, shadow.blur);
        draw(0, 0, paint.color, paint.opacity, 0, paint.border);
    };
    const background = (box, color, opacity, radius, clip = '') => {
        if (opacity <= 0) return;
        events.push(`{\\rDefault${tags(box.x, box.y)}\\bord0\\shad0\\blur0\\1c&H${assColor(color)}&\\1a&H${assAlpha(opacity)}&${clip}\\p1}${roundedPath(box.width, box.height, radius)}{\\p0}`);
    };
    const clock = [now.getHours(), now.getMinutes(), now.getSeconds()].map(value => String(value).padStart(2, '0')).join(':');
    text(clock, layout.clock.x, layout.clock.y, layout.clock.fontSize, 9, textPaint('clock', palette));
    if (state.showStatusBar) {
        background({ x: 20, y: 20, width: textWidth(state.connection, layout.connection.fontSize) + 32,
            height: layout.connection.fontSize + 18 }, palette.background.color, palette.background.opacity, 20);
        const color = state.connection === '已连接' ? palette.success : state.connection === '连接中...' ? palette.accent : palette.danger;
        text(state.connection, 36, 28, layout.connection.fontSize, 7, { ...textPaint('connection', palette), ...color });
    }
    if (state.tts) {
        const box = layout.tts;
        // 渐变只影响黑色背景，不把文字或主题描边一起变透明。
        for (const band of gradientBands(box.height, appearance.ttsOpacity)) {
            background(box, '#000000', band.opacity, 12,
                clipBox({ x: box.x, y: box.y + band.start, width: box.width, height: band.end - band.start }));
        }
        const lines = wrapText(state.tts, Math.max(1, box.width - box.paddingX * 2), box.fontSize, 3, true);
        lines.forEach((line, index) => text(line, box.x + box.paddingX,
            box.y + box.paddingY + (3 - lines.length + index) * box.fontSize * 1.4, box.fontSize, 7, textPaint('tts', palette), clipBox(box)));
    }
    if (state.asr) {
        const box = layout.asr;
        background(box, palette.background.color, palette.background.opacity, 12);
        box.lines.forEach((line, index) => text(line, box.x + box.width / 2,
            box.y + box.paddingY + index * box.fontSize * 1.45, box.fontSize, 8, textPaint('asr', palette)));
    }
    return { name: 'osd-overlay', id: 40, format: 'ass-events', data: events.join('\n'),
        res_x: dimensions.width, res_y: dimensions.height, z: 10 };
}

/** 仅管理信息与隐藏代次，不因时钟启动播放器，不改变媒体或TTS声音。 */
class MpvOverlay {
    constructor(redraw, { now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        this.redraw = redraw;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.state = { connection: '连接中...', showStatusBar: true, tts: '', asr: '', appearance: { ...DEFAULT_APPEARANCE } };
        this.active = false;
        this.closed = false;
        this.timer = null;
        this.hideTimers = new Map();
        this.textVersions = { tts: 0, asr: 0 };
        this.ttsId = null;
    }

    request() { if (this.active && !this.closed) this.redraw(); }

    hideLater(key) {
        const version = this.textVersions[key];
        this.clearTimer(this.hideTimers.get(key));
        const timer = this.setTimer(() => {
            if (this.closed || version !== this.textVersions[key]) return;
            this.hideTimers.delete(key);
            this.state[key] = '';
            this.request();
        }, 30000);
        timer?.unref?.();
        this.hideTimers.set(key, timer);
    }

    setText(key, value) {
        this.textVersions[key] += 1;
        this.clearTimer(this.hideTimers.get(key));
        this.hideTimers.delete(key);
        this.state[key] = cleanText(value);
    }

    update(data) {
        if (this.closed) return;
        this.state.appearance = normalizeAppearance(data, this.state.appearance);
        if (typeof data.connection === 'string') this.state.connection = cleanText(data.connection).slice(0, 80);
        if (typeof data.showStatusBar === 'boolean') this.state.showStatusBar = data.showStatusBar;
        if (typeof data.asrText === 'string') { this.setText('asr', data.asrText); if (this.state.asr) this.hideLater('asr'); }
        const event = data.ttsEvent;
        if (event?.phase === 'start') { this.ttsId = event.id; this.setText('tts', event.text); }
        if (event?.phase === 'stop') { this.ttsId = null; this.setText('tts', ''); }
        if (event?.phase === 'end' && event.id === this.ttsId) {
            if (event.failed || !event.queueIdle) this.setText('tts', '');
            else this.hideLater('tts');
        }
        this.request();
    }

    setActive(active) {
        this.active = active && !this.closed;
        this.clearTimer(this.timer);
        this.timer = null;
        if (!this.active) {
            this.setText('tts', '');
            this.setText('asr', '');
            this.ttsId = null;
            return;
        }
        const tick = () => {
            if (!this.active || this.closed) return;
            this.request();
            this.timer = this.setTimer(tick, 1000);
            this.timer?.unref?.();
        };
        tick();
    }

    close() {
        this.setActive(false);
        this.closed = true;
        for (const timer of this.hideTimers.values()) this.clearTimer(timer);
        this.hideTimers.clear();
    }
}

module.exports = { MpvOverlay, overlayLayout, physicalPoint, assDocument, escapeAss };
