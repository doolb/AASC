'use strict';

const { createGalleryProvider } = require('./gallery');

const SOURCES = [
  { id: 'iwara', name: 'Iwara', reason: '匿名入口返回 403，暂不可用' },
  { id: 'ehentai', name: 'E-Hentai', create: createGalleryProvider, features: ['home', 'search', 'resolveLink', 'stream', 'download'] },
  { id: 'asmr-one', name: 'ASMR.ONE', reason: '仅验证首页可达，媒体接口尚未验证' },
  { id: 'pornhub', name: 'Pornhub', reason: '仅验证首页可达，媒体接口尚未验证' },
  { id: 'spankbang', name: 'SpankBang', reason: '匿名入口返回 403，暂不可用' },
  { id: 'kanav', name: 'kanav.ad', reason: '仅验证首页可达，播放地址尚未验证' },
  { id: 'acgxmh', name: 'acgxmh.com', reason: '仅验证漫画页可达，图片流尚未验证' },
  { id: 'cosplaytele', name: 'cosplaytele.com', reason: '仅验证首页可达，媒体接口尚未验证' },
  { id: 'hanime1', name: 'hanime1.me', reason: '通过所选代理访问超时，暂不可用' },
  { id: 'taiav', name: 'taiav.com', reason: '仅验证详情可达，视频流尚未验证' }
];

function unavailable(reason) {
  return {
    async home() { throw new Error(reason); },
    async list() { throw new Error(reason); },
    async getFile() { throw new Error(reason); },
    async getFileStream() { throw new Error(reason); }
  };
}

async function run(context) {
  const unregisters = [];
  const providers = new Set();
  try {
    for (const source of SOURCES) {
      unregisters.push(context.registerMediaProvider({
        id: source.id, name: source.name, region: 'private',
        features: source.features || ['home'],
        create: config => {
          const provider = source.create ? source.create(config) : unavailable(`${source.name}：${source.reason}`);
          providers.add(provider);
          return provider;
        }
      }));
    }
  } catch (error) {
    for (const unregister of unregisters.reverse()) unregister();
    throw error;
  }
  context.log('已注册私密媒体来源；仅经匿名验证的能力可使用');
  return { stop: async () => {
    for (const unregister of unregisters.reverse()) unregister();
    await Promise.all([...providers].map(provider => provider.stop?.()));
    providers.clear();
  } };
}

module.exports = { mode: 'service', target: 'server', entryFile: 'task.js', run };
