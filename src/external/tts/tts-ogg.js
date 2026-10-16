'use strict';

const OGG_LIMITS = Object.freeze({ maxBytes: 16 * 1024 * 1024, maxDurationMs: 120000,
    maxPages: 20000, maxPackets: 50000, maxPacketBytes: 512 * 1024 });
const UNKNOWN_GRANULE = 0xffffffffffffffffn;
const MAGIC = Object.freeze({ ogg: Buffer.from('OggS'), head: Buffer.from('OpusHead'), tags: Buffer.from('OpusTags') });
const matches = (bytes, offset, magic) => bytes.subarray(offset, offset + magic.length).equals(magic);
const fail = (limit = false) => {
    throw Object.assign(new Error(limit ? 'TTS Ogg音频超过安全上限' : 'TTS Ogg Opus音频无效或不完整'),
        { code: limit ? 'TTS_OGG_LIMIT' : 'TTS_OGG_INVALID' });
};
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value << 24;
    for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
    return crc >>> 0;
});

// Ogg使用非反射CRC；校验时把本页checksum字段当作0，不修改调用方的音频Buffer。
function checksum(page) {
    let crc = 0;
    for (let index = 0; index < page.length; index++) {
        const byte = index >= 22 && index < 26 ? 0 : page[index];
        crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 255]) >>> 0;
    }
    return crc;
}

// RFC6716长度编码：第二字节只参与252及以上的长度，越界必须在读Buffer之前拒绝。
function readFrameLength(packet, cursor, end) {
    if (cursor >= end) fail();
    const first = packet[cursor++];
    if (first < 252) return { size: first, cursor };
    if (cursor >= end) fail();
    return { size: first + 4 * packet[cursor], cursor: cursor + 1 };
}

function opusSamples(packet) {
    if (!packet.length) fail();
    const config = packet[0] >>> 3;
    const samples = config >= 16 ? [120, 240, 480, 960][config & 3]
        : config >= 12 ? [480, 960][config & 1] : [480, 960, 1920, 2880][config & 3];
    let cursor = 1;
    let end = packet.length;
    const code = packet[0] & 3;
    let count = code === 0 ? 1 : 2;
    let variable = code === 2;
    if (code === 3) {
        if (cursor >= end) fail();
        const control = packet[cursor++]; count = control & 63; variable = Boolean(control & 128);
        if (control & 64) {
            let byte;
            let padding = 0;
            do {
                if (cursor >= end) fail();
                byte = packet[cursor++]; padding += byte === 255 ? 254 : byte;
            } while (byte === 255);
            end -= padding;
        }
    }
    if (!count || count > 48 || samples * count > 5760 || cursor > end) fail();
    const lengths = [];
    if (variable) {
        let used = 0;
        for (let frame = 0; frame < count - 1; frame++) {
            const parsed = readFrameLength(packet, cursor, end); cursor = parsed.cursor;
            lengths.push(parsed.size); used += parsed.size;
        }
        lengths.push(end - cursor - used);
    } else {
        if ((end - cursor) % count !== 0) fail();
        lengths.push((end - cursor) / count);
    }
    if (lengths.some(size => size < 0 || size > 1275)) fail();
    return samples * count;
}

function validateTags(packet) {
    if (packet.length < 16 || !matches(packet, 0, MAGIC.tags)) fail();
    let cursor = 12 + packet.readUInt32LE(8);
    if (cursor + 4 > packet.length) fail();
    const comments = packet.readUInt32LE(cursor); cursor += 4;
    // 剩余字节决定评论数量的绝对上限，防止恶意计数形成巨大循环。
    if (comments > Math.floor((packet.length - cursor) / 4)) fail();
    for (let index = 0; index < comments; index++) {
        if (cursor + 4 > packet.length) fail();
        const size = packet.readUInt32LE(cursor); cursor += 4 + size;
        if (cursor > packet.length) fail();
    }
}

/**
 * 校验单一完整Ogg Opus流；只支持首版已设计的单声道mapping family 0。
 * 不解码、不补EOS、不拼接不同serial的流。granule固定为48kHz单位，与请求采样率无关。
 * 对非零初始granule/链式流采取严格拒绝，不能把未覆盖的合法容器变体冒充已支持。
 */
function validateOggOpus(buffer, customLimits = {}) {
    const limits = Object.fromEntries(Object.entries(OGG_LIMITS).map(([name, maximum]) => [name,
        Number.isSafeInteger(customLimits[name]) && customLimits[name] > 0 ? Math.min(maximum, customLimits[name]) : maximum]));
    if (!Buffer.isBuffer(buffer) || buffer.length < 27) fail();
    if (buffer.length > limits.maxBytes) fail(true);
    let offset = 0, pageCount = 0, serial, state = 0, packets = 0, preSkip = 0;
    let pendingBytes = 0, pending = [], samples = 0, lastGranule = 0, ended = false;
    let head, outputGain = 0;
    const pageEnds = [];
    const packetData = [];
    while (offset < buffer.length) {
        if (ended || offset + 27 > buffer.length) fail();
        if (++pageCount > limits.maxPages) fail(true);
        if (!matches(buffer, offset, MAGIC.ogg) || buffer[offset + 4] !== 0) fail();
        const flags = buffer[offset + 5], count = buffer[offset + 26];
        if ((flags & ~7) || !count || offset + 27 + count > buffer.length) fail();
        const lacing = buffer.subarray(offset + 27, offset + 27 + count);
        const size = 27 + count + lacing.reduce((sum, value) => sum + value, 0);
        if (offset + size > buffer.length) fail();
        const page = buffer.subarray(offset, offset + size);
        if (checksum(page) !== page.readUInt32LE(22)) fail();
        const currentSerial = page.readUInt32LE(14), sequence = page.readUInt32LE(18);
        if (pageCount === 1) serial = currentSerial;
        if (serial !== currentSerial || sequence !== pageCount - 1
            || Boolean(flags & 2) !== (pageCount === 1) || Boolean(flags & 1) !== Boolean(pendingBytes)) fail();
        const granule = page.readBigUInt64LE(6);
        let bodyOffset = 27 + count, completed = 0, completedAudio = 0, lastPacketSamples = 0;
        for (let index = 0; index < lacing.length; index++) {
            const length = lacing[index];
            pendingBytes += length;
            if (pendingBytes > limits.maxPacketBytes) fail(true);
            pending.push(page.subarray(bodyOffset, bodyOffset + length)); bodyOffset += length;
            if (length === 255) continue;
            if (++packets > limits.maxPackets) fail(true);
            const packet = Buffer.concat(pending, pendingBytes); pending = []; pendingBytes = 0; completed++;
            switch (state) {
                case 0:
                    if (pageCount !== 1 || count !== 1 || packet.length !== 19
                        || !matches(packet, 0, MAGIC.head) || packet[8] !== 1
                        || packet[9] !== 1 || packet[18] !== 0) fail();
                    preSkip = packet.readUInt16LE(10); outputGain = packet.readInt16LE(16);
                    head = packet; state = 1;
                    break;
                case 1:
                    validateTags(packet);
                    if (index !== lacing.length - 1) fail();
                    state = 2;
                    break;
                case 2:
                    // 音频包须能规范化为单个Ogg页；超大padding不属于首版支持范围。
                    if (packet.length > 65024) fail(true);
                    lastPacketSamples = opusSamples(packet); samples += lastPacketSamples; completedAudio++;
                    if (customLimits.collectPackets === true) packetData.push({ data: packet, samples: lastPacketSamples });
                    // 累计编码时长同样有界，不能用小EOS值掩盖前面的大量解码数据。
                    if (samples > limits.maxDurationMs * 48 + preSkip + 5760) fail(true);
                    break;
                default: fail();
            }
        }
        if (!completed) {
            if (granule !== UNKNOWN_GRANULE || flags & 4) fail();
        } else if (!completedAudio) {
            if (granule !== 0n || flags & 4) fail();
        } else {
            if (granule > BigInt(Number.MAX_SAFE_INTEGER)) fail();
            const position = Number(granule);
            if (flags & 4) {
                if (pendingBytes || position <= preSkip || position < lastGranule || position > samples
                    || position < samples - lastPacketSamples) fail();
                ended = true;
            } else if (position !== samples) fail();
            lastGranule = position;
            if (lastGranule - preSkip > limits.maxDurationMs * 48) fail(true);
        }
        offset += size; pageEnds.push(offset);
    }
    if (!ended || pendingBytes || state !== 2) fail();
    return { channels: 1, preSkip, outputGain, sampleCount48k: lastGranule - preSkip,
        durationMs: (lastGranule - preSkip) / 48, pageEnds, packetCount: packets,
        ...(customLimits.collectPackets === true ? { head, packetData } : {}) };
}

/**
 * 对应.src/framework/tts-provider-configuration.md的豆包长句接收：上游同一句可能串联多个完整流。
 * 仅以完整页的EOS划分，再交给原单流校验；不补结束页，也不接受交错serial或残缺尾部。
 */
function splitOggOpusStreams(buffer, customLimits = {}) {
    const limits = Object.fromEntries(Object.entries(OGG_LIMITS).map(([name, maximum]) => [name,
        Number.isSafeInteger(customLimits[name]) && customLimits[name] > 0 ? Math.min(maximum, customLimits[name]) : maximum]));
    const maxStreams = Number.isSafeInteger(customLimits.maxStreams) && customLimits.maxStreams > 0
        ? Math.min(64, customLimits.maxStreams) : 64;
    if (!Buffer.isBuffer(buffer) || !buffer.length) fail();
    if (buffer.length > limits.maxBytes) fail(true);
    const streams = [];
    let offset = 0, start = 0, pages = 0, packets = 0, durationMs = 0;
    while (offset < buffer.length) {
        if (offset + 27 > buffer.length || !matches(buffer, offset, MAGIC.ogg)) fail();
        if (++pages > limits.maxPages) fail(true);
        const flags = buffer[offset + 5], count = buffer[offset + 26];
        if (!count || offset + 27 + count > buffer.length) fail();
        const size = 27 + count + buffer.subarray(offset + 27, offset + 27 + count).reduce((sum, value) => sum + value, 0);
        if (offset + size > buffer.length) fail();
        offset += size;
        if (!(flags & 4)) continue;
        if (streams.length >= maxStreams) fail(true);
        const stream = buffer.subarray(start, offset);
        const metadata = validateOggOpus(stream, limits);
        packets += metadata.packetCount;
        durationMs += metadata.durationMs;
        if (packets > limits.maxPackets || durationMs > limits.maxDurationMs) fail(true);
        streams.push(stream);
        start = offset;
    }
    if (!streams.length || start !== buffer.length) fail();
    return streams;
}

function makeDecodePage(body, sequence, flags, granule) {
    const segments = [...Array(Math.floor(body.length / 255)).fill(255), body.length % 255];
    const header = Buffer.alloc(27 + segments.length);
    MAGIC.ogg.copy(header); header[5] = flags; header.writeBigUInt64LE(BigInt(granule), 6);
    header.writeUInt32LE(1, 14); header.writeUInt32LE(sequence, 18); header[26] = segments.length;
    Buffer.from(segments).copy(header, 27);
    const page = Buffer.concat([header, body]); page.writeUInt32LE(checksum(page), 22);
    return page;
}

/**
 * 固定codec-parser不支持Tags/音频包continued。只在原流已完整校验后重建解码器内部页，
 * 保留音频包字节、pre-skip和最终granule；Tags评论不参与音频解码，使用最小合法Tags。
 * 这里不是修补非法/截断流，也不会把规范化后的容器发往上游或对外缓存。
 */
function* createOpusDecodePages(metadata) {
    const header = Buffer.from(metadata.head); header.writeInt16LE(0, 16);
    yield makeDecodePage(header, 0, 2, 0);
    const tags = Buffer.alloc(16); MAGIC.tags.copy(tags);
    yield makeDecodePage(tags, 1, 0, 0);
    let samples = 0;
    for (let index = 0; index < metadata.packetData.length; index++) {
        const packet = metadata.packetData[index]; samples += packet.samples;
        const last = index === metadata.packetData.length - 1;
        yield makeDecodePage(packet.data, index + 2, last ? 4 : 0,
            last ? metadata.sampleCount48k + metadata.preSkip : samples);
    }
}

module.exports = { validateOggOpus, splitOggOpusStreams, createOpusDecodePages, OGG_LIMITS };
