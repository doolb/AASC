'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { get, HEADERS } = require('./http');

const ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH = 'https://www.youtube.com/watch?v=';
function extractVideoId(value) {
  const text = String(value || '').trim();
  if (ID.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (url.hostname === 'youtu.be') return ID.test(url.pathname.slice(1)) ? url.pathname.slice(1) : '';
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return '';
    const id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    return ID.test(id || '') ? id : '';
  } catch { return ''; }
}
function parseInitialData(html) {
  const match = /(?:var\s+ytInitialData|window\["ytInitialData"\]|ytInitialData)\s*=\s*/.exec(String(html || ''));
  if (!match) return null;
  const text = String(html).slice(match.index + match[0].length);
  if (text[0] !== '{') return null;
  // 括号计数时跳过 JSON 字符串，避免标题里的分号或花括号截断数据。
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(text.slice(0, i + 1)); } catch { return null; } }
  }
  return null;
}
function collectVideoRenderers(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (node.videoRenderer?.videoId) output.push(node.videoRenderer);
  if (node.compactVideoRenderer?.videoId) output.push(node.compactVideoRenderer);
  for (const value of Object.values(node)) collectVideoRenderers(value, output);
  return output;
}
function textOf(value) { return value?.simpleText || value?.runs?.map(run => run.text || '').join('') || ''; }
function normalizeVideoRenderer(renderer) {
  const id = String(renderer.videoId || '');
  return { id, title: textOf(renderer.title).slice(0, 180) || id, author: textOf(renderer.ownerText || renderer.shortBylineText).slice(0, 80), cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, mediaType: 'video', url: `${WATCH}${id}` };
}
function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'));
  } catch { return false; }
}
function requireId(value) { const id = extractVideoId(value); if (!id) throw new Error('YouTube 视频 ID 无效'); return id; }
function createYoutubeProvider(config, { ytdlp, cookie = '', httpGet = get } = {}) {
  if (!ytdlp) throw new Error('缺少 yt-dlp');
  const abort = new AbortController();
  const operations = new Set(), streams = new Map();
  let stopping;
  function check() { if (abort.signal.aborted) throw new Error('YouTube 来源已停止'); }
  function trackStream(stream) {
    check();
    if (!stream || typeof stream.destroy !== 'function') throw new Error('YouTube 媒体流无效');
    let done;
    const closed = new Promise(resolve => { done = resolve; });
    const finish = () => { streams.delete(stream); done(); };
    streams.set(stream, closed);
    stream.once('close', finish);
    return stream;
  }
  function track(action) {
    return function (...args) {
      if (abort.signal.aborted) return Promise.reject(new Error('YouTube 来源已停止'));
      const promise = Promise.resolve().then(() => action.apply(provider, args));
      operations.add(promise);
      promise.then(() => operations.delete(promise), () => operations.delete(promise));
      return promise;
    };
  }
  async function page(url) {
    try {
      const response = await httpGet(config, url, { headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) }, responseType: 'text', signal: abort.signal, maxContentLength: 5 * 1024 * 1024, maxRedirects: 0 });
      check();
      const data = parseInitialData(response.data);
      if (!data) throw new Error('invalid');
      const unique = new Map();
      for (const renderer of collectVideoRenderers(data)) { const item = normalizeVideoRenderer(renderer); if (ID.test(item.id)) unique.set(item.id, item); }
      return [...unique.values()];
    } catch { throw new Error('YouTube 页面不可用，请检查网络、代理或 Cookie'); }
  }
  async function resolve(id) {
    let result;
    try { result = await ytdlp.resolve(`${WATCH}${id}`); } catch { throw new Error('YouTube 视频解析失败，请检查网络或代理'); }
    check();
    if (!result || !safeMediaUrl(result.url)) throw new Error('YouTube 返回了不可信的媒体地址');
    return result;
  }
  async function getStream(itemId, range) {
    const resolved = await resolve(requireId(itemId));
    if (range && (!Number.isSafeInteger(range.start) || range.start < 0 || (range.end !== undefined && (!Number.isSafeInteger(range.end) || range.end < range.start)))) throw new Error('Range 无效');
    try {
      const response = await httpGet(config, resolved.url, { responseType: 'stream', signal: abort.signal, headers: { ...HEADERS, ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}) }, timeout: 30000, maxRedirects: 0, validateStatus: status => [200, 206, 416].includes(status) });
      if (abort.signal.aborted) { response.data?.destroy(); check(); }
      trackStream(response.data);
      const headers = {};
      for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (response.headers[key]) headers[key] = response.headers[key];
      return { stream: response.data, statusCode: response.status, headers };
    } catch { throw new Error('YouTube 媒体流不可用'); }
  }
  const provider = {
    async home() {
      try { await ytdlp.ensure(); check(); } catch { throw new Error('YouTube 初始化失败，请检查 yt-dlp、网络和代理'); }
      const items = (await page('https://www.youtube.com/')).slice(0, 20);
      if (!items.length) throw new Error('YouTube 首页暂无推荐视频，请尝试搜索或检查登录状态');
      return { items, page: 1, totalPages: 1 }; },
    async search({ keyword } = {}) { const q = String(keyword || '').trim(); if (!q || q.length > 100) throw new Error('YouTube 搜索关键词无效'); return { items: await page(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`), page: 1, totalPages: 1 }; },
    async related({ itemId, url } = {}) { const id = requireId(itemId || url); return { items: (await page(`${WATCH}${id}`)).filter(item => item.id !== id).slice(0, 20) }; },
    async resolveLink({ url } = {}) { const id = requireId(url); const metadata = await resolve(id); if (!metadata.title) throw new Error('YouTube 未返回视频标题'); return { items: [{ id, title: metadata.title, mediaType: 'video', url: `${WATCH}${id}`, cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }] }; },
    getStream,
    async list(dirPath) { if (dirPath !== '/' && dirPath !== '') throw new Error('目录不存在'); return (await this.home()).items.map(item => ({ name: item.title, path: `/${item.id}`, type: 'file', mediaType: 'video' })); },
    async getFile(filePath) { const id = requireId(String(filePath).replace(/^\//, '')); const item = (await this.resolveLink({ url: id })).items[0]; return { name: item.title, path: `/${id}`, type: 'file', mediaType: 'video' }; },
    async getFileStream(filePath, range) { return getStream(String(filePath).replace(/^\//, ''), range); },
    async download(item, { save }) {
      const id = requireId(item?.id || item?.url);
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-youtube-'));
      try {
        const output = await ytdlp.run(`${WATCH}${id}`, path.join(dir, 'video.%(ext)s'));
        check();
        const resolved = path.resolve(output);
        const stat = await fs.promises.lstat(resolved);
        const ext = path.extname(resolved).slice(1).toLowerCase();
        if (path.dirname(resolved) !== dir || !stat.isFile() || stat.isSymbolicLink() || !/^[a-z0-9]{1,10}$/.test(ext) || !stat.size) throw new Error('下载文件无效');
        const title = String(item?.title || id).replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, ' ').trim().slice(0, 100) || id;
        check();
        await save(`${title}.${ext}`, trackStream(fs.createReadStream(resolved)));
        check();
      } catch { throw new Error('YouTube 下载失败，请检查网络和代理'); }
      finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
    }
  };
  for (const name of ['home', 'search', 'related', 'resolveLink', 'getStream', 'list', 'getFile', 'getFileStream', 'download']) provider[name] = track(provider[name]);
  provider.stop = () => {
    if (!stopping) stopping = (async () => {
      abort.abort();
      const closed = [...streams.entries()].map(([stream, done]) => { stream.destroy(); return done; });
      await Promise.allSettled([...operations]);
      await Promise.all(closed);
    })();
    return stopping;
  };
  return provider;
}
module.exports = { createYoutubeProvider, extractVideoId, normalizeVideoRenderer, collectVideoRenderers, parseInitialData, safeMediaUrl };
