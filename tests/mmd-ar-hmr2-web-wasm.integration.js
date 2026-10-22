// 显式命令才加载完整CPU模型，复用同一真实浏览器验收契约。
process.env.HMR_WEB_TEST_BACKEND = 'wasm';
require('./mmd-ar-hmr2-web.integration.js');
