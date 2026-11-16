'use strict';

// 本地示例：把网站提供的 JSON 媒体清单接入媒体库；其他网站可替换 list/解析逻辑。
const axios = require('axios');
const crypto = require('node:crypto');

function url(value) {
  const parsed = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('媒体地址必须是 HTTP(S) URL');
  return parsed.href;
}
function create(config) {
  const manifestUrl = url(config.url);
  async function files() {
    const response = await axios.get(manifestUrl, { timeout: 15000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024 });
    const items = Array.isArray(response.data) ? response.data : response.data?.items;
    if (!Array.isArray(items) || items.length > 1000) throw new Error('媒体清单应包含不超过 1000 项的 items 数组');
    return items.map(item => {
      const source = url(item.url);
      const name = String(item.name || '未命名媒体').slice(0, 200);
      const id = crypto.createHash('sha256').update(source).digest('hex').slice(0, 24);
      const mediaType = ['video', 'audio', 'image', 'gif', 'text'].includes(item.mediaType) ? item.mediaType : 'video';
      return { name, path: `/${id}`, type: 'file', mediaType, size: Number(item.size) > 0 ? Number(item.size) : 0, source };
    });
  }
  async function find(filePath) {
    const item = (await files()).find(entry => entry.path === filePath);
    if (!item) throw new Error('媒体文件不存在');
    return item;
  }
  return {
    async list(dir) { return dir === '/' ? (await files()).map(({ source, ...item }) => item) : []; },
    async getFile(filePath) { const { source, ...item } = await find(filePath); return item; },
    async getFileStream(filePath, range) {
      const item = await find(filePath);
      const headers = range ? { Range: `bytes=${range.start}-${range.end}` } : {};
      const response = await axios.get(item.source, { responseType: 'stream', timeout: 20000, maxRedirects: 0, headers });
      const outputHeaders = {};
      for (const [from, to] of [['content-type', 'Content-Type'], ['content-length', 'Content-Length'], ['content-range', 'Content-Range'], ['accept-ranges', 'Accept-Ranges']]) {
        if (response.headers[from]) outputHeaders[to] = response.headers[from];
      }
      return { stream: response.data, statusCode: response.status, headers: outputHeaders };
    }
  };
}
async function run(context) {
  const unregister = context.registerMediaProvider({ id: 'web-manifest', name: '网页 JSON 媒体清单', create });
  context.log('已注册网页 JSON 媒体源');
  return { stop: async () => unregister() };
}
module.exports = { mode: 'service', target: 'server', entryFile: 'task.js', run };
