'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const ORIGIN = 'https://e-hentai.org';
const PAGE_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 80 * 1024 * 1024;
const GALLERY = /^\/g\/\d{1,10}\/[a-f0-9]{10}\/?$/;
const IMAGE_PAGE = /^\/s\/[a-f0-9]{10}\/\d{1,10}-\d{1,4}\/?$/;

function checkedUrl(value, pattern) {
  const parsed = new URL(String(value), ORIGIN);
  if (parsed.origin !== ORIGIN || parsed.username || parsed.password || !pattern.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('媒体链接无效');
  return parsed.href;
}
function pathOf(value) { return new URL(value).pathname; }
function galleryPath(value) { return `/gallery${pathOf(value)}`; }
function imagePath(value) { return `/image${pathOf(value)}`; }
function imageHost(host) { return host === 'ehgt.org' || /^(?:[a-z0-9-]+\.){1,3}hath\.network$/.test(host); }
function imageUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '9980' || url.port === '9999') && imageHost(url.hostname) ? url.href : '';
  } catch { return ''; }
}
function galleryUrl(input) {
  try { return checkedUrl(input, GALLERY); } catch { return ''; }
}
function galleryItems(html) {
  const $ = cheerio.load(html);
  return $('.glink').map((_, node) => {
    const url = galleryUrl($(node).closest('a').attr('href'));
    if (!url) return null;
    const title = $(node).text().trim().slice(0, 180) || '未命名画廊';
    const cover = imageUrl($(node).closest('tr').find('.glthumb img').first().attr('src'));
    return { id: galleryPath(url), title, mediaType: 'collection', url, ...(cover ? { cover } : {}) };
  }).get().slice(0, 25);
}
function proxyOptions(proxyUrl) {
  if (!proxyUrl) return { proxy: false };
  const parsed = new URL(proxyUrl);
  if (!['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash) throw new Error('代理地址格式无效');
  const Agent = parsed.protocol.startsWith('socks') ? SocksProxyAgent : HttpsProxyAgent;
  const agent = new Agent(proxyUrl);
  return { proxy: false, httpAgent: agent, httpsAgent: agent };
}

function createGalleryProvider(config, { request = axios.get } = {}) {
  const abort = new AbortController();
  const streams = new Set();
  const imagePages = new Map();
  let lastProxy = '';
  const check = () => { if (abort.signal.aborted) throw new Error('媒体来源已停止'); };
  function remember(id, page) {
    if (imagePages.size >= 250) imagePages.delete(imagePages.keys().next().value);
    imagePages.set(id, page);
  }
  async function fetchPage(url) {
    check();
    const proxy = config.proxyUrl || '';
    if (proxy !== lastProxy) { imagePages.clear(); lastProxy = proxy; }
    const response = await request(url, { ...proxyOptions(proxy), timeout: 15000, maxRedirects: 0, maxContentLength: PAGE_LIMIT, headers: { 'User-Agent': 'Mozilla/5.0' }, signal: abort.signal, responseType: 'text' });
    check();
    return String(response.data);
  }
  async function galleryPages(value) {
    const url = checkedUrl(value, GALLERY);
    const first = cheerio.load(await fetchPage(url));
    const count = Number(first('#gdd').text().match(/(\d+) pages/i)?.[1]);
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('画廊页数不可用');
    const items = [];
    for (let page = 0; page < Math.ceil(count / 20); page++) {
      check();
      const $ = page === 0 ? first : cheerio.load(await fetchPage(`${url}?p=${page}`));
      $('#gdt a[href]').each((_, element) => {
        try {
          const href = checkedUrl($(element).attr('href'), IMAGE_PAGE);
          const number = Number(pathOf(href).match(/-(\d{1,4})\/?$/)?.[1]);
          if (number < 1 || number > count) return;
          const id = imagePath(href);
          remember(id, href);
          items.push({ id, title: `${first('#gn').text().trim().slice(0, 150)} · ${number}`, mediaType: 'image', url: href });
        } catch { /* 忽略非图片链接 */ }
      });
    }
    if (items.length !== count || new Set(items.map(item => item.id)).size !== count) throw new Error('画廊图片列表不完整');
    return items;
  }
  async function stream(id) {
    check();
    const page = imagePages.get(id) || checkedUrl(String(id).replace(/^\/image/, ''), IMAGE_PAGE);
    const $ = cheerio.load(await fetchPage(page));
    const url = imageUrl($('#img').attr('src'));
    if (!url) throw new Error('图片地址不可用');
    const response = await request(url, { ...proxyOptions(config.proxyUrl), timeout: 30000, maxRedirects: 0, responseType: 'stream', signal: abort.signal, headers: { Referer: ORIGIN + '/', 'User-Agent': 'Mozilla/5.0' }, validateStatus: status => status === 200 });
    const length = Number(response.headers['content-length']);
    if (abort.signal.aborted || !/^image\/(?:jpeg|png|gif|webp|avif)$/i.test(String(response.headers['content-type'] || '').split(';')[0]) || (Number.isFinite(length) && length > IMAGE_LIMIT)) {
      response.data.destroy();
      throw new Error('图片响应无效');
    }
    let bytes = 0;
    response.data.on('data', chunk => { bytes += chunk.length; if (bytes > IMAGE_LIMIT) response.data.destroy(new Error('图片超过大小限制')); });
    streams.add(response.data);
    response.data.once('close', () => streams.delete(response.data));
    return { stream: response.data, statusCode: 200, headers: { 'content-type': response.headers['content-type'], ...(response.headers['content-length'] ? { 'content-length': response.headers['content-length'] } : {}) } };
  }
  return {
    async home() { return { items: galleryItems(await fetchPage(ORIGIN + '/')), page: 1, totalPages: 1 }; },
    async search({ keyword, page = 1 } = {}) {
      const query = String(keyword || '').trim();
      if (!query || query.length > 100 || Number(page) !== 1) throw new Error('搜索关键词或页码无效');
      return { items: galleryItems(await fetchPage(`${ORIGIN}/?f_search=${encodeURIComponent(query)}`)), page: 1, totalPages: 1 };
    },
    async resolveLink({ url } = {}) {
      const gallery = galleryUrl(url);
      if (!gallery) throw new Error('请输入画廊链接');
      return { items: await galleryPages(gallery) };
    },
    async list(dir) {
      if (dir === '/') return (await this.home()).items.map(item => ({ name: item.title, path: galleryPath(item.url), type: 'folder' }));
      const gallery = checkedUrl(String(dir).replace(/^\/gallery/, ''), GALLERY);
      return (await galleryPages(gallery)).map(item => ({ name: item.title, path: item.id, type: 'file', mediaType: 'image' }));
    },
    async getFile(path) {
      const page = checkedUrl(String(path).replace(/^\/image/, ''), IMAGE_PAGE);
      return { name: page.split('/').at(-1) + '.webp', path, type: 'file', mediaType: 'image' };
    },
    async getFileStream(path, range) { if (range) throw new Error('图片不支持 Range'); return stream(path); },
    async getStream(id, range) { if (range) throw new Error('图片不支持 Range'); return stream(id); },
    async getCover(id) {
      const gallery = checkedUrl(String(id).replace(/^\/gallery/, ''), GALLERY);
      const $ = cheerio.load(await fetchPage(gallery));
      const match = /url\((https:\/\/[^)]+)\)/.exec($('#gd1 div').first().attr('style') || '');
      const url = imageUrl(match?.[1]);
      if (!url) throw new Error('封面不可用');
      const response = await request(url, { ...proxyOptions(config.proxyUrl), timeout: 20000, maxRedirects: 0, responseType: 'stream', signal: abort.signal, validateStatus: status => status === 200 });
      const length = Number(response.headers['content-length']);
      if (!/^image\/(?:jpeg|png|gif|webp|avif)$/i.test(String(response.headers['content-type'] || '').split(';')[0]) || (Number.isFinite(length) && length > 5 * 1024 * 1024)) { response.data.destroy(); throw new Error('封面响应无效'); }
      streams.add(response.data);
      response.data.once('close', () => streams.delete(response.data));
      return { stream: response.data, statusCode: 200, headers: { 'content-type': response.headers['content-type'] } };
    },
    async download(item, { save }) {
      const result = await stream(item.id);
      const ext = result.headers['content-type'].split('/')[1].split(';')[0];
      await save(`${String(item.title || 'image').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').slice(0, 100)}.${ext}`, result.stream);
    },
    async stop() { abort.abort(); for (const item of streams) item.destroy(); imagePages.clear(); }
  };
}

module.exports = { createGalleryProvider, galleryItems, galleryUrl, imageUrl };
