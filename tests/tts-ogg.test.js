'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, page, pages, editPage } = require('./helpers/ogg-opus-fixture');
const { validateOggOpus } = require('../src/external/tts/tts-ogg');

const invalid = bytes => assert.throws(() => validateOggOpus(bytes), error => error.code === 'TTS_OGG_INVALID');

test('本地完整单声道Ogg返回48kHz时长，正确扣除pre-skip及末尾裁剪', () => {
    const result = validateOggOpus(fixture({ packets: 2, preSkip: 120, endTrim: 240 }));
    assert.equal(result.channels, 1); assert.equal(result.preSkip, 120);
    assert.equal(result.sampleCount48k, 1560); assert.equal(result.durationMs, 32.5);
});

test('Ogg拒绝魔数伪装、截断、CRC损坏和EOS后尾随字节', () => {
    const valid = fixture(); const broken = Buffer.from(valid); broken[broken.length - 1] ^= 1;
    for (const bytes of [Buffer.from('OggS'), valid.subarray(0, -1), broken, Buffer.concat([valid, Buffer.from([0])])]) invalid(bytes);
});

test('Ogg拒绝版本、序号、serial、BOS/EOS和声道/映射错误，即使CRC合法', () => {
    for (const [index, edit] of [[0, b => { b[4] = 1; }], [1, b => { b.writeUInt32LE(8, 14); }],
        [1, b => { b.writeUInt32LE(3, 18); }], [0, b => { b[5] = 0; }], [1, b => { b[5] = 2; }],
        [2, b => { b[5] = 0; }], [0, b => { b[28 + 9] = 2; }], [0, b => { b[28 + 18] = 1; }]]) invalid(editPage(fixture(), index, edit));
});

test('OpusTags可跨页包，continued与未完成页granule必须一致', () => {
    const base = pages(fixture()); const tags = Buffer.alloc(316); tags.write('OpusTags'); tags.writeUInt32LE(300, 8);
    const bytes = Buffer.concat([base[0], page({ sequence: 1, granule: -1n, body: tags.subarray(0, 255), lacing: [255] }),
        page({ sequence: 2, flags: 1, body: tags.subarray(255) }), page({ sequence: 3, flags: 4, granule: 960n, body: Buffer.from([0xf8, 0xff, 0xfe]) })]);
    assert.equal(validateOggOpus(bytes).sampleCount48k, 960);
    invalid(editPage(bytes, 2, b => { b[5] = 0; }));
    invalid(editPage(bytes, 1, b => { b.writeBigUInt64LE(0n, 6); }));
});

test('Ogg拒绝缺Opus头/Tags、非法包帧数/长度和不一致的granule', () => {
    invalid(editPage(fixture(), 0, b => { b[28] = 0; }));
    invalid(editPage(fixture(), 1, b => { b[28] = 0; }));
    invalid(editPage(fixture(), 2, b => { b[28] = 0xfb; b[29] = 0; }));
    invalid(editPage(fixture(), 2, b => { b.writeBigUInt64LE(1000n, 6); }));
    invalid(editPage(fixture({ packets: 2 }), 2, b => { b.writeBigUInt64LE(900n, 6); }));
});

test('Ogg容量和时长界限不可由调用方放宽，空文本音频与超长流拒绝', () => {
    assert.throws(() => validateOggOpus(fixture(), { maxBytes: 10 }), error => error.code === 'TTS_OGG_LIMIT');
    assert.throws(() => validateOggOpus(fixture({ packets: 2 }), { maxDurationMs: 20 }), error => error.code === 'TTS_OGG_LIMIT');
    assert.throws(() => validateOggOpus(fixture({ packets: 6001 }), { maxDurationMs: Infinity }), error => error.code === 'TTS_OGG_LIMIT');
    invalid(fixture({ preSkip: 960 }));
});

test('Opus四种帧打包方式具有正确时长，非法VBR长度和padding拒绝', () => {
    const audio = body => Buffer.concat([...pages(fixture()).slice(0, 2), page({ sequence: 2, flags: 4,
        granule: 1920n, body: Buffer.from(body) })]);
    for (const packet of [[0xf9, 0xff, 0xfe, 0xff, 0xfe], [0xfa, 2, 0xff, 0xfe, 0xff, 0xfe],
        [0xfb, 2, 0xff, 0xfe, 0xff, 0xfe], [0xfb, 0x82, 2, 0xff, 0xfe, 0xff, 0xfe]]) {
        assert.equal(validateOggOpus(audio(packet)).sampleCount48k, 1920);
    }
    for (const packet of [[0xf9, 0xff, 0xfe, 0xff], [0xfa, 252], [0xfb, 0x82, 10, 0xff, 0xfe],
        [0xfb, 0x42, 255], [0xfb, 7, 0, 0, 0, 0, 0, 0, 0]]) invalid(audio(packet));
});

test('精确魔数字节不得因ASCII清除高位而接受CRC合法的伪容器/Opus标签', () => {
    for (const [index, start, length] of [[0, 0, 4], [0, 28, 8], [1, 28, 8]]) {
        for (let byte = start; byte < start + length; byte++) invalid(editPage(fixture(), index, b => { b[byte] |= 0x80; }));
    }
});

// 对应.src/framework/tts-provider-configuration.md：顺序完整流与全局限额，保留原单流拒绝语义。
test('完整Ogg串联按EOS分流，子流仍严格校验且不能绕过全局限额', () => {
    const { splitOggOpusStreams } = require('../src/external/tts/tts-ogg');
    const first = fixture({ packets: 2, preSkip: 120, endTrim: 240 });
    const second = fixture({ packets: 3, preSkip: 80, endTrim: 160 });
    const joined = Buffer.concat([first, second]);
    assert.throws(() => validateOggOpus(joined), error => error.code === 'TTS_OGG_INVALID');
    assert.deepEqual(splitOggOpusStreams(joined), [first, second]);
    assert.deepEqual(splitOggOpusStreams(first), [first]);
    for (const limits of [{ maxStreams: 1 }, { maxBytes: joined.length - 1 }, { maxPages: 8 }, { maxPackets: 8 }, { maxDurationMs: 40 }]) {
        assert.throws(() => splitOggOpusStreams(joined, limits), error => error.code === 'TTS_OGG_LIMIT');
    }
    assert.throws(() => splitOggOpusStreams(Buffer.concat(Array(65).fill(first)), { maxStreams: 999 }), error => error.code === 'TTS_OGG_LIMIT');
    const corrupt = Buffer.from(second); corrupt[corrupt.length - 1] ^= 1;
    for (const invalid of [Buffer.alloc(0), joined.subarray(0, -1), Buffer.concat([joined, Buffer.from([0])]),
        Buffer.concat([first, second.subarray(47)]), Buffer.concat([first.subarray(0, first.length - 1), second]),
        Buffer.concat([first, corrupt]), Buffer.concat([first, editPage(second, 2, page => { page.writeUInt32LE(99, 14); })]),
        Buffer.concat([first, editPage(second, 0, page => { page[5] = 0; })])]) {
        assert.throws(() => splitOggOpusStreams(invalid), error => error.code === 'TTS_OGG_INVALID');
    }
});
