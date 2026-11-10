'use strict';

const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const nativeFs = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { get, HEADERS } = require('./http');
const cheerio = require('cheerio');
const ORIGIN = 'https://www.pinterest.com';
const MAX_DOWNLOAD = 256 * 1024 * 1024;
let activeHls = false;
const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'mp4', 'webm', 'mov', 'm3u8']);

function isAllowedPinUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'pinimg.com' || url.hostname.endsWith('.pinimg.com'));
  } catch { return false; }
}
function extension(value) {
  try { const match = /\.([a-z0-9]+)$/i.exec(new URL(value).pathname); const ext = match?.[1]?.toLowerCase(); return EXTENSIONS.has(ext) ? ext : ''; } catch { return ''; }
}
function encodePinId(url) {
  if (!isAllowedPinUrl(url) || !extension(url)) throw new Error('Pinterest 媒体地址无效或格式不支持');
  return `pin:${Buffer.from(url, 'utf8').toString('base64url')}`;
}
function decodePinId(id) {
  const match = /^pin:([A-Za-z0-9_-]{1,4096})$/.exec(String(id || ''));
  if (!match) throw new Error('Pinterest 媒体 ID 无效');
  const url = Buffer.from(match[1], 'base64url').toString('utf8');
  if (Buffer.from(url).toString('base64url') !== match[1] || !isAllowedPinUrl(url) || !extension(url)) throw new Error('Pinterest 媒体地址无效或格式不支持');
  return url;
}
function parsePins(data) {
  const found = new Map(), visited = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (node.images || node.videos) {
      const image = node.images?.orig?.url || node.images?.['736x']?.url || Object.values(node.images || {}).find(value => value?.url)?.url;
      const video = Object.values(node.videos?.video_list || {}).find(value => isAllowedPinUrl(value?.url) && ['mp4', 'webm', 'mov', 'm3u8'].includes(extension(value.url)))?.url;
      // HLS 保留为视频，下载时受控抓取并转封装。
      const url = video || (!node.videos && isAllowedPinUrl(image) && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(extension(image)) ? image : '');
      if (url) found.set(url, { id: encodePinId(url), title: String(node.title || node.grid_title || 'Pinterest 媒体').slice(0, 180), cover: isAllowedPinUrl(image) ? image : '', mediaType: video ? 'video' : 'image', ...(extension(url) === 'm3u8' ? { playable: false, playbackMessage: 'HLS 视频请先下载' } : {}) });
    }
    for (const value of Object.values(node)) visit(value);
  }
  visit(data);
  return [...found.values()];
}
function parsePage(html) {
  const text = String(html || '');
  const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const parsedScripts = [];
  for (const [, attrs, body] of scripts) {
    let json = '';
    if (/\bid=["'](?:__PWS_DATA__|__PWS_INITIAL_PROPS__)["']/i.test(attrs)) json = body.trim();
    else { const match = /(?:window\.)?__PWS_DATA__\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(body); if (match) json = match[1].replace(/;\s*$/, ''); }
    if (json) { try { parsedScripts.push(JSON.parse(json)); } catch {} }
  }
  return parsedScripts.length ? parsedScripts : null;
}
function pinLink(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['pinterest.com', 'www.pinterest.com'].includes(url.hostname)) return '';
    const id = /^\/pin\/(?:[a-zA-Z0-9-]+--)?(\d+)\/?$/.exec(url.pathname)?.[1];
    return id ? `${ORIGIN}/pin/${id}/` : '';
  } catch { return ''; }
}
function pinCanonicalMatches(html, requested) {
  const $ = cheerio.load(String(html || ''));
  const canonical = $('meta[property="og:url"]').first().attr('content') || '';
  const target = pinLink(requested);
  return Boolean(target && pinLink(canonical) === target);
}
function parseMatchingPin(data, requested) {
  const target = pinLink(requested), id = target && /\/pin\/(\d+)\/$/.exec(target)?.[1];
  if (!id) return [];
  const found = [], visited = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    // 只提取同 ID 对象本身的媒体字段，不递归抽取推荐对象。
    if (String(node.id || '') === id) found.push(...parsePins({ images: node.images, videos: node.videos, title: node.title, grid_title: node.grid_title }));
    for (const value of Object.values(node)) visit(value);
  }
  visit(data);
  return found;
}
function parsePinMetadata(html, requested) {
  const target = pinLink(requested); if (!target) return [];
  const $ = cheerio.load(String(html || ''));
  const meta = name => $(`meta[property="${name}"]`).first().attr('content') || '';
  // canonical 与请求必须指向同一 Pin；视频封面不能冒充图片。
  if (!pinCanonicalMatches(html, requested) || meta('og:type') !== 'pinterestapp:pin' || meta('og:video') || meta('og:video:url') || meta('og:video:secure_url') || meta('og:video:type') || $('meta[name="twitter:player"]').length) return [];
  const image = meta('og:image');
  if (!isAllowedPinUrl(image) || !['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(extension(image))) return [];
  return [{ id: encodePinId(image), title: String(meta('og:title') || 'Pinterest 媒体').slice(0, 180), cover: image, mediaType: 'image' }];
}
function createPinterestProvider(config, { cookie = '', httpGet = get, hlsOutputLimit = MAX_DOWNLOAD } = {}) {
  const abort = new AbortController(), operations = new Set(), streams = new Map();
  let stopping; const processes = new Set();
  function check() { if (abort.signal.aborted) throw new Error('Pinterest 来源已停止'); }
  function trackStream(stream) {
    check();
    if (!stream || typeof stream.destroy !== 'function') throw new Error('Pinterest 媒体流无效');
    let finish; const closed = new Promise(resolve => { finish = resolve; });
    streams.set(stream, closed); stream.once('close', () => { streams.delete(stream); finish(); });
    return stream;
  }
  function track(action) { return function (...args) {
    if (abort.signal.aborted) return Promise.reject(new Error('Pinterest 来源已停止'));
    const promise = Promise.resolve().then(() => action.apply(provider, args)); operations.add(promise);
    promise.then(() => operations.delete(promise), () => operations.delete(promise)); return promise;
  }; }
  function restrictedMessage() {
    return cookie ? 'Pinterest 访问受限，请检查 Cookie 是否有效或站点访问限制' : 'Pinterest 匿名访问受限，请配置 Cookie 或检查站点访问限制';
  }
  async function page(url, pin = false) {
    let response;
    try { response = await httpGet(config, url, { headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) }, responseType: 'text', signal: abort.signal, maxContentLength: 8 * 1024 * 1024, maxRedirects: 0 }); check(); }
    catch (error) {
      if ([401, 403].includes(error?.response?.status)) throw new Error(restrictedMessage());
      throw new Error('Pinterest 页面不可用，请检查网络、代理或 Cookie');
    }
    if ([401, 403].includes(response.status)) throw new Error(restrictedMessage());
    const data = parsePage(response.data);
    if (pin) {
      const $ = cheerio.load(String(response.data || ''));
      const canonical = $('meta[property="og:url"]').first().attr('content');
      if (!canonical && /log\s*in|sign\s*in|登录/i.test(String(response.data))) throw new Error(restrictedMessage());
    }
    if (pin && !pinCanonicalMatches(response.data, url)) throw new Error('Pinterest 未返回与链接匹配的媒体');
    const metadata = pin ? parsePinMetadata(response.data, url) : [];
    if (!data && !metadata.length) {
      if (/log\s*in|sign\s*in|登录/i.test(String(response.data))) throw new Error(restrictedMessage());
      throw new Error('Pinterest 页面数据不可用');
    }
    const items = data ? (pin ? parseMatchingPin(data, url) : parsePins(data)) : [];
    if (!items.length && metadata.length) return metadata;
    if (!items.length && pin) throw new Error('Pinterest 未返回与链接匹配的媒体');
    if (!items.length && /log\s*in|sign\s*in|登录/i.test(String(response.data))) throw new Error(restrictedMessage());
    if (!items.length) throw new Error('Pinterest 未返回可用媒体');
    return items;
  }
  async function getStream(id, range) {
    const url = decodePinId(id);
    if (extension(url) === 'm3u8') throw new Error('Pinterest HLS 视频请先下载');
    if (range && (!Number.isSafeInteger(range.start) || range.start < 0 || (range.end !== undefined && (!Number.isSafeInteger(range.end) || range.end < range.start)))) throw new Error('Range 无效');
    try {
      const response = await httpGet(config, url, { responseType: 'stream', signal: abort.signal, headers: { ...HEADERS, Referer: `${ORIGIN}/`, ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}) }, timeout: 30000, maxRedirects: 0, validateStatus: status => [200, 206, 416].includes(status) });
      if (abort.signal.aborted) { response.data?.destroy(); check(); }
      trackStream(response.data);
      const headers = {}; for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (response.headers[key]) headers[key] = response.headers[key];
      return { stream: response.data, statusCode: response.status, headers };
    } catch { throw new Error('Pinterest 媒体流不可用'); }
  }
  async function downloadHls(url, title, save) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-pinterest-'));
    const deadline = Date.now() + 120000;
    let total = 0, count = 0;
    async function fetchBytes(target, max) {
      check();
      if (!isAllowedPinUrl(target) || Date.now() >= deadline || ++count > 110) throw new Error('HLS 地址或限制无效');
      const response = await httpGet(config, target, { responseType: 'arraybuffer', signal: abort.signal, headers: { ...HEADERS, Referer: `${ORIGIN}/` }, maxRedirects: 0, timeout: Math.max(1, Math.min(30000, deadline - Date.now())), maxContentLength: max });
      check();
      if (response.status !== 200) throw new Error('HLS 请求失败');
      const bytes = Buffer.from(response.data); total += bytes.length;
      if (bytes.length > max || total > MAX_DOWNLOAD) throw new Error('HLS 数据过大');
      return bytes;
    }
    async function playlist(target, depth) {
      if (depth > 3 || extension(target) !== 'm3u8') throw new Error('HLS 列表无效');
      const body = (await fetchBytes(target, 1024 * 1024)).toString('utf8');
      if (!body.startsWith('#EXTM3U') || /#EXT-X-(?:KEY|SESSION-KEY|MAP|BYTERANGE|DISCONTINUITY|I-FRAME-STREAM-INF)/i.test(body)) throw new Error('HLS 加密或格式不支持');
      const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const refs = lines.filter(line => !line.startsWith('#'));
      if (!refs.length || refs.length > 100) throw new Error('HLS 分段数量无效');
      const resolve = ref => { const next = new URL(ref, target).href; if (!isAllowedPinUrl(next)) throw new Error('HLS 地址无效'); return next; };
      if (lines.some(line => line.startsWith('#EXT-X-STREAM-INF:'))) return playlist(resolve(refs[0]), depth + 1);
      if (!lines.includes('#EXT-X-ENDLIST') || refs.some(ref => !/\.ts$/i.test(new URL(ref, target).pathname))) throw new Error('HLS 直播或分段格式不支持');
      return refs.map(resolve);
    }
    try {
      const segments = await playlist(url, 0); const names = [];
      for (const [index, segment] of segments.entries()) {
        const name = `segment${index}.ts`; await fs.writeFile(path.join(dir, name), await fetchBytes(segment, 20 * 1024 * 1024), { flag: 'wx', mode: 0o600 }); names.push(`file '${name}'`);
      }
      await fs.writeFile(path.join(dir, 'segments.txt'), names.join('\n') + '\n', { flag: 'wx', mode: 0o600 }); check();
      const output = path.join(dir, 'output.mp4');
      const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-f', 'concat', '-safe', '1', '-i', 'segments.txt', '-c', 'copy', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
      processes.add(child); let timedOut = false, written = 0;
      const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
      const timer = setTimeout(() => { timedOut = true; kill(); }, Math.max(1, deadline - Date.now()));
      const exited = new Promise((resolve, reject) => {
        child.once('error', () => reject(new Error('ffmpeg 不可用')));
        child.once('close', code => code === 0 && !timedOut && !abort.signal.aborted ? resolve() : reject(new Error('HLS 转封装失败')));
      });
      const limit = new Transform({ transform(chunk, encoding, callback) { written += chunk.length; callback(written > hlsOutputLimit ? new Error('HLS 输出过大') : null, chunk); } });
      try {
        if (abort.signal.aborted) kill();
        const outputDone = pipeline(child.stdout, limit, nativeFs.createWriteStream(output, { flags: 'wx', mode: 0o600 }));
        outputDone.catch(kill);
        const results = await Promise.allSettled([exited, outputDone]);
        if (results.some(result => result.status === 'rejected')) throw new Error('HLS 转封装失败');
      } finally { clearTimeout(timer); processes.delete(child); }
      check(); const stat = await fs.lstat(output); if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_DOWNLOAD) throw new Error('HLS 输出无效');
      const source = trackStream(require('node:fs').createReadStream(output)); await save(`${title}.mp4`, source); check();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  const provider = {
    async home({ page: requestedPage = 1 } = {}) { if (Number(requestedPage) !== 1) throw new Error('Pinterest 暂不支持首页分页'); return { items: (await page(`${ORIGIN}/`)).slice(0, 30), page: 1, totalPages: 1 }; },
    async search({ keyword, page: requestedPage = 1 } = {}) { if (Number(requestedPage) !== 1) throw new Error('Pinterest 暂不支持搜索分页'); const q = String(keyword || '').trim(); if (!q || q.length > 100) throw new Error('Pinterest 搜索关键词无效'); return { items: await page(`${ORIGIN}/search/pins/?q=${encodeURIComponent(q)}`), page: 1, totalPages: 1 }; },
    async resolveLink({ url } = {}) { const target = pinLink(url); if (!target) throw new Error('请输入 Pinterest Pin 链接'); return { items: await page(target, true) }; },
    async related({ itemId } = {}) { decodePinId(itemId); return { items: [] }; },
    getStream,
    async list(dir) { if (dir !== '/' && dir !== '') throw new Error('目录不存在'); return (await this.home()).items.map(item => ({ name: item.title, path: `/pin-${item.id.slice(4)}`, type: 'file', mediaType: item.mediaType })); },
    async getFile(file) { const id = String(file).replace(/^\/pin-/, 'pin:'), url = decodePinId(id), ext = extension(url); return { name: `Pinterest.${ext}`, path: `/pin-${id.slice(4)}`, type: 'file', mediaType: ['mp4', 'webm', 'mov', 'm3u8'].includes(ext) ? 'video' : 'image' }; },
    async getFileStream(file, range) { return getStream(String(file).replace(/^\/pin-/, 'pin:'), range); },
    async download(item, { save }) {
      const url = decodePinId(item?.id), ext = extension(url);
      const title = String(item?.title || 'Pinterest').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, ' ').trim().slice(0, 100) || 'Pinterest';
      try {
        if (ext === 'm3u8') {
          if (activeHls) throw new Error('Pinterest HLS 下载繁忙');
          activeHls = true;
          try { return await downloadHls(url, title, save); } finally { activeHls = false; }
        }
        const result = await getStream(item.id);
        if (result.statusCode !== 200 || Number(result.headers['content-length']) > MAX_DOWNLOAD) { result.stream.destroy(); throw new Error('响应无效'); }
        let bytes = 0;
        const limited = trackStream(new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; callback(bytes > MAX_DOWNLOAD ? new Error('文件过大') : null, chunk); } }));
        result.stream.on('error', error => limited.destroy(error)); limited.on('close', () => result.stream.destroy()); result.stream.pipe(limited);
        await save(`${title}.${ext}`, limited); check();
      } catch { throw new Error('Pinterest 下载失败：网络、代理或 HLS 格式不支持'); }
    }
  };
  for (const name of ['home', 'search', 'related', 'resolveLink', 'getStream', 'list', 'getFile', 'getFileStream', 'download']) provider[name] = track(provider[name]);
  provider.stop = () => { if (!stopping) stopping = (async () => { abort.abort(); for (const child of processes) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } const closed = [...streams].map(([stream, done]) => { stream.destroy(); return done; }); await Promise.allSettled([...operations]); await Promise.all(closed); })(); return stopping; };
  return provider;
}
module.exports = { createPinterestProvider, encodePinId, decodePinId, parsePins, isAllowedPinUrl, parsePage, pinLink, parsePinMetadata, parseMatchingPin };
