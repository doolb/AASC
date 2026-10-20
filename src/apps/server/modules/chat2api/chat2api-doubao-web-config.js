'use strict';

const DEFAULT_DOUBAO_WEB_CONFIG = Object.freeze({
  mode: 'browser-fetch', browserExecutable: 'vivaldi', debugPort: 9224, accountId: '',
});
const BROWSER_NAMES = new Set(['vivaldi', 'vivaldi-stable', 'chromium', 'chromium-browser',
  'google-chrome', 'google-chrome-stable', 'chrome', 'msedge', 'microsoft-edge']);

/** 配置由控制端发送、服务端保存并广播；只接受固定浏览器程序名或对应可执行文件路径。 */
const normalizeDoubaoWebConfig = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_DOUBAO_WEB_CONFIG, key))) {
    throw new Error('豆包网页配置字段无效');
  }
  const value = { ...DEFAULT_DOUBAO_WEB_CONFIG, ...input };
  if (!['browser-fetch', 'node-http'].includes(value.mode)) throw new Error('豆包 LLM 模式无效');
  if (!Number.isInteger(value.debugPort) || value.debugPort < 1024 || value.debugPort > 65535) {
    throw new Error('豆包浏览器调试端口无效');
  }
  if (typeof value.browserExecutable !== 'string' || value.browserExecutable.length > 512
    || /[\r\n\0]/u.test(value.browserExecutable)) throw new Error('浏览器路径无效');
  const executable = value.browserExecutable.trim();
  const basename = executable.split(/[\\/]/u).at(-1)?.replace(/\.exe$/iu, '').toLowerCase();
  if (!executable || !BROWSER_NAMES.has(basename)
    || (/[\\/]/u.test(executable) && !/^(?:\/|[a-zA-Z]:\\)/u.test(executable))) {
    throw new Error('只支持已知浏览器名称或绝对路径');
  }
  if (typeof value.accountId !== 'string' || value.accountId.length > 256
    || /[\r\n\0]/u.test(value.accountId)) throw new Error('豆包账号标识无效');
  return { mode: value.mode, browserExecutable: executable, debugPort: value.debugPort,
    accountId: value.accountId.trim() };
};

module.exports = { DEFAULT_DOUBAO_WEB_CONFIG, normalizeDoubaoWebConfig };
