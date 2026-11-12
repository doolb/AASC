'use strict';
const axios = require('axios');
const { options } = require('./proxy');
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' };

function client(config = {}, defaults = {}) {
  const instance = axios.create({ timeout: 15000, maxRedirects: 0, headers: HEADERS, ...defaults, proxy: false });
  // 每次请求都读取 getter，切换来源代理不必重建 provider。
  instance.interceptors.request.use(request => ({ ...request, ...options(config.proxyUrl) }));
  return instance;
}
async function get(config, url, extra = {}) {
  return client(config).get(url, extra);
}
module.exports = { client, get, HEADERS };
