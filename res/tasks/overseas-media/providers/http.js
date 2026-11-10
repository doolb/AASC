'use strict';
const axios = require('axios');
const { options } = require('./proxy');
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
};

function client(config = {}, defaults = {}) {
  const instance = axios.create({ timeout: 15000, maxRedirects: 0, headers: HEADERS, ...defaults, proxy: false });
  // 每次请求读取当前来源的命名代理，切换配置后无需重建来源。
  instance.interceptors.request.use(request => ({ ...request, ...options(config.proxyUrl) }));
  return instance;
}
async function get(config, url, extra = {}) {
  return client(config).get(url, extra);
}
module.exports = { client, get, HEADERS };
