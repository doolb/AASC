'use strict';
const { get, HEADERS } = require('./http');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const yauzl = require('yauzl');
const ORIGIN = 'https://www.pixiv.net';
const LIMIT = 256 * 1024 * 1024;
let converting = false;
function safeImage(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'i.pximg.net' && !u.username && !u.password && !u.port ? u.href : ''; } catch { return ''; }
}
function extractIllustId(value) {
  const s = String(value || '').trim(); if (/^\d{1,12}$/.test(s)) return s;
  try { const u = new URL(s); if (u.protocol !== 'https:' || u.username || u.password || u.port) return ''; if (['www.pixiv.net', 'pixiv.net'].includes(u.hostname)) return /^\/artworks\/(\d{1,12})\/?$/.exec(u.pathname)?.[1] || ''; if (u.hostname === 'i.pximg.net') return /\/(\d{1,12})_p\d+\.[a-z]+$/i.exec(u.pathname)?.[1] || ''; } catch {} return '';
}
function collection(id, title, cover) { return { id: `pixiv:${id}`, title: String(title || `Pixiv ${id}`).slice(0, 180), cover: safeImage(cover), mediaType: 'collection', url: `${ORIGIN}/artworks/${id}`, downloadable: false }; }
function parseSearch(payload) { return (Array.isArray(payload?.body?.illustManga?.data) ? payload.body.illustManga.data : []).filter(x => /^\d{1,12}$/.test(String(x?.id || ''))).map(x => collection(x.id, x.title, x.url)); }
function parseRanking(payload) { return (Array.isArray(payload?.contents) ? payload.contents : []).filter(x => /^\d{1,12}$/.test(String(x?.illust_id || ''))).map(x => collection(x.illust_id, x.title, x.url)); }
function parseId(value, pageRequired = false) { const m = /^pixiv:(\d{1,12})(?::(\d{1,4}))?$/.exec(String(value || '')); if (!m || (pageRequired && m[2] === undefined)) throw new Error('Pixiv 媒体 ID 无效'); return m; }
// 转码前只读取受限本地文件的头部，拒绝超大尺寸及无法解析的帧。
function framePixels(data) {
  let width = 0, height = 0;
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && data.toString('ascii', 12, 16) === 'IHDR' && data.readUInt32BE(8) === 13) {
    width = data.readUInt32BE(16); height = data.readUInt32BE(20);
  } else if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let pos = 2;
    while (pos + 4 <= data.length) {
      if (data[pos++] !== 0xff) throw new Error('JPEG 头无效');
      while (data[pos] === 0xff) pos++;
      const marker = data[pos++];
      if (marker === 0xda || marker === 0xd9 || marker === 0x00) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (pos + 2 > data.length) break;
      const length = data.readUInt16BE(pos); if (length < 2 || pos + length > data.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 8) break; height = data.readUInt16BE(pos + 3); width = data.readUInt16BE(pos + 5); break;
      }
      pos += length;
    }
  }
  const pixels = width * height;
  if (!width || !height || width > 4096 || height > 4096 || pixels > 8 * 1024 * 1024) throw new Error('动图帧尺寸无效');
  return pixels;
}
function createPixivProvider(config, { cookie = '', httpGet = get, spawnProcess = spawn } = {}) {
  const abort = new AbortController(), operations = new Set(), streams = new Map(), processes = new Set(); let stopping;
  const cache = new Map(), inflight = new Map(), covers = new Map();
  const currentProxy = () => config.proxyUrl || '';
  function remember(store, key, value, limit) {
    store.delete(key); store.set(key, { value, until: Date.now() + 60000 });
    if (store.size > limit) store.delete(store.keys().next().value);
  }
  function cached(store, key) {
    const entry = store.get(key);
    if (!entry || entry.until <= Date.now()) { store.delete(key); return undefined; }
    return entry.value;
  }
  function rememberCovers(items, proxy) {
    for (const item of items) if (item.cover) remember(covers, `${proxy}\0${item.id}`, item.cover, 300);
    return items;
  }
  function check() { if (abort.signal.aborted) throw new Error('Pixiv 来源已停止'); }
  function trackStream(stream) { check(); if (!stream || typeof stream.destroy !== 'function') throw new Error('Pixiv 媒体流无效'); let done; const closed = new Promise(resolve => { done = resolve; }); streams.set(stream, closed); stream.once('close', () => { streams.delete(stream); done(); }); return stream; }
  function track(fn) { return function (...args) { if (abort.signal.aborted) return Promise.reject(new Error('Pixiv 来源已停止')); const p = Promise.resolve().then(() => fn.apply(provider, args)); operations.add(p); p.then(() => operations.delete(p), () => operations.delete(p)); return p; }; }
  async function json(url) {
    check();
    const proxy = currentProxy(), key = `${proxy}\0${url}`;
    const cacheable = /^https:\/\/www\.pixiv\.net\/ajax\/illust\/\d{1,12}(?:\/pages)?\?lang=zh$/.test(url);
    const value = cacheable ? cached(cache, key) : undefined;
    if (value !== undefined) return value;
    if (cacheable && inflight.has(key)) return inflight.get(key);
    const request = (async () => {
      try {
        const r = await httpGet({ ...config, proxyUrl: proxy }, url, { headers: { ...HEADERS, Referer: `${ORIGIN}/`, ...(cookie ? { Cookie: cookie } : {}) }, responseType: 'json', maxRedirects: 0, maxContentLength: 8 * 1024 * 1024, signal: abort.signal });
        check(); if (r.data?.error) throw new Error();
        if (cacheable) remember(cache, key, r.data, 32);
        return r.data;
      } catch { throw new Error('Pixiv 请求失败，请检查网络、代理或 Cookie'); }
    })();
    if (cacheable) inflight.set(key, request);
    try { return await request; } finally { if (inflight.get(key) === request) inflight.delete(key); }
  }
  async function pages(id) {
    const detail = await json(`${ORIGIN}/ajax/illust/${id}?lang=zh`);
    if (Number(detail?.body?.illustType) === 2) return [{ id: `pixiv:${id}:0`, title: String(detail.body.title || `Pixiv ${id}`).slice(0, 180), mediaType: 'video', playable: false, playbackMessage: 'Pixiv 动图请先下载' }];
    const data = await json(`${ORIGIN}/ajax/illust/${id}/pages?lang=zh`);
    return (Array.isArray(data?.body) ? data.body : []).slice(0, 1000).map((p, i) => ({ id: `pixiv:${id}:${i}`, title: `${String(detail?.body?.title || `Pixiv ${id}`).slice(0, 160)} · ${i + 1}`, mediaType: 'image', cover: safeImage(p.urls?.thumb || p.urls?.small || p.urls?.regular), url: safeImage(p.urls?.original || p.urls?.regular) })).filter(p => p.url);
  }
  async function imageStream(id, range) {
    const m = parseId(id, true); if (range && (range.suffix !== undefined ? (!Number.isSafeInteger(range.suffix) || range.suffix <= 0 || range.start !== undefined || range.end !== undefined) : (!Number.isSafeInteger(range.start) || range.start < 0 || (range.end !== undefined && (!Number.isSafeInteger(range.end) || range.end < range.start))))) throw new Error('Range 无效');
    const item = (await pages(m[1])).find(p => p.id === id); if (!item) throw new Error('Pixiv 图片页不存在'); if (!item.url) throw new Error('Pixiv 动图请先下载');
    try { const r = await httpGet(config, item.url, { responseType: 'stream', headers: { ...HEADERS, Referer: `${ORIGIN}/`, ...(range ? { Range: range.suffix !== undefined ? `bytes=-${range.suffix}` : `bytes=${range.start}-${range.end ?? ''}` } : {}) }, timeout: 30000, maxRedirects: 0, signal: abort.signal, validateStatus: s => [200, 206, 416].includes(s) }); if (abort.signal.aborted) { r.data?.destroy(); check(); } trackStream(r.data); const headers = {}; for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers[key]) headers[key] = r.headers[key]; return { stream: r.data, statusCode: r.status, headers }; } catch { throw new Error('Pixiv 媒体流不可用'); }
  }
  async function animation(id, title, save) {
    if (converting) throw new Error('Pixiv 动图下载繁忙'); converting = true; let dir;
    try {
      const meta = (await json(`${ORIGIN}/ajax/illust/${id}/ugoira_meta?lang=zh`))?.body; const url = safeImage(meta?.originalSrc || meta?.src); const frames = meta?.frames;
      if (!url || !Array.isArray(frames) || !frames.length || frames.length > 500 || frames.some(f => !/^\d{1,8}\.(?:jpg|jpeg|png)$/i.test(f.file) || !Number.isFinite(f.delay) || f.delay < 10 || f.delay > 10000) || new Set(frames.map(f => f.file)).size !== frames.length || frames.reduce((n, f) => n + f.delay, 0) > 120000) throw new Error('动图元数据无效');
      dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aasc-pixiv-')); const zipPath = path.join(dir, 'input.zip');
      const r = await httpGet(config, url, { responseType: 'stream', headers: { ...HEADERS, Referer: `${ORIGIN}/` }, timeout: 30000, maxRedirects: 0, signal: abort.signal }); if (r.status !== 200 || Number(r.headers['content-length']) > LIMIT) { r.data.destroy(); throw new Error('压缩包过大'); } trackStream(r.data); let size = 0; const limiter = trackStream(new Transform({ transform(chunk, enc, cb) { size += chunk.length; cb(size > LIMIT ? new Error('压缩包过大') : null, chunk); } })); await pipeline(r.data, limiter, fs.createWriteStream(zipPath, { flags: 'wx', mode: 0o600 })); check();
      await new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
        if (err) return reject(err); const wanted = new Set(frames.map(f => f.file)); let total = 0, count = 0, settled = false;
        const fail = e => { if (!settled) { settled = true; zip.close(); reject(e); } };
        zip.on('error', fail); zip.on('end', () => { if (!settled) { settled = true; wanted.size ? reject(new Error('帧缺失')) : resolve(); } });
        zip.on('entry', entry => { if (abort.signal.aborted || !wanted.has(entry.fileName) || ++count > frames.length || entry.uncompressedSize > 16 * 1024 * 1024 || (total += entry.uncompressedSize) > LIMIT || (entry.externalFileAttributes >>> 16 & 0o170000) === 0o120000) return fail(new Error('帧无效')); wanted.delete(entry.fileName); zip.openReadStream(entry, (e, input) => { if (e) return fail(e); let bytes = 0; const bound = new Transform({ transform(chunk, enc, cb) { bytes += chunk.length; cb(bytes > entry.uncompressedSize ? new Error('帧过大') : null, chunk); } }); pipeline(input, bound, fs.createWriteStream(path.join(dir, entry.fileName), { flags: 'wx', mode: 0o600 })).then(() => zip.readEntry(), fail); }); }); zip.readEntry();
      })); check();
      let pixels = 0; for (const frame of frames) { check(); pixels += framePixels(await fsp.readFile(path.join(dir, frame.file))); if (pixels > 128 * 1024 * 1024) throw new Error('动图总像素过大'); }
      const concat = frames.map(f => `file '${f.file}'\nduration ${f.delay / 1000}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`; await fsp.writeFile(path.join(dir, 'frames.txt'), concat, { flag: 'wx', mode: 0o600 });
      const child = spawnProcess('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-f', 'concat', '-safe', '1', '-i', 'frames.txt', '-fps_mode', 'vfr', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], detached: true }); processes.add(child); const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }; const timer = setTimeout(kill, 120000); let written = 0;
      const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 && !abort.signal.aborted ? resolve() : reject(new Error('转码失败'))); });
      try { const output = pipeline(child.stdout, new Transform({ transform(chunk, enc, cb) { written += chunk.length; cb(written > LIMIT ? new Error('输出过大') : null, chunk); } }), fs.createWriteStream(path.join(dir, 'out.mp4'), { flags: 'wx', mode: 0o600 })); output.catch(kill); if (abort.signal.aborted) kill(); const results = await Promise.allSettled([exited, output]); if (results.some(x => x.status === 'rejected') || !written) throw new Error('转码失败'); } finally { clearTimeout(timer); processes.delete(child); }
      check(); const source = trackStream(fs.createReadStream(path.join(dir, 'out.mp4'))); await save(`${title}.mp4`, source); check();
    } finally { if (dir) await fsp.rm(dir, { recursive: true, force: true }); converting = false; }
  }
  const provider = {
    async home({ page = 1 } = {}) { page = Math.max(1, Math.min(100, Number(page) || 1)); const proxy = currentProxy(); const data = await json(`${ORIGIN}/ranking.php?mode=daily&format=json&p=${page}`); return { items: rememberCovers(parseRanking(data), proxy), page, totalPages: data?.next ? Math.min(100, page + 1) : page }; },
    async search({ keyword, page = 1 } = {}) { const q = String(keyword || '').trim(); if (!q || q.length > 100) throw new Error('Pixiv 搜索关键词无效'); page = Math.max(1, Math.min(1000, Number(page) || 1)); const proxy = currentProxy(); const data = await json(`${ORIGIN}/ajax/search/artworks/${encodeURIComponent(q)}?word=${encodeURIComponent(q)}&p=${page}&mode=all&order=date_d&lang=zh`); return { items: rememberCovers(parseSearch(data), proxy), page, totalPages: Math.min(1000, Math.max(1, Math.ceil(Number(data?.body?.illustManga?.total || 0) / 60))) }; },
    async resolveLink({ url } = {}) { const id = extractIllustId(url); if (!id) throw new Error('请输入 Pixiv 作品链接或作品 ID'); return { items: await pages(id) }; },
    async related({ itemId } = {}) { const id = parseId(itemId)[1]; const data = await json(`${ORIGIN}/ajax/illust/${id}/recommend/init?limit=20&lang=zh`); const list = data?.body?.illusts; return { items: (Array.isArray(list) ? list : []).filter(x => /^\d{1,12}$/.test(String(x?.id || '')) && String(x.id) !== id).map(x => collection(x.id, x.title, x.url)) }; },
    getStream: imageStream,
    async getCover(itemId) {
      const m = parseId(itemId); let url = '';
      if (m[2] !== undefined) { const page = (await pages(m[1])).find(x => x.id === itemId); url = page?.cover || ''; }
      else { url = cached(covers, `${currentProxy()}\0pixiv:${m[1]}`) || ''; if (!url) { const detail = await json(`${ORIGIN}/ajax/illust/${m[1]}?lang=zh`); url = safeImage(detail?.body?.urls?.small || detail?.body?.urls?.regular || detail?.body?.urls?.thumb); } }
      if (!url) throw new Error('Pixiv 封面不可用');
      try {
        const r = await httpGet(config, url, { responseType: 'stream', headers: { ...HEADERS, Referer: `${ORIGIN}/` }, timeout: 30000, maxRedirects: 0, signal: abort.signal });
        const mime = String(r.headers?.['content-type'] || '').split(';')[0].toLowerCase();
        if (r.status !== 200 || !/^image\/(jpeg|png|webp|gif|avif)$/.test(mime) || Number(r.headers['content-length']) > 8 * 1024 * 1024) { r.data?.destroy(); throw new Error(); }
        if (abort.signal.aborted) { r.data?.destroy(); check(); } trackStream(r.data);
        let size = 0; const limited = trackStream(new Transform({ transform(chunk, enc, cb) { size += chunk.length; cb(size > 8 * 1024 * 1024 ? new Error('封面过大') : null, chunk); } }));
        r.data.on('error', error => limited.destroy(error)); limited.on('close', () => r.data.destroy()); r.data.pipe(limited);
        return { stream: limited, statusCode: 200, headers: { 'content-type': mime } };
      } catch { throw new Error('Pixiv 封面不可用'); }
    },
    async list(dir) { if (dir === '/' || dir === '') return (await this.home()).items.map(x => ({ name: x.title, path: `/pixiv-${x.id.slice(6)}`, type: 'folder' })); const m = /^\/pixiv-(\d{1,12})$/.exec(String(dir)); if (!m) throw new Error('目录不存在'); return (await pages(m[1])).filter(x => x.playable !== false).map(x => ({ name: x.title, path: `/pixiv-${m[1]}-${x.id.split(':')[2]}`, type: 'file', mediaType: x.mediaType })); },
    async getFile(file) { const m = /^\/pixiv-(\d{1,12})-(\d{1,4})$/.exec(String(file)); if (!m) throw new Error('Pixiv 路径无效'); const item = (await pages(m[1])).find(x => x.id === `pixiv:${m[1]}:${m[2]}`); if (!item) throw new Error('Pixiv 图片页不存在'); return { name: item.title, path: file, type: 'file', mediaType: item.mediaType }; },
    async getFileStream(file, range) { const m = /^\/pixiv-(\d{1,12})-(\d{1,4})$/.exec(String(file)); if (!m) throw new Error('Pixiv 路径无效'); return imageStream(`pixiv:${m[1]}:${m[2]}`, range); },
    async download(item, { save }) { const m = parseId(item?.id, true); const title = String(item?.title || 'Pixiv').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, ' ').trim().slice(0, 100) || 'Pixiv'; try { const page = (await pages(m[1])).find(x => x.id === item.id); if (!page) throw new Error(); if (page.mediaType === 'video') return await animation(m[1], title, save); const ext = /\.(jpg|jpeg|png|gif|webp)$/i.exec(new URL(page.url).pathname)?.[1]?.toLowerCase(); if (!ext) throw new Error(); const result = await imageStream(item.id); if (result.statusCode !== 200 || Number(result.headers['content-length']) > LIMIT) { result.stream.destroy(); throw new Error(); } let size = 0; const limited = trackStream(new Transform({ transform(chunk, enc, cb) { size += chunk.length; cb(size > LIMIT ? new Error('文件过大') : null, chunk); } })); result.stream.on('error', e => limited.destroy(e)); limited.on('close', () => result.stream.destroy()); result.stream.pipe(limited); await save(`${title}.${ext}`, limited); check(); } catch { throw new Error('Pixiv 下载失败，请检查网络、代理或动图格式'); } }
  };
  for (const name of ['home', 'search', 'related', 'resolveLink', 'getStream', 'getCover', 'list', 'getFile', 'getFileStream', 'download']) provider[name] = track(provider[name]);
  provider.stop = () => { if (!stopping) stopping = (async () => { abort.abort(); cache.clear(); covers.clear(); for (const child of processes) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } const closed = [...streams].map(([stream, done]) => { stream.destroy(); return done; }); await Promise.allSettled([...operations]); inflight.clear(); await Promise.all(closed); })(); return stopping; }; return provider;
}
module.exports = { createPixivProvider, extractIllustId, parseSearch, parseRanking, safeImage, framePixels };
