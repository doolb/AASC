'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { THEMES, paletteFor, normalizeAppearance, assColor, assAlpha, textPaint, gradientBands } = require('../src/apps/voice-display-node/mpv-appearance');
const { MpvOverlay, assDocument } = require('../src/apps/voice-display-node/mpv-overlay');
const { paginate, textAss } = require('../src/apps/voice-display-node/mpv-text-renderer');

test('15套主题白名单、透明度边界及ASS颜色安全，非法远端值保留当前权威快照', () => {
    assert.equal(THEMES.length, 15);
    assert.deepEqual(normalizeAppearance(), { theme: 'dark', ttsOpacity: 0.2 });
    const previous = { theme: 'pink', ttsOpacity: 0.35 };
    for (const ttsOpacity of [NaN, Infinity, -1, 1.1, '0.5', null]) {
        assert.deepEqual(normalizeAppearance({ theme: '{\\pos(0,0)}', ttsOpacity }, previous), previous);
    }
    assert.deepEqual(normalizeAppearance({ theme: 'light', ttsOpacity: 0 }), { theme: 'light', ttsOpacity: 0 });
    assert.equal(normalizeAppearance({ ttsOpacity: 0.256 }).ttsOpacity, 0.26);
    assert.equal(assColor('#12ab34'), '34AB12'); assert.equal(assAlpha(0), 'FF'); assert.equal(assAlpha(1), '00');
    assert.equal(assAlpha(0.2), 'CC'); assert.throws(() => assAlpha(NaN));
    assert.throws(() => assColor('red{\\bord9}')); assert.throws(() => assColor('rgba(999,0,0,1)'));
    assert.equal(paletteFor('__proto__'), paletteFor('dark'));
});

test('时间白字与TTS细描边、主题下影/黑影分层，ASR和连接按主题配色', () => {
    for (const theme of THEMES) {
        const palette = paletteFor(theme);
        const clock = textPaint('clock', palette), tts = textPaint('tts', palette), asr = textPaint('asr', palette);
        assert.equal(clock.color, '#FFFFFF'); assert.equal(clock.opacity, 0.9); assert.equal(clock.border, 0);
        assert.equal(tts.border, 0.5); assert.equal(tts.borderColor, palette.accent.color);
        assert.deepEqual(clock.shadows, tts.shadows);
        assert.equal(asr.color, palette.primary.color); assert.equal(asr.shadows[0].opacity, palette.shadow.opacity);
        for (const rotation of [0, 90, 180, 270]) {
            const data = assDocument({ connection: '已连接', showStatusBar: true, tts: 'TTS白色字面', asr: '识别正文',
                appearance: { theme, ttsOpacity: 0.6 } }, { width: 800, height: 600 }, rotation, new Date(2026, 9, 22, 12, 34, 56)).data;
            assert.match(data, /\\bord0\.5\\shad0\\blur0/);
            assert.ok(data.includes(`\\3c&H${assColor(palette.accent.color)}&`));
            assert.ok(data.includes(`\\1c&H${assColor(palette.primary.color)}&`));
            assert.ok(data.includes(`\\1c&H${assColor(palette.success.color)}&`));
            assert.equal(data.split('TTS白色字面').length - 1, 3, '字面和两种阴影分别绘制');
            assert.ok(data.length < 22000);
        }
    }
});

test('TTS背景渐变有界、透明度0只移除背景，圆角/主题变化不影响文字生命周期', () => {
    const bands = gradientBands(200, 0.6).sort((a, b) => a.start - b.start);
    assert.equal(bands.length, 13); assert.equal(bands[0].start, 0); assert.equal(bands.at(-1).end, 200);
    assert.equal(bands[6].opacity, 0.6); assert.ok(bands[0].opacity < bands[1].opacity);
    bands.slice(1).forEach((band, index) => assert.ok(Math.abs(bands[index].end - band.start) < 0.001));
    const state = { tts: '仍然可见', appearance: { theme: 'gold', ttsOpacity: 0 } };
    const data = assDocument(state, { width: 800, height: 600 }, 90).data;
    assert.ok(!data.includes('\\p1}'), '零透明度不发送TTS背景路径'); assert.match(data, /仍然可见/);
    const overlay = new MpvOverlay(() => {});
    overlay.update({ ttsEvent: { phase: 'start', id: 7, text: '正在播放' }, asrText: '已有识别' });
    const timers = [...overlay.hideTimers.values()];
    overlay.update({ theme: 'light', ttsOpacity: 0.6 });
    assert.equal(overlay.ttsId, 7); assert.equal(overlay.state.tts, '正在播放'); assert.equal(overlay.state.asr, '已有识别');
    assert.deepEqual([...overlay.hideTimers.values()], timers);
    overlay.setActive(false); overlay.setActive(true);
    assert.deepEqual(overlay.state.appearance, { theme: 'light', ttsOpacity: 0.6 }); overlay.close();
});

test('主题只改变文档页码色，保留textStyle正文与页数组，不触发重排', () => {
    const layout = paginate('正文内容。'.repeat(500), { width: 800, height: 600 }, { color: '#123456' });
    const snapshot = { layout, pageIndex: 2 };
    const original = JSON.stringify(layout);
    for (const theme of THEMES) {
        const data = textAss(snapshot, { theme }).data;
        assert.ok(data.includes('\\1c&H563412&')); assert.ok(data.includes(`\\1c&H${assColor(paletteFor(theme).secondary.color)}&`));
        assert.equal(JSON.stringify(layout), original);
    }
});
