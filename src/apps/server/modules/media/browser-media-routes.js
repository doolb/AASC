'use strict';

const crypto = require('node:crypto');

function registerBrowserMediaRoutes(app, { service, getToken }) {
  const errors = {
    BROWSER_MEDIA_DISABLED: [503, '浏览器媒体任务未启动'],
    BROWSER_MEDIA_CHALLENGE: [409, '网站需要验证，请在专用浏览器中完成后重试'],
    BROWSER_MEDIA_BLOCKED: [403, '网站请求被拒绝或需要验证'],
    BROWSER_MEDIA_ORIGIN: [403, '网站不在允许列表中或页面跳转到未授权网站'],
    BROWSER_MEDIA_UPSTREAM: [502, '网站请求失败']
  };
  // 使用独立凭据保护浏览器登录态，未配置时接口默认不可用。
  const authorize = (req, res, next) => {
    const expected = String(getToken() || '');
    const supplied = String(req.get('authorization') || '').match(/^Bearer ([a-f0-9]{64})$/i)?.[1] || '';
    if (!/^[a-f0-9]{64}$/.test(expected)) return res.status(503).json({ status: 'error', code: 'BROWSER_MEDIA_API_DISABLED', message: '浏览器接口未配置令牌' });
    if (!/^[a-f0-9]{64}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(403).json({ status: 'error', code: 'BROWSER_MEDIA_UNAUTHORIZED', message: '浏览器接口凭据无效' });
    res.set('Cache-Control', 'no-store');
    return next();
  };
  const run = operation => async (req, res) => {
    try {
      const body = req.body;
      if (operation !== 'status' && (!body || typeof body !== 'object' || Array.isArray(body))) return res.status(400).json({ status: 'error', code: 'BROWSER_MEDIA_INVALID', message: '请求参数无效' });
      const options = operation === 'status' ? undefined : Object.fromEntries(['sourceId', 'pageUrl', 'url', 'proxyUrl', 'responseType', 'range'].filter(key => body[key] !== undefined).map(key => [key, body[key]]));
      const result = await service[operation](options);
      const value = Buffer.isBuffer(result?.body) ? { ...result, body: result.body.toString('base64'), encoding: 'base64' } : result;
      return res.json({ status: 'success', result: value });
    } catch (error) {
      const known = errors[error.code];
      const [statusCode, message] = known || [400, '浏览器请求失败，请检查参数和任务状态'];
      return res.status(statusCode).json({ status: 'error', code: known ? error.code : 'BROWSER_MEDIA_ERROR', message });
    }
  };
  app.get('/api/browser-media/status', authorize, run('status'));
  app.post('/api/browser-media/request', authorize, run('request'));
  app.post('/api/browser-media/extract', authorize, run('extract'));
}

module.exports = { registerBrowserMediaRoutes };
