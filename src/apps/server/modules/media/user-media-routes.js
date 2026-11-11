'use strict';
const crypto = require('node:crypto');

function registerUserMediaRoutes(app, { service, getToken }) {
  // 浏览器跨域采集只授予持有独立令牌的脚本，令牌不进入地址或日志。
  app.options('/api/user-media/capture', (req, res) => res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }).status(204).end());
  app.post('/api/user-media/capture', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const expected = String(getToken() || '');
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(403).json({ status: 'error', message: '采集凭据无效' });
    try { res.json({ status: 'success', ...await service.save(req.body) }); }
    catch { res.status(400).json({ status: 'error', message: '播放列表保存失败，请检查媒体链接和目录' }); }
  });
  app.post('/api/user-media/download', async (req, res) => {
    try { res.json({ status: 'success', ...await service.download(req.body?.id) }); }
    catch { res.status(400).json({ status: 'error', message: '下载失败：链接不可用、文件已存在或格式暂不支持' }); }
  });
}
module.exports = { registerUserMediaRoutes };
