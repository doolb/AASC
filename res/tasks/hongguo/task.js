'use strict';

// 只读取红果公开页面中明确公布的媒体，不猜测隐藏剧集地址。
const axios = require('axios');
const cheerio = require('cheerio');
const ORIGIN = 'https://hongguoduanju.com';
const ID = '[1-9][0-9]{0,19}';
const headers = { 'User-Agent': 'Mozilla/5.0', Referer: `${ORIGIN}/` };

function create(config) {
  const requested = new URL(config.url || ORIGIN);
  if (requested.origin !== ORIGIN || requested.username || requested.password) throw new Error('红果媒体源地址必须是 https://hongguoduanju.com');
  const selected = requested.pathname.match(new RegExp(`^/player/(${ID})(?:/(${ID}))?/?$`))?.[1] || (requested.pathname === '/detail' && new RegExp(`^${ID}$`).test(requested.searchParams.get('series_id') || '') ? requested.searchParams.get('series_id') : null);
  if (!selected && requested.pathname !== '/') throw new Error('请输入红果首页或剧集链接');
  const pages = new Map();
  async function page(path) {
    const cached = pages.get(path);
    if (cached && cached.until > Date.now()) return cached.html;
    const response = await axios.get(ORIGIN + path, { headers, timeout: 15000, maxRedirects: 0, maxContentLength: 3 * 1024 * 1024, responseType: 'text' });
    pages.set(path, { html: response.data, until: Date.now() + 60000 });
    return response.data;
  }
  async function series(id) {
    const $ = cheerio.load(await page(`/player/${id}`));
    const item = [];
    $('script[type="application/ld+json"]').each((_i, el) => {
      try {
        const data = JSON.parse($(el).html());
        const entries = data['@graph'] || [data];
        for (const entry of entries) {
          const url = String(entry.contentUrl || '');
          const match = new RegExp(`^${ORIGIN}/video/public/(${ID})/360p\\.mp4$`).exec(url);
          if (entry['@type'] === 'VideoObject' && match) item.push({ name: String(entry.name || '公开片段').slice(0, 180) + '（网站公开视频）.mp4', path: `/${id}/${match[1]}.mp4`, type: 'file', mediaType: 'video', size: 0 });
        }
      } catch { /* 忽略与视频无关的结构化数据。 */ }
    });
    return item;
  }
  async function root() {
    if (selected) return [{ name: '选择的红果剧集', path: `/${selected}`, type: 'folder' }];
    const $ = cheerio.load(await page('/'));
    const found = new Map();
    $('a[href^="/detail?series_id="]').each((_i, el) => {
      const id = /^\/detail\?series_id=([1-9][0-9]{0,19})$/.exec($(el).attr('href') || '')?.[1];
      if (id && !found.has(id)) found.set(id, { name: $(el).find('img').first().attr('alt') || $(el).text().trim().slice(0, 100) || '红果剧集', path: `/${id}`, type: 'folder' });
    });
    return [...found.values()];
  }
  async function find(filePath) {
    const match = new RegExp(`^/(${ID})/(${ID})\\.mp4$`).exec(filePath);
    if (!match) throw new Error('红果视频路径无效');
    const item = (await series(match[1])).find(entry => entry.path === filePath);
    if (!item) throw new Error('网站未公开该视频地址');
    return { item, vid: match[2] };
  }
  return {
    async list(dir) {
      if (dir === '/') return root();
      const match = new RegExp(`^/(${ID})$`).exec(dir);
      return match ? series(match[1]) : [];
    },
    async getFile(filePath) { return (await find(filePath)).item; },
    async getFileStream(filePath, range) {
      const { vid } = await find(filePath);
      const response = await axios.get(`${ORIGIN}/video/public/${vid}/360p.mp4`, { headers: { ...headers, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }, responseType: 'stream', timeout: 20000, maxRedirects: 0, validateStatus: status => [200, 206, 416].includes(status) });
      const output = {};
      for (const [key, name] of [['content-type', 'Content-Type'], ['content-length', 'Content-Length'], ['content-range', 'Content-Range'], ['accept-ranges', 'Accept-Ranges']]) if (response.headers[key]) output[name] = response.headers[key];
      return { stream: response.data, statusCode: response.status, headers: output };
    }
  };
}
async function run(context) {
  const unregister = context.registerMediaProvider({ id: 'hongguo', name: '红果短剧（网页公开视频）', create });
  context.log('已注册红果短剧媒体源；可用内容由红果网页决定');
  return { stop: async () => unregister() };
}
module.exports = { mode: 'service', target: 'server', entryFile: 'task.js', run };
