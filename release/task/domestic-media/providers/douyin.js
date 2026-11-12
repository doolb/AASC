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
function createDouyinProvider(config, { ytdlp, httpGet = get } = {}) {
  const abort = new AbortController();
  const streams = new Set();
  async function resolve(url) {
    try {
      const result = await ytdlp.resolve(link(url));
      if (!mediaUrl(result.url)) throw new Error('媒体地址无效');
      return result;
    } catch { throw new Error('抖音视频解析失败，请检查链接、登录状态和网络'); }
  }
  async function getStream(id, range) {
    const result = await resolve(decode(id));
    let url = result.url;
    for (let i = 0; i <= 4; i++) {
      if (!mediaUrl(url)) throw new Error('抖音媒体地址无效');
      const response = await httpGet(config, url, { responseType: 'stream', signal: abort.signal, timeout: 30000, maxRedirects: 0, validateStatus: () => true, headers: { Referer: 'https://www.douyin.com/', ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}) } });
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
    async resolveLink({ url }) {
      const original = link(url);
      const result = await resolve(original);
      return { items: [{ id: encode(original), title: result.title || '抖音视频', url: original, mediaType: 'video' }] };
    },
    getStream,
    async list() { return []; },
    async getFile(filePath) { const id = String(filePath).replace(/^\//, ''); const value = await resolve(decode(id)); return { name: value.title || '抖音视频', path: '/' + id, type: 'file', mediaType: 'video' }; },
    async getFileStream(filePath, range) { return getStream(String(filePath).replace(/^\//, ''), range); },
    async stop() { abort.abort(); for (const stream of streams) stream.destroy(); await ytdlp.stop(); }
  };
}
module.exports = { createDouyinProvider, link, mediaUrl };
