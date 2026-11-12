'use strict';

const { get } = require('./http');

// 只允许站点分享链接，避免把任意地址交给下载器访问。
function link(value) {
  const match = String(value || '').match(/https:\/\/[^\s]+/);
  let url;
  try { url = new URL(match ? match[0] : value); } catch { throw new Error('请输入抖音分享链接'); }
  if (url.href.length > 1500 || url.protocol !== 'https:' || url.username || url.password || url.port || !['douyin.com', 'www.douyin.com', 'v.douyin.com', 'www.iesdouyin.com'].includes(url.hostname)) throw new Error('请输入抖音分享链接');
  return url.href;
}
function mediaUrl(value) {
  try {
    const url = new URL(value);
    const domains = ['douyinvod.com', 'bytecdn.cn', 'byteimg.com', 'ixigua.com', 'snssdk.com', 'douyin.com', 'byteoversea.com', 'volccdn.com'];
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  } catch { return false; }
}
function encode(value) { return Buffer.from(link(value)).toString('base64url'); }
function decode(id) {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(String(id))) throw new Error('抖音视频标识无效');
  return link(Buffer.from(id, 'base64url').toString());
}
function createDouyinProvider(config, { ytdlp, browserMedia, httpGet = get } = {}) {
  const abort = new AbortController();
  const streams = new Set();
  async function ensureBrowser() {
    if (!browserMedia?.ensure || !browserMedia?.douyinHome || !browserMedia?.douyinVideo) throw new Error('网页媒体服务不可用，请更新服务后重试');
    try { await browserMedia.ensure(); }
    catch { throw new Error('网页媒体任务启动失败，请检查任务状态'); }
  }
  async function resolve(url) {
    const original = link(url);
    const parsed = new URL(original);
    const videoId = /^\/video\/(\d{10,24})\/?$/.exec(parsed.pathname)?.[1];
    if (videoId && browserMedia) {
      await ensureBrowser();
      const media = await browserMedia.douyinVideo({ id: videoId, proxyUrl: config.proxyUrl || '' });
      if (!mediaUrl(media)) throw new Error('抖音网页未提供可播放地址');
      return { title: '抖音视频', url: media };
    }
    try {
      const result = await ytdlp.resolve(original);
      if (!mediaUrl(result.url)) throw new Error('媒体地址无效');
      return result;
    } catch { throw new Error('抖音视频解析失败，请检查链接、登录状态和网络'); }
  }
  async function getStream(id, range) {
    const result = await resolve(decode(id));
    let url = result.url;
    for (let i = 0; i <= 4; i++) {
      if (!mediaUrl(url)) throw new Error('抖音媒体地址无效');
      const rangeHeader = range ? (range.suffix ? `bytes=-${range.suffix}` : `bytes=${range.start}-${range.end ?? ''}`) : '';
      const response = await httpGet(config, url, { responseType: 'stream', signal: abort.signal, timeout: 30000, maxRedirects: 0, validateStatus: () => true, headers: { Referer: 'https://www.douyin.com/', ...(rangeHeader ? { Range: rangeHeader } : {}) } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        response.data?.destroy?.();
        if (!response.headers.location) throw new Error('抖音重定向无效');
        url = new URL(response.headers.location, url).href;
        continue;
      }
      if (![200, 206, 416].includes(response.status)) { response.data?.destroy?.(); throw new Error('抖音媒体流不可用'); }
      streams.add(response.data);
      response.data.once('close', () => streams.delete(response.data));
      return { stream: response.data, statusCode: response.status, headers: response.headers };
    }
    throw new Error('抖音重定向次数过多');
  }
  return {
    async home({ page = 1 } = {}) {
      if (Number(page) !== 1) return { items: [], page: 1, totalPages: 1 };
      await ensureBrowser();
      const cards = await browserMedia.douyinHome({ proxyUrl: config.proxyUrl || '' });
      const seen = new Set();
      const items = cards.filter(card => /^\d{10,24}$/.test(String(card.id)) && card.title && !seen.has(card.id) && seen.add(card.id)).map(card => {
        const url = `https://www.douyin.com/video/${card.id}`;
        let cover = '';
        try { const image = new URL(card.cover); if (image.protocol === 'https:' && !image.username && !image.password && (image.hostname.endsWith('.douyinpic.com') || image.hostname.endsWith('.byteimg.com'))) cover = image.href; } catch {}
        return { id: encode(url), title: String(card.title).slice(0, 200), url, cover, mediaType: 'video' };
      });
      if (!items.length) throw new Error('抖音网页尚未返回推荐，请查看运行页面并重试');
      return { items, page: 1, totalPages: 1 };
    },
    async resolveLink({ url }) {
      const original = link(url);
      const result = await resolve(original);
      return { items: [{ id: encode(original), title: result.title || '抖音视频', url: original, mediaType: 'video' }] };
    },
    getStream,
    async list(dirPath) { if (dirPath !== '/' && dirPath !== '') throw new Error('目录不存在'); return (await this.home()).items.map(item => ({ name: item.title, path: `/${item.id}`, type: 'file', mediaType: 'video' })); },
    async getFile(filePath) { const id = String(filePath).replace(/^\//, ''); const value = await resolve(decode(id)); return { name: value.title || '抖音视频', path: '/' + id, type: 'file', mediaType: 'video' }; },
    async getFileStream(filePath, range) { return getStream(String(filePath).replace(/^\//, ''), range); },
    async stop() { abort.abort(); for (const stream of streams) stream.destroy(); await ytdlp.stop(); }
  };
}
module.exports = { createDouyinProvider, link, mediaUrl };
