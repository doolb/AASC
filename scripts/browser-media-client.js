#!/usr/bin/env node
'use strict';

// 服务端令牌只放在环境变量或调用参数中，不放进 URL 或命令行参数。
async function browserMediaCall({ server = 'http://127.0.0.1:8081', token = process.env.AASC_BROWSER_MEDIA_API_TOKEN, operation = 'status', options = {} } = {}) {
  const base = new URL(server);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) || base.username || base.password || base.search || base.hash) throw new Error('服务器地址必须使用 HTTPS，或使用本机 HTTP');
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) throw new Error('请设置 64 位小写十六进制 AASC_BROWSER_MEDIA_API_TOKEN');
  if (!['status', 'request', 'extract'].includes(operation)) throw new Error('操作必须是 status、request 或 extract');
  const endpoint = new URL(`${base.pathname.replace(/\/$/, '')}/api/browser-media/${operation}`, base.origin);
  const response = await fetch(endpoint, { method: operation === 'status' ? 'GET' : 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, ...(operation === 'status' ? {} : { 'Content-Type': 'application/json' }) }, ...(operation === 'status' ? {} : { body: JSON.stringify(options) }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message || '服务器请求失败'), { code: result.code, status: response.status });
  return result.result;
}

module.exports = { browserMediaCall };

if (require.main === module) {
  (async () => {
    const [operation = 'status', pageUrl, sourceId = 'script', server = 'http://127.0.0.1:8081'] = process.argv.slice(2);
    const result = await browserMediaCall({ server, operation, options: { sourceId, pageUrl } });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })().catch(error => { process.stderr.write(`${error.code || 'ERROR'}: ${error.message}\n`); process.exitCode = 1; });
}
