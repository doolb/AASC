'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { QuarkDirectoryDownloads } = require('./quark-directory-downloads');
const { sanitizeCategoryName } = require('./download-path');

// 仅将常见媒体响应头转发，不能把上游 Cookie、重定向或内部地址暴露给客户端。
const STREAM_HEADERS = new Set(['content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified']);
const SAFE_MIME = /^(?:video\/(?:mp4|webm|ogg|mpeg|quicktime|x-matroska)|audio\/(?:mpeg|mp4|ogg|webm|wav|x-wav|flac|aac)|image\/(?:jpeg|png|gif|webp|avif|bmp)|text\/plain|application\/octet-stream)$/i;
const SAFE_TOMATO_ERRORS = new Set(['番茄下载或读取进行中，暂不能切换代理', '番茄下载任务状态不可用，暂不能切换代理', '番茄下载文件无法确认书籍身份']);
function safeError(id, error, fallback) {
    if (id === 'tomato' && SAFE_TOMATO_ERRORS.has(error?.message)) return error.message;
    if (id === 'youtube' && error?.message === 'YouTube 首页暂无推荐视频，请尝试搜索或检查登录状态') return error.message;
    if (id === 'pinterest' && ['Pinterest 匿名访问受限，请配置 Cookie', 'Pinterest 匿名访问受限，请配置 Cookie 或检查站点访问限制', 'Pinterest 访问受限，请检查 Cookie 是否有效或站点访问限制', 'Pinterest 下载失败：网络、代理或 HLS 格式不支持', 'Pinterest HLS 视频请先下载', 'Pinterest 暂不支持搜索分页', 'Pinterest 暂不支持首页分页', 'Pinterest 未返回与链接匹配的媒体'].includes(error?.message)) return error.message;
    return fallback;
}
function mediaType(headers) {
    const key = Object.keys(headers || {}).find(k => k.toLowerCase() === 'content-type');
    const value = String(key ? headers[key] : '').split(';')[0].trim().toLowerCase();
    return SAFE_MIME.test(value) ? value + (value === 'text/plain' ? '; charset=utf-8' : '') : 'application/octet-stream';
}
function header(headers, name) {
    const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name);
    return key ? String(headers[key]) : '';
}
function safeName(value) {
    const name = String(value || '').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').trim().slice(0, 120);
    return !name || name === '.' || name === '..' ? '媒体文件' : name;
}
function parseDirectory(value) {
    if (value == null || value === '' || value === '/') return [];
    if (typeof value !== 'string' || value.includes('\\') || value.includes('\0')) throw new Error('目录路径无效');
    const parts = value.split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..')) throw new Error('目录路径无效');
    return parts.map(sanitizeCategoryName);
}
function parseRange(value) {
    if (!value) return undefined;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) throw new Error('Range 无效');
    if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error('Range 无效');
        return { suffix };
    }
    const start = Number(match[1]), end = match[2] ? Number(match[2]) : undefined;
    if (!Number.isSafeInteger(start) || (end !== undefined && (!Number.isSafeInteger(end) || end < start))) throw new Error('Range 无效');
    return { start, end };
}

function registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl }) {
    const files = new QuarkDirectoryDownloads({ indexPath: index.indexPath, getTarget });
    const running = new Map();
    const registration = (id, feature) => {
        const entry = manager.taskMediaProviders.get(id);
        if (!entry) throw new Error('任务媒体源未运行');
        if (!entry.features.includes(feature)) throw new Error('任务媒体源不支持该操作');
        return entry;
    };
    const implementation = id => manager.getTaskSourceProvider(id).getImplementation();
    const decorate = async (id, result) => {
        const provider = implementation(id);
        const items = await Promise.all((Array.isArray(result?.items) ? result.items : []).map(async item => {
            const streamUrl = `${getBaseUrl()}/api/task-media-sources/${encodeURIComponent(id)}/stream/${encodeURIComponent(item.id)}`;
            return { ...item, ...(item.cover && typeof provider.getCover === 'function' ? { cover: `/api/task-media-sources/${encodeURIComponent(id)}/cover/${encodeURIComponent(item.id)}` } : {}), playUrl: item.playable === false ? '' : item.playUrl || (typeof provider.getStream === 'function' ? streamUrl : ''), downloaded: Boolean(await index.lookup(id, item.id)) };
        }));
        return { ...result, items };
    };
    const route = (action, payload) => async (req, res) => {
        try {
            registration(req.params.id, action);
            const result = await manager.callTaskSource(req.params.id, action, payload(req));
            res.json({ ...await decorate(req.params.id, result), status: 'success' });
        } catch (error) { res.status(400).json({ status: 'error', message: safeError(req.params.id, error, '媒体来源操作失败，请检查来源状态和输入') }); }
    };
    app.get('/api/task-media-sources/:id/home', route('home', req => ({ page: req.query.page || 1 })));
    app.get('/api/task-media-sources/:id/search', route('search', req => ({ keyword: req.query.keyword, page: req.query.page || 1 })));
    app.post('/api/task-media-sources/:id/resolve-link', route('resolveLink', req => ({ url: req.body?.url })));
    app.get('/api/task-media-sources/:id/related', route('related', req => ({ itemId: req.query.itemId || '', url: req.query.url || '' })));
    // 封面只接受条目标识，来源自行重新解析地址；不把用户 URL 交给服务端请求。
    app.get('/api/task-media-sources/:id/cover/:itemId', async (req, res) => {
        try {
            registration(req.params.id, 'stream');
            const provider = implementation(req.params.id);
            if (typeof provider.getCover !== 'function') throw new Error('不支持封面');
            const result = await provider.getCover(req.params.itemId);
            if (!result?.stream || result.statusCode !== 200 || !mediaType(result.headers).startsWith('image/')) { result?.stream?.destroy(); throw new Error('封面无效'); }
            res.setHeader('Content-Type', mediaType(result.headers)); res.setHeader('X-Content-Type-Options', 'nosniff');
            result.stream.on('error', () => res.destroy()); res.on('close', () => result.stream.destroy()); result.stream.pipe(res);
        } catch { if (!res.headersSent) res.status(502).end(); else res.destroy(); }
    });
    // 流接口允许显示端跨来源读取，和 B 站媒体流采用相同的 CORS 策略。
    app.use('/api/task-media-sources/:id/stream/:itemId', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    });
    app.get('/api/task-media-sources/:id/stream/:itemId', async (req, res) => {
        let range;
        try { range = parseRange(req.headers.range); }
        catch { return res.status(416).end(); }
        try {
            registration(req.params.id, 'stream');
            const provider = implementation(req.params.id);
            if (typeof provider.getStream !== 'function') throw new Error('不支持播放');
            // 现有 provider 接口只接收起止位置。后缀 Range 先读取全量响应的长度；
            // 上游没有长度时按 HTTP 规则忽略 Range，直接返回 200 全量流。
            let result;
            if (range?.suffix) {
                result = await provider.getStream(req.params.itemId);
                const lengthText = header(result?.headers, 'content-length');
                const size = /^\d+$/.test(lengthText) ? Number(lengthText) : NaN;
                if (Number.isSafeInteger(size) && size > 0 && (result.statusCode || 200) === 200) {
                    result.stream.destroy();
                    range = { start: Math.max(0, size - range.suffix), end: size - 1 };
                    result = await provider.getStream(req.params.itemId, range);
                } else if (size === 0) {
                    result.stream.destroy();
                    return res.status(416).set('Content-Range', 'bytes */0').end();
                }
            } else result = await provider.getStream(req.params.itemId, range);
            const status = result?.statusCode || 200;
            if (!result?.stream || ![200, 206, 416].includes(status)) throw new Error('无效媒体流');
            if (status === 416) {
                const contentRange = header(result.headers, 'content-range');
                if (/^bytes \*\/\d+$/.test(contentRange)) res.setHeader('Content-Range', contentRange);
                result.stream.destroy();
                return res.status(416).end();
            }
            // 部分 provider 可能返回了空或越界的 206；无效 Content-Range 不作为有效媒体流返回。
            if (status === 206) {
                const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header(result.headers, 'content-range'));
                if (!match || Number(match[1]) > Number(match[2]) || Number(match[2]) >= Number(match[3])) {
                    result.stream.destroy();
                    return res.status(416).end();
                }
            }
            res.status(status).setHeader('Content-Type', mediaType(result.headers));
            for (const [key, value] of Object.entries(result.headers || {})) if (STREAM_HEADERS.has(key.toLowerCase()) && value != null) res.setHeader(key, value);
            result.stream.on('error', () => res.destroy());
            res.on('close', () => result.stream.destroy());
            result.stream.pipe(res);
        } catch (error) { if (!res.headersSent) res.status(502).json({ status: 'error', message: safeError(req.params.id, error, '媒体流暂不可用') }); else res.destroy(); }
    });
    app.post('/api/task-media-sources/:id/download', async (req, res) => {
        try {
            const id = req.params.id, item = req.body?.item, targetId = req.body?.targetId;
            const entry = registration(id, 'download');
            if (!item || typeof item.id !== 'string' || !item.id || typeof targetId !== 'string' || !targetId) throw new Error('下载参数无效');
            const parts = parseDirectory(req.body?.dirPath);
            const key = JSON.stringify([id, item.id, targetId]);
            if (running.has(key)) { await running.get(key); return res.json({ status: 'success', downloaded: true, skipped: true }); }
            const provider = implementation(id);
            const operation = (async () => {
                const target = getTarget(targetId, true);
                if (await index.lookup(id, item.id, targetId)) return true;
                const root = await fs.promises.realpath(target.basePath);
                const directory = await files.safeDir(root, [safeName(entry.name), ...parts]);
                const saved = [];
                const save = async (fileName, stream) => {
                    const tmp = path.join(directory, `.aasc-${crypto.randomUUID()}.part`);
                    let output;
                    try {
                        await pipeline(stream, fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
                        const stat = await fs.promises.stat(tmp);
                        output = await files.placeFile(tmp, directory, safeName(fileName || item.title || item.id));
                        saved.push({ output, size: stat.size });
                        return { fileName: path.basename(output), size: stat.size };
                    } catch (error) { if (output) await fs.promises.unlink(output).catch(() => {}); throw error; }
                    finally { await fs.promises.unlink(tmp).catch(() => {}); }
                };
                try {
                    if (typeof provider.download === 'function') await provider.download(item, { targetId, directory, save });
                    else if (typeof provider.getStream === 'function') {
                        const result = await provider.getStream(item.id);
                        // 未请求 Range 时必须获得完整响应；错误页与部分内容不能登记为下载成功。
                        if (!result?.stream || result.statusCode !== 200) {
                            result?.stream?.destroy();
                            throw new Error('媒体下载响应不完整');
                        }
                        await save(item.fileName || `${item.title || item.id}.mp4`, result.stream);
                    } else throw new Error('不支持下载');
                    if (!saved.length) throw new Error('未保存任何文件');
                    const first = saved[0];
                    await index.record({ providerId: id, itemId: item.id, targetId, relative: path.relative(root, first.output), size: first.size, files: saved.map(file => ({ relative: path.relative(root, file.output), size: file.size })) });
                } catch (error) {
                    await Promise.all(saved.map(file => fs.promises.unlink(file.output).catch(() => {})));
                    throw error;
                }
                return false;
            })();
            provider.trackOperation?.(operation);
            running.set(key, operation);
            try { const skipped = await operation; res.json({ status: 'success', downloaded: true, ...(skipped ? { skipped: true } : {}) }); }
            finally { running.delete(key); }
        } catch (error) { res.status(400).json({ status: 'error', message: safeError(req.params.id, error, '下载失败，请检查来源和目标媒体库') }); }
    });
}
module.exports = { registerTaskMediaRoutes, parseRange };
