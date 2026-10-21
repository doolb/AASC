'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MAX_ENTRIES = 128;
const MAX_BYTES = 4 * 1024 * 1024;
const queues = new Map();
const allowedHeaders = new Set(['accept', 'content-type', 'agw-js-conv', 'user-agent', 'origin', 'referer',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'x-tt-passport-csrf-token', 'x-flow-trace', 'last-event-id']);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n]/u.test(value);

/** 私有缓存仍严格限制固定官网和非Cookie头，损坏/被替换的文件不能改变消息的发送目标。 */
const validEntry = entry => {
  try {
    if (!entry || Object.keys(entry).some(key => !['key', 'fingerprint', 'mode', 'upstreamId', 'url', 'headers'].includes(key))) return false;
    const identity = JSON.parse(entry.key);
    if (!Array.isArray(identity) || identity.length !== 2 || !identity.every(validId)
      || !/^[a-f0-9]{64}$/u.test(entry.fingerprint) || entry.mode !== 0
      || !/^[A-Za-z0-9_-]{1,128}$/u.test(entry.upstreamId) || entry.upstreamId === '0'
      || typeof entry.url !== 'string' || entry.url.length > 16384) return false;
    const url = new URL(entry.url);
    if (url.origin !== 'https://www.doubao.com' || url.pathname !== '/chat/completion'
      || url.username || url.password || url.hash || !url.searchParams.get('a_bogus')) return false;
    if (!entry.headers || Array.isArray(entry.headers) || typeof entry.headers !== 'object') return false;
    const headers = Object.entries(entry.headers), names = headers.map(([key]) => key.toLowerCase());
    if (headers.length > allowedHeaders.size || new Set(names).size !== names.length
      || JSON.stringify(entry.headers).length > 16384) return false;
    return headers.every(([name, value]) => allowedHeaders.has(name.toLowerCase())
      && typeof value === 'string' && value.length <= 4096 && !/[^\x20-\x7E]/u.test(value))
      && headers.some(([name, value]) => name.toLowerCase() === 'origin' && value === 'https://www.doubao.com');
  } catch { return false; }
};

const createDoubaoSignatureStore = ({ rootDir }) => {
  const file = path.join(path.resolve(rootDir), 'doubao-signatures.json');
  const read = async () => {
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) return [];
      const raw = await handle.readFile('utf8');
      if (Buffer.byteLength(raw) > MAX_BYTES) return [];
      const value = JSON.parse(raw);
      if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) return [];
      return value.entries.filter(validEntry);
    } catch { return []; }
    finally { await handle?.close().catch(() => {}); }
  };
  const write = async entries => {
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const retained = entries.slice(-MAX_ENTRIES);
      let raw = JSON.stringify({ version: 1, entries: retained });
      while (Buffer.byteLength(raw) > MAX_BYTES && retained.length) {
        retained.shift(); raw = JSON.stringify({ version: 1, entries: retained });
      }
      await fs.writeFile(temporary, raw, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, file);
      return true;
    } catch { return false; }
    finally { await fs.unlink(temporary).catch(() => {}); }
  };
  // 多个runtime可以指向同一用户目录，串行读改写，空闲后释放队列键。
  const locked = async action => {
    const previous = queues.get(file) || Promise.resolve();
    const pending = previous.catch(() => {}).then(action);
    queues.set(file, pending);
    try { return await pending; }
    finally { if (queues.get(file) === pending) queues.delete(file); }
  };
  return {
    get: key => locked(async () => (await read()).find(entry => entry.key === key) || null),
    getLatest: ({ accountId, fingerprint, mode }) => locked(async () => (await read()).reverse().find(entry =>
      JSON.parse(entry.key)[0] === accountId && entry.fingerprint === fingerprint && entry.mode === mode) || null),
    put: (key, entry) => locked(async () => {
      const record = { ...entry, key };
      if (!validEntry(record)) return false;
      const [accountId, scope] = JSON.parse(key);
      // 账号规范键成功提交后归并该账号/模式旧条目，保留其它账号和其它模式。
      const entries = (await read()).filter(item => item.key !== key
        && !(scope === `mode:${record.mode}` && JSON.parse(item.key)[0] === accountId && item.mode === record.mode));
      return write([...entries, record]);
    }),
    delete: (key, expected) => locked(async () => {
      const entries = await read();
      const [accountId, scope] = JSON.parse(key);
      const retained = entries.filter(entry => {
        // 失效时清除同一签名的所有旧会话别名；迟到删除不得碰后来更新的新URL。
        if (expected && scope === `mode:${expected.mode}`) return JSON.parse(entry.key)[0] !== accountId
          || ['fingerprint', 'mode', 'url'].some(field => entry[field] !== expected[field]);
        return entry.key !== key || (expected
          && ['fingerprint', 'mode', 'upstreamId', 'url'].some(field => entry[field] !== expected[field]));
      });
      return retained.length === entries.length || write(retained);
    }),
  };
};

module.exports = { createDoubaoSignatureStore, MAX_ENTRIES, MAX_BYTES };
