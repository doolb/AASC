'use strict';

const audioCache = require('../../../../external/tts/tts-audio-cache');

// 浏览器音频元素会发送 HEAD/Range；内存音频与原 WAV 地址保持同样的读取方式。
function parseRange(header, size) {
    if (!header || !header.startsWith('bytes=')) return null;
    // 不合成多段 multipart 响应，多范围请求按完整音频返回。
    if (header.includes(',')) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || (!match[1] && !match[2])) return false;
    const first = match[1] ? Number(match[1]) : null;
    const last = match[2] ? Number(match[2]) : null;
    if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return false;
    if (first === null) {
        if (last <= 0) return false;
        return { start: Math.max(0, size - last), end: size - 1 };
    }
    if (first >= size || (last !== null && last < first)) return false;
    return { start: first, end: last === null ? size - 1 : Math.min(size - 1, last) };
}

function serveTtsAudio(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let name;
    try { name = decodeURIComponent(req.path.slice(1)); }
    catch (error) { return res.status(400).end(); }
    // 历史磁盘 WAV 交给后面的静态路由；新的内存引用过期后直接报不存在。
    if (!audioCache.isMemoryAudioName(name)) return next();
    res.set('Cache-Control', 'no-store');
    const entry = audioCache.getAudio(name);
    if (!entry) return res.status(404).end();
    const size = entry.buffer.length;
    res.set({ 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' });
    // 内存资源不提供校验器，If-Range 无法匹配时发送完整内容。
    const range = req.headers['if-range'] ? null : parseRange(req.headers.range, size);
    if (range === false) return res.status(416).set('Content-Range', `bytes */${size}`).end();
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    res.status(range ? 206 : 200).set('Content-Length', String(end - start + 1));
    if (range) res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    if (req.method === 'HEAD') return res.end();
    // 响应持有 Buffer 引用，缓存过期删除不影响正在传输的这一次请求。
    return res.end(entry.buffer.subarray(start, end + 1));
}

module.exports = { serveTtsAudio };
