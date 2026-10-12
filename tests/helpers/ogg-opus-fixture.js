'use strict';

// 本地构造的20ms Opus静音包，不含真实账号合成音频；CRC使用逐位算法作为测试基准。
function checksum(bytes) {
    let crc = 0;
    for (let index = 0; index < bytes.length; index++) {
        crc ^= (index >= 22 && index < 26 ? 0 : bytes[index]) << 24;
        for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
    }
    return crc >>> 0;
}

function page({ sequence, flags = 0, granule = 0n, body, lacing, serial = 7 }) {
    const segments = lacing || [...Array(Math.floor(body.length / 255)).fill(255), body.length % 255];
    const header = Buffer.alloc(27 + segments.length);
    header.write('OggS'); header[5] = flags; header.writeBigUInt64LE(BigInt.asUintN(64, granule), 6);
    header.writeUInt32LE(serial, 14); header.writeUInt32LE(sequence, 18); header[26] = segments.length;
    Buffer.from(segments).copy(header, 27);
    const bytes = Buffer.concat([header, body]);
    bytes.writeUInt32LE(checksum(bytes), 22);
    return bytes;
}

function fixture({ packets = 1, preSkip = 0, endTrim = 0, channels = 1, sampleRate = 24000 } = {}) {
    const head = Buffer.alloc(19);
    head.write('OpusHead'); head[8] = 1; head[9] = channels; head.writeUInt16LE(preSkip, 10);
    head.writeUInt32LE(sampleRate, 12);
    const tags = Buffer.alloc(16); tags.write('OpusTags');
    return Buffer.concat([
        page({ sequence: 0, flags: 2, body: head }), page({ sequence: 1, body: tags }),
        ...Array.from({ length: packets }, (_, index) => page({ sequence: index + 2,
            flags: index === packets - 1 ? 4 : 0,
            granule: BigInt((index + 1) * 960 - (index === packets - 1 ? endTrim : 0)),
            body: Buffer.from([0xf8, 0xff, 0xfe]) }))
    ]);
}

function pages(bytes) {
    const result = [];
    for (let offset = 0; offset < bytes.length;) {
        const count = bytes[offset + 26];
        const length = 27 + count + bytes.subarray(offset + 27, offset + 27 + count).reduce((sum, value) => sum + value, 0);
        result.push(Buffer.from(bytes.subarray(offset, offset + length))); offset += length;
    }
    return result;
}

function editPage(bytes, index, edit) {
    const parts = pages(bytes); edit(parts[index]); parts[index].writeUInt32LE(checksum(parts[index]), 22);
    return Buffer.concat(parts);
}

module.exports = { fixture, page, pages, editPage };

// 有效Tags可跨Ogg页；原有流式解析器的限制不能成为校验与真实解码之间的契约断点。
function splitTagsFixture() {
    const base = pages(fixture()); const tags = Buffer.alloc(316); tags.write('OpusTags'); tags.writeUInt32LE(300, 8);
    return Buffer.concat([base[0], page({ sequence: 1, granule: -1n, body: tags.subarray(0, 255), lacing: [255] }),
        page({ sequence: 2, flags: 1, body: tags.subarray(255) }),
        page({ sequence: 3, flags: 4, granule: 960n, body: Buffer.from([0xf8, 0xff, 0xfe]) })]);
}
module.exports.splitTagsFixture = splitTagsFixture;
