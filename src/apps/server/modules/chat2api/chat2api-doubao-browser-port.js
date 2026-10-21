'use strict';

const path = require('node:path');
const { createDoubaoBrowserBridge, browserError } = require('./chat2api-doubao-browser-bridge');
const { createDoubaoAndroidBridge } = require('./chat2api-doubao-android-bridge');
const { normalizeDoubaoWebConfig } = require('./chat2api-doubao-web-config');
const ports = new Map();

/** 同一账号目录只拥有一个平台桥，任务与主代理通过租约复用，最后释放时才关闭。 */
const acquireDoubaoBrowserPort = ({ rootDir, config, factory,
  android = process.env.AASC_ANDROID_NODE === '1' } = {}) => {
  const key = `${android ? 'android' : 'desktop'}:${path.resolve(rootDir)}`;
  let entry = ports.get(key);
  const nextConfig = normalizeDoubaoWebConfig(config || {});
  if (entry && config && JSON.stringify(entry.config) !== JSON.stringify(nextConfig)) {
    if (entry.bridge?.isBusy?.()) throw browserError('busy');
    entry.config = nextConfig;
  }
  if (!entry) {
    entry = { config: nextConfig, bridge: null, references: 0, closing: null };
    ports.set(key, entry);
  }
  entry.references += 1;
  const requiredAccount = config?.accountId || '';
  let released = false;
  const getBridge = async () => {
    if (released) throw browserError('disabled');
    if (entry.closing) await entry.closing;
    if (released) throw browserError('disabled');
    entry.bridge ||= factory ? factory(() => entry.config) : android
      ? createDoubaoAndroidBridge()
      : createDoubaoBrowserBridge({ rootDir, getConfig: () => ({ ...entry.config, accountId: '' }) });
    return entry.bridge;
  };
  const invoke = async (method, options) => {
    const bridge = await getBridge();
    if (requiredAccount && requiredAccount !== options.account?.accountId) throw browserError('account');
    return bridge[method](options);
  };
  return {
    request: options => invoke('request', options),
    prepare: options => invoke('prepare', options),
    stop: async () => {
      if (released) return;
      released = true;
      entry.references -= 1;
      if (entry.references) return;
      const bridge = entry.bridge;
      entry.bridge = null;
      entry.closing = Promise.resolve().then(() => bridge?.stop());
      try { await entry.closing; }
      finally {
        entry.closing = null;
        if (!entry.references && ports.get(key) === entry) ports.delete(key);
      }
    },
  };
};

module.exports = { acquireDoubaoBrowserPort };
