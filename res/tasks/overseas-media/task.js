'use strict';

const FEATURES = ['home', 'search', 'resolveLink', 'related', 'stream', 'download'];

async function run(context) {
  // 延迟加载确保模块加载失败不会留下部分注册。
  const { createYoutubeProvider } = require('./providers/youtube');
  const { createPinterestProvider } = require('./providers/pinterest');
  const { createPixivProvider } = require('./providers/pixiv');
  const { createYtdlp } = require('./providers/ytdlp');
  const params = context.params || {};
  const unregisters = [];
  const resources = [];
  const definitions = [
    { id: 'youtube', name: 'YouTube', create: config => {
      const ytdlp = createYtdlp({ binary: params.ytdlpBinary || '', dataDir: params.ytdlpDataDir || context.workDir, proxyUrl: () => config.proxyUrl || '', cookie: params.youtubeCookie || '', log: context.log });
      resources.push(ytdlp);
      const provider = createYoutubeProvider(config, { ytdlp, cookie: params.youtubeCookie || '' });
      resources.push(provider);
      return provider;
    } },
    { id: 'pinterest', name: 'Pinterest', create: config => { const provider = createPinterestProvider(config, { cookie: params.pinterestCookie || '' }); resources.push(provider); return provider; } },
    { id: 'pixiv', name: 'Pixiv', create: config => { const provider = createPixivProvider(config, { cookie: params.pixivCookie || '' }); resources.push(provider); return provider; } }
  ];
  try {
    for (const definition of definitions) {
      unregisters.push(context.registerMediaProvider({ ...definition, region: 'overseas', features: FEATURES, proxyDefault: true }));
    }
    context.log('已注册国外媒体源：YouTube、Pinterest、Pixiv');
  } catch (error) {
    // 只撤销本次持有的注册，保留其他任务的同名来源。
    for (const remove of unregisters.reverse()) { try { remove(); } catch {} }
    if (String(error?.message || '').includes('已注册')) throw new Error('国外媒体源已被其他任务注册，请先停止占用来源的旧任务后重试');
    throw new Error('国外媒体源启动失败，请检查任务参数及运行环境后重试');
  }
  let unregistered = false;
  let stopping;
  let stopped = false;
  return { stop: async () => {
    if (stopped) return;
    if (!unregistered) {
      unregistered = true;
      for (const remove of unregisters.reverse()) { try { remove(); } catch {} }
    }
    if (!stopping) stopping = (async () => {
      // 独立清理每个已创建资源，失败时保留以便下次重试。
      let failed = false;
      await Promise.all([...resources].map(async resource => {
        try {
          if (typeof resource?.stop === 'function') await resource.stop();
          resources.splice(resources.indexOf(resource), 1);
        } catch { failed = true; }
      }));
      if (failed) throw new Error('资源清理失败');
    })();
    try { await stopping; stopped = true; }
    catch { throw new Error('国外媒体源停止失败，请重试'); }
    finally { stopping = undefined; }
  } };
}
module.exports = { mode: 'service', target: 'server', entryFile: 'task.js', run };
