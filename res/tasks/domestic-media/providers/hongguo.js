'use strict';

// 只使用红果公开页面明确列出的地址，禁止根据视频 ID 猜测媒体地址。
const cheerio = require('cheerio');
const { get, HEADERS } = require('./http');
const ORIGIN = 'https://hongguoduanju.com';
const ID = '[1-9][0-9]{0,19}';
const ID_RE = new RegExp(`^${ID}$`);
const EPISODE_RE = new RegExp(`^episode:(${ID}):(${ID})$`);
const FILE_RE = new RegExp(`^/(${ID})/(${ID})\\.mp4$`);
const MAX_ITEMS = 200;

function parseSeriesId(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  const text = value.trim();
  if (ID_RE.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.origin !== ORIGIN || url.username || url.password) return '';
    const direct = url.pathname.match(new RegExp(`^/player/(${ID})(?:/${ID})?/?$`))?.[1];
    const query = url.pathname === '/detail' ? url.searchParams.get('series_id') : '';
    return direct || (ID_RE.test(query || '') ? query : '');
  } catch { return ''; }
}
function safeCover(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function title(value, fallback) { return typeof value === 'string' ? value.trim().slice(0, 180) || fallback : fallback; }
function collectionItem(id, name, cover = '') {
  return { id: `series:${id}`, title: title(name, '红果剧集'), cover: safeCover(cover), mediaType: 'collection', downloadable: false, url: `${ORIGIN}/detail?series_id=${id}` };
}
function htmlItems(html) {
  if (typeof html !== 'string') return [];
  const $ = cheerio.load(html), found = new Map();
  $('a[href^="/detail?series_id="]').each((_i, el) => {
    if (found.size >= MAX_ITEMS) return false;
    const id = /^\/detail\?series_id=([1-9][0-9]{0,19})$/.exec($(el).attr('href') || '')?.[1];
    if (!id || found.has(id)) return;
    const img = $(el).find('img').first();
    found.set(id, collectionItem(id, img.attr('alt') || $(el).text(), img.attr('src') || img.attr('data-src')));
  });
  return [...found.values()];
}
function parseSearchPayload(payload) {
  const list = Array.isArray(payload?.searchList) ? payload.searchList.slice(0, 1000) : [];
  const found = new Map();
  for (const item of list) {
    const raw = item?.video_data?.series_id;
    const id = typeof raw === 'string' ? raw : Number.isSafeInteger(raw) ? String(raw) : '';
    if (ID_RE.test(id) && !found.has(id)) found.set(id, collectionItem(id, item.name, item.cover || item.video_data?.cover));
    if (found.size >= MAX_ITEMS) break;
  }
  return [...found.values()];
}
function episodeItems(id, html) {
  if (!ID_RE.test(id) || typeof html !== 'string') return [];
  const $ = cheerio.load(html), found = new Map();
  $('script[type="application/ld+json"]').each((_i, el) => {
    if (found.size >= MAX_ITEMS) return false;
    try {
      const data = JSON.parse($(el).html());
      const entries = Array.isArray(data?.['@graph']) ? data['@graph'].slice(0, 1000) : [data];
      for (const entry of entries) {
        const match = new RegExp(`^https://hongguoduanju\\.com/video/public/(${ID})/360p\\.mp4$`).exec(typeof entry?.contentUrl === 'string' ? entry.contentUrl : '');
        if (entry?.['@type'] !== 'VideoObject' || !match || found.has(match[1])) continue;
        found.set(match[1], { id: `episode:${id}:${match[1]}`, title: title(entry.name, '公开片段'), mediaType: 'video', url: `${ORIGIN}/player/${id}`, libraryPath: `/${id}/${match[1]}.mp4` });
        if (found.size >= MAX_ITEMS) break;
      }
    } catch { /* 忽略无关或无效的结构化数据。 */ }
  });
  return [...found.values()];
}
function episodeLinks(id, html) {
  if (!ID_RE.test(id) || typeof html !== 'string') return [];
  const $ = cheerio.load(html), found = new Map();
  const allowed = new RegExp(`^/player/${id}(?:/(${ID}))?/?$`);
  $('a[href]').each((_i, el) => {
    if (found.size >= MAX_ITEMS) return false;
    try {
      const url = new URL($(el).attr('href'), ORIGIN);
      const match = url.pathname.match(allowed);
      if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || !match) return;
      const pathname = `/player/${id}${match[1] ? `/${match[1]}` : ''}`;
      if (found.has(pathname)) return;
      const label = title($(el).text(), `第${found.size + 1}集`);
      found.set(pathname, { pathname, title: /^\d+$/.test(label) ? `第${label}集` : label });
    } catch { /* 忽略无效链接。 */ }
  });
  return [...found.values()];
}
function createHongguoProvider(config = {}, { cookie = '' } = {}) {
  const pages = new Map();
  const episodePages = new Map();
  const controller = new AbortController();
  const pending = new Set(), streams = new Set();
  let stopped = false;
  function active() { if (stopped) throw new Error('红果来源已停止'); }
  function track(promise) {
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }
  async function request(url, options) {
    active();
    const response = await track(get(config, url, { ...options, signal: controller.signal }));
    if (stopped) { response.data?.destroy?.(); throw new Error('红果来源已停止'); }
    return response;
  }
  const headers = { ...HEADERS, Referer: `${ORIGIN}/`, ...(typeof cookie === 'string' && cookie && !/[\r\n]/.test(cookie) && cookie.length <= 8192 ? { Cookie: cookie } : {}) };
  async function page(pathname) {
    active();
    const cached = pages.get(pathname);
    if (cached && cached.until > Date.now()) return cached.html;
    const response = await request(ORIGIN + pathname, { responseType: 'text', headers, maxContentLength: 3 * 1024 * 1024 });
    if (typeof response.data !== 'string') throw new Error('红果页面格式无效');
    if (pages.size >= 32) pages.delete(pages.keys().next().value);
    pages.set(pathname, { html: response.data, until: Date.now() + 60000 });
    return response.data;
  }
  async function series(id) {
    const firstPage = await page(`/player/${id}`);
    const links = episodeLinks(id, firstPage);
    if (!links.length) return episodeItems(id, firstPage);
    const results = new Array(links.length);
    let next = 0;
    async function worker() {
      while (next < links.length) {
        const index = next++, link = links[index];
        try {
          const html = link.pathname === `/player/${id}` ? firstPage : await page(link.pathname);
          const item = episodeItems(id, html)[0];
          if (item) {
            episodePages.set(item.id, link.pathname);
            if (episodePages.size > 1000) episodePages.delete(episodePages.keys().next().value);
            results[index] = { ...item, title: link.title, url: ORIGIN + link.pathname };
            continue;
          }
        } catch (error) { if (stopped) throw error; }
        results[index] = { id: `episode-page:${id}:${link.pathname.split('/').pop()}`, title: link.title, mediaType: 'video', url: ORIGIN + link.pathname, playable: false, downloadable: false, playbackMessage: '暂无公开播放地址' };
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, links.length) }, () => worker()));
    return results;
  }
  async function find(itemId) {
    const match = EPISODE_RE.exec(typeof itemId === 'string' ? itemId : '');
    if (!match) throw new Error('红果视频 ID 无效');
    let pathname = episodePages.get(itemId);
    if (!pathname) {
      const item = (await series(match[1])).find(entry => entry.id === itemId);
      if (!item) throw new Error('网站未公开该视频地址');
      pathname = episodePages.get(itemId) || `/player/${match[1]}`;
    }
    const item = episodeItems(match[1], await page(pathname)).find(entry => entry.id === itemId);
    if (!item) throw new Error('网站未公开该视频地址');
    return { item, videoId: match[2] };
  }
  async function getStream(itemId, range) {
    const { videoId } = await find(itemId);
    if (range && (!Number.isSafeInteger(range.start) || range.start < 0 || (range.end !== undefined && (!Number.isSafeInteger(range.end) || range.end < range.start)))) throw new Error('视频范围无效');
    const response = await request(`${ORIGIN}/video/public/${videoId}/360p.mp4`, {
      responseType: 'stream', headers: { ...headers, ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}) }, timeout: 20000,
      validateStatus: status => [200, 206, 416].includes(status)
    });
    const stream = response.data;
    if (!stream || typeof stream.destroy !== 'function') throw new Error('红果媒体流无效');
    streams.add(stream);
    stream.once('close', () => streams.delete(stream));
    const output = {};
    for (const [key, name] of [['content-type', 'Content-Type'], ['content-length', 'Content-Length'], ['content-range', 'Content-Range'], ['accept-ranges', 'Accept-Ranges']]) if (response.headers[key]) output[name] = response.headers[key];
    return { stream, statusCode: response.status, headers: output };
  }
  return {
    async home({ page: p = 1 } = {}) { return { items: Number(p) === 1 ? htmlItems(await page('/')) : [], page: 1, totalPages: 1 }; },
    async search({ keyword, page: p = 1 } = {}) {
      const text = typeof keyword === 'string' ? keyword.trim() : '';
      if (!text || text.length > 100) throw new Error('红果搜索关键词无效');
      // 上游的分页参数尚未确认，不能重复请求同一页并冒充后续结果。
      if (Number(p) !== 1) return { items: [], page: 1, totalPages: 1 };
      const response = await request(`${ORIGIN}/api/search/result/`, { params: { query: text }, headers, maxContentLength: 3 * 1024 * 1024 });
      return { items: parseSearchPayload(response.data), page: 1, totalPages: 1 };
    },
    async resolveLink({ url } = {}) { const id = parseSeriesId(url); if (!id) throw new Error('红果剧集链接无效'); return { items: await series(id) }; },
    async related({ itemId, url } = {}) {
      const id = EPISODE_RE.exec(typeof itemId === 'string' ? itemId : '')?.[1] || /^series:([1-9][0-9]{0,19})$/.exec(typeof itemId === 'string' ? itemId : '')?.[1] || parseSeriesId(url);
      return { items: htmlItems(await page('/')).filter(item => item.id !== `series:${id}`).slice(0, 12) };
    },
    getStream,
    trackOperation(operation) { return track(operation); },
    async download(item, { save }) {
      active();
      const result = await getStream(item?.id);
      if (result.statusCode !== 200) { result.stream.destroy(); throw new Error('媒体下载响应不完整'); }
      // 保存过程纳入生命周期，停止时先中断流，再等待临时文件和发布文件清理。
      const operation = (async () => {
        await save(item.fileName || `${item.title || item.id}.mp4`, result.stream);
        active();
      })();
      await track(operation);
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        controller.abort();
        for (const stream of streams) {
          // 防止尚未交给调用方的流在销毁时产生未处理错误。
          stream.on('error', () => {});
          stream.destroy(new Error('红果来源已停止'));
        }
        pages.clear();
        episodePages.clear();
      }
      while (pending.size) await Promise.allSettled([...pending]);
    },
    async list(dir = '/') {
      if (dir === '/') return htmlItems(await page('/')).map(item => ({ name: item.title, path: `/${item.id.slice(7)}`, type: 'folder' }));
      const id = new RegExp(`^/(${ID})$`).exec(dir)?.[1];
      return id ? (await series(id)).filter(item => item.playable !== false).map(item => ({ name: `${item.title}.mp4`, path: item.libraryPath, type: 'file', mediaType: 'video', size: 0 })) : [];
    },
    async getFile(filePath) {
      const match = FILE_RE.exec(typeof filePath === 'string' ? filePath : '');
      if (!match) throw new Error('红果视频路径无效');
      const { item } = await find(`episode:${match[1]}:${match[2]}`);
      return { name: `${item.title}.mp4`, path: filePath, type: 'file', mediaType: 'video', size: 0 };
    },
    async getFileStream(filePath, range) {
      const match = FILE_RE.exec(typeof filePath === 'string' ? filePath : '');
      if (!match) throw new Error('红果视频路径无效');
      return getStream(`episode:${match[1]}:${match[2]}`, range);
    }
  };
}
module.exports = { createHongguoProvider, parseSeriesId, parseSearchPayload, htmlItems, episodeItems, episodeLinks };
