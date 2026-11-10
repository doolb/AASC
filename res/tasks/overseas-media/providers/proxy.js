'use strict';

// 代理凭据不写入错误信息；直连时也禁止 axios 使用环境代理。
function options(proxyUrl) {
  if (!proxyUrl) return { proxy: false };
  let parsed;
  try { parsed = new URL(proxyUrl); } catch { throw new Error('代理地址格式无效'); }
  if (!['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash) {
    throw new Error('代理地址格式无效');
  }
  try {
    const Agent = parsed.protocol.startsWith('socks')
      ? require('socks-proxy-agent').SocksProxyAgent
      : require('https-proxy-agent').HttpsProxyAgent;
    const agent = new Agent(proxyUrl);
    return { proxy: false, httpAgent: agent, httpsAgent: agent };
  } catch { throw new Error('代理地址格式无效'); }
}
module.exports = { options };
