'use strict';

const crypto = require('node:crypto');

// 仅向 Android 同应用独立进程的受令牌保护端点发送内部浏览器操作。
function createAndroidBrowserAdapter({ port, token, fetchImpl = fetch, readyTimeoutMs = 10000, readyRetryMs = 200 }) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535 || typeof token !== 'string' || token.length < 32) {
    throw new Error('Android 网页媒体服务不可用，请更新 APK 并重启');
  }
  async function call(operation, params = {}, timeoutMs = 45000) {
    const response = await fetchImpl(`http://127.0.0.1:${Number(port)}/command`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ operation, ...params }), signal: AbortSignal.timeout(timeoutMs)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) { const error = new Error(result.error || 'Android 网页媒体请求失败'); error.httpStatus = response.status || 400; throw error; }
    return result.value;
  }
  // 仅首次使用以幂等的旧页面清理等待独立进程，网络错误可以重试，业务和鉴权失败立即返回。
  async function waitUntilReady() {
    const deadline = Date.now() + readyTimeoutMs;
    while (true) {
      try { await call('reset', { id: '0'.repeat(32) }, Math.max(1, Math.min(1000, deadline - Date.now()))); return; }
      catch (error) {
        if (error.httpStatus || Date.now() >= deadline) {
          if (error.httpStatus) throw error;
          throw new Error('Android 网页媒体服务未就绪，请稍后重试');
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(readyRetryMs, Math.max(0, deadline - Date.now()))));
      }
    }
  }
  let resetPromise;
  async function launch() {
    // Node 异常退出后服务进程可能仍存活，首次使用时释放旧进程遗留的页面。
    if (!resetPromise) resetPromise = waitUntilReady().catch(error => { resetPromise = null; throw error; });
    await resetPromise;
    const id = crypto.randomBytes(16).toString('hex');
    try { await call('create', { id }); }
    catch (error) {
      // 创建响应丢失时页面可能已存在，尽力释放该次会话。
      await call('close', { id }).catch(() => {});
      throw error;
    }
    let currentUrl = 'about:blank';
    let closed = false;
    const page = {
      url: () => currentUrl,
      isClosed: () => closed,
      mainFrame: () => page,
      setRequestInterception: async () => {},
      on: () => {},
      async goto(url) { const status = await call('navigate', { id, url }); currentUrl = url; return { status: () => Number(status) }; },
      async evaluate(fn, argument) { return call('evaluate', { id, script: `(${fn.toString()})(${JSON.stringify(argument) ?? 'undefined'})` }); },
      bringToFront: async () => { await call('select', { id }); }
    };
    return { pages: async () => [page], on: () => {}, close: async () => { if (!closed) { closed = true; await call('close', { id }); } } };
  }
  return { launch, resolveBrowser: async () => 'android-webview' };
}
module.exports = { createAndroidBrowserAdapter };
