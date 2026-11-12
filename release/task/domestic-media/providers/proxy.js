'use strict';

// 直连时也显式关闭 axios 环境代理；代理地址不写入日志或错误。
function options(proxyUrl) {
  if (!proxyUrl) return { proxy: false };
  let parsed;
  try { parsed = new URL(proxyUrl); } catch { throw new Error('代理地址格式无效'); }
  if (!['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash) {
    throw new Error('代理地址格式无效');
  }
  const Agent = parsed.protocol.startsWith('socks')
    ? require('socks-proxy-agent').SocksProxyAgent
    : require('https-proxy-agent').HttpsProxyAgent;
  const agent = new Agent(proxyUrl);
  return { proxy: false, httpAgent: agent, httpsAgent: agent };
}
module.exports = { options };
