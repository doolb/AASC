'use strict';

let active = null;

// 同一服务进程只允许一个桌面浏览器任务，避免来源请求落到错误实例。
function activateBrowserMedia(service) {
  if (active) throw new Error('浏览器媒体任务已经运行');
  active = service;
  return () => { if (active === service) active = null; };
}
function requireActive() {
  if (!active) throw Object.assign(new Error('浏览器媒体任务未启动'), { code: 'BROWSER_MEDIA_DISABLED' });
  return active;
}
const browserMedia = {
  request: options => requireActive().request(options),
  extract: options => requireActive().extract(options),
  status: () => active ? active.status() : { running: false, sessions: [] }
};
module.exports = { activateBrowserMedia, browserMedia };
