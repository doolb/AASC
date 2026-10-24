'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detect, Tracker, FULL, hasBorder, layout, unrotateRect, normalizeEnabled } =
    require('../src/apps/web-mediacenter/ui/public/js/video-black-borders');
const { createVideoBlackBordersControl } = require('../src/apps/server/modules/media/video-black-borders-control');

function frame({ width = 192, height = 108, x = 0, y = 0, w = width, h = height, color = 160 } = {}) {
    const pixels = new Uint8Array(width * height).fill(5);
    for (let row = y; row < y + h; row += 1) pixels.fill(color, row * width + x, row * width + x + w);
    return { pixels, width, height };
}
const read = options => { const f = frame(options); return detect(f.pixels, f.width, f.height); };

test('上下、左右、四边黑边仅留下一个采样像素安全余量', () => {
    for (const options of [{ y: 15, h: 78 }, { x: 24, w: 144 }, { x: 20, w: 152, y: 12, h: 84 }]) {
        const rect = read(options);
        assert.ok(hasBorder(rect));
        for (const [key, value] of Object.entries(options)) {
            const actual = { x: rect.x * 192, y: rect.y * 108, w: rect.width * 192, h: rect.height * 108 }[key];
            assert.ok(Math.abs(actual - value) <= 2.001, `${key}: ${actual}/${value}`);
        }
    }
    assert.deepEqual(read(), FULL);
    assert.equal(read({ color: 12 }), null);
    assert.equal(read({ x: 80, y: 45, w: 32, h: 18 }), null);
    assert.equal(detect(new Uint8Array(192 * 108), 192, 108), null);
    assert.equal(detect(new Uint8Array(5), 192, 108), null);
});

test('黑边中的可见字幕阻止继续裁切，压缩近黑与小亮点不会视为整幅有效画面', () => {
    const f = frame({ y: 15, h: 70 });
    f.pixels.fill(200, 96 * 192 + 60, 96 * 192 + 130);
    const rect = detect(f.pixels, f.width, f.height);
    assert.ok((rect.y + rect.height) * 108 >= 97);
    const dark = new Uint8Array(192 * 108).fill(8);
    dark[100] = 255;
    assert.equal(detect(dark, 192, 108), null);
});

test('连续四个不同位置稳定确认，暗场打断候选且不撤销已确认黑边', () => {
    const tracker = new Tracker(), rect = read({ y: 15, h: 78 });
    for (let stamp = 0; stamp < 3; stamp += 1) assert.equal(tracker.push(rect, stamp), false);
    assert.equal(tracker.push(rect, 2), false);
    assert.deepEqual(tracker.rect, FULL);
    assert.equal(tracker.push(rect, 3), true);
    assert.equal(tracker.push(null, 4), false);
    assert.ok(hasBorder(tracker.rect));
    for (let stamp = 5; stamp < 8; stamp += 1) assert.equal(tracker.push(FULL, stamp), false);
    assert.equal(tracker.push(FULL, 8), true);
    assert.deepEqual(tracker.rect, FULL);
    tracker.reset(); assert.equal(tracker.stamp, null); assert.equal(tracker.count, 0);
});

test('四方向有效画面均居中，适应/铺满/指定轴保持原语义，手动框不被改写', () => {
    const rect = { x: 0.1, y: 0.2, width: 0.7, height: 0.6 };
    for (const rotation of [0, 90, 180, 270]) {
        const options = { width: 1920, height: 1080, windowWidth: 800, windowHeight: 600, rect, rotation };
        const contain = layout({ ...options, fit: 'contain' }), cover = layout({ ...options, fit: 'cover' });
        assert.ok(cover.scaleX >= contain.scaleX);
        const scale = contain.width / options.width;
        const turned = rotation % 180 !== 0;
        const visibleW = (turned ? 1080 * rect.height : 1920 * rect.width) * scale;
        const visibleH = (turned ? 1920 * rect.width : 1080 * rect.height) * scale;
        assert.ok(visibleW <= 800.0001 && visibleH <= 600.0001);
        assert.ok(Math.abs(visibleW - 800) < 0.001 || Math.abs(visibleH - 600) < 0.001);
        for (const fit of ['height', 'width', 'dynamic']) assert.ok(layout({ ...options, fit }));
        const crop = { x: 0, y: 0, width: 50, height: 100 }, saved = { ...crop };
        assert.ok(layout({ ...options, fit: 'crop', crop })); assert.deepEqual(crop, saved);
    }
    assert.deepEqual(unrotateRect({ x: 0.2, y: 0.1, width: 0.6, height: 0.7 }, 90),
        { x: 0.1, y: 0.19999999999999996, width: 0.7, height: 0.6 });
    assert.equal(layout({ width: 0 }), null);
});

test('开关持久化后下发与广播，非法/保存失败返回旧权威值，其他操作不截留', () => {
    const display = { displayId: 'd1', state: {} }, saved = [], sent = [], replies = [];
    let fail = false;
    const service = createVideoBlackBordersControl({ persist: (...args) => { if (fail) throw new Error('disk'); saved.push(args); },
        broadcast: value => replies.push(value), send: (...args) => sent.push(args) });
    assert.equal(normalizeEnabled(undefined), true); assert.equal(normalizeEnabled(false), false);
    assert.equal(service.handle(display, { action: 'fit' }), false);
    service.handle(display, { action: 'autoBlackBorders', value: 'false' });
    assert.equal(saved.length, 0); assert.equal(replies.at(-1).enabled, true);
    service.handle(display, { action: 'autoBlackBorders', value: false });
    assert.equal(display.state.autoBlackBorders, false); assert.equal(saved[0][2].requireSave, true);
    assert.deepEqual(sent[0], ['d1', { type: 'control', action: 'autoBlackBorders', value: false }]);
    assert.equal(replies.at(-1).type, 'autoBlackBordersConfig');
    fail = true; service.handle(display, { action: 'autoBlackBorders', value: true });
    assert.equal(display.state.autoBlackBorders, false); assert.equal(replies.at(-1).enabled, false);
    assert.equal(sent.length, 1); assert.ok(replies.at(-1).error);
});
