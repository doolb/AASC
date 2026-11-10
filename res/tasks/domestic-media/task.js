'use strict';

const FEATURES = ['home', 'search', 'resolveLink', 'related', 'stream', 'download'];

async function run(context) {
  // 延迟加载 provider，保证任务注册和进程生命周期由一次启动统一管理。
  const { createHongguoProvider } = require('./providers/hongguo');
  const { createTomatoProvider } = require('./providers/tomato');
  const params = context.params || {};
  const unregister = [];
  let tomato;
  const hongguoInstances = new Set();
  try {
    unregister.push(context.registerMediaProvider({
      id: 'hongguo', name: '红果短剧', region: 'domestic', features: FEATURES,
      proxyDefault: false,
      create: config => {
        const provider = createHongguoProvider(config, { cookie: params.hongguoCookie || '' });
        hongguoInstances.add(provider);
        return provider;
      }
    }));
    tomato = createTomatoProvider({
      binary: params.tomatoBinary || '/mnt/novel/TomatoNovelDownloader-Linux_amd64-v2.4.13',
      port: Number(params.tomatoPort) || 18423,
      dataDir: params.tomatoDataDir || '', saveDir: params.tomatoSaveDir || '',
      password: params.tomatoPassword || '', workDir: context.workDir, log: context.log
    });
    unregister.push(context.registerMediaProvider({
      id: 'tomato', name: '番茄小说', region: 'domestic', features: FEATURES,
      proxyDefault: false, create: config => tomato.create(config)
    }));
    context.log('已注册国内媒体源：红果短剧、番茄小说');
  } catch (error) {
    // 只撤销本次启动持有的注册，绝不移除旧任务的同名来源。
    for (const remove of unregister.reverse()) { try { remove(); } catch {} }
    await Promise.allSettled([...hongguoInstances].map(provider => provider.stop?.()));
    if (tomato) { try { await tomato.stop(); } catch {} }
    if (String(error?.message || '').includes('已注册')) {
      throw new Error('国内媒体源已被其他任务注册，请先停止占用红果或番茄来源的旧任务后重试');
    }
    // 不将底层错误、参数或代理凭据带入任务日志。
    throw new Error('国内媒体源启动失败，请检查任务参数及运行环境后重试');
  }
  let unregistered = false;
  let stopped = false;
  let stopping;
  let tomatoStopped = false;
  return { stop: async () => {
    if (stopped) return;
    if (!unregistered) {
      unregistered = true;
      for (const remove of unregister.reverse()) { try { remove(); } catch {} }
    }
    if (!stopping) {
      // 所有资源都要尝试清理；仅保留失败项以便后续重试。
      stopping = (async () => {
        const operations = [...hongguoInstances].map(async provider => {
          await provider.stop?.();
          hongguoInstances.delete(provider);
        });
        if (!tomatoStopped) operations.push((async () => { await tomato.stop(); tomatoStopped = true; })());
        const results = await Promise.allSettled(operations);
        if (results.some(result => result.status === 'rejected')) throw new Error('国内媒体源停止失败，请重试');
      })();
    }
    try { await stopping; stopped = true; }
    finally { stopping = undefined; }
  } };
}

module.exports = { mode: 'service', target: 'server', entryFile: 'task.js', run };
