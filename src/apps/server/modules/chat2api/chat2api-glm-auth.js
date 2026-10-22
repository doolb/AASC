const { createHash, randomUUID } = require('crypto');

/** 与官网认证函数同步：时间戳倒数第二位使用其余数字之和的个位数，三个头必须成组生成。 */
function createGlmSignature(now = Date.now(), nonce = randomUUID().replaceAll('-', '')) {
  const raw = String(now);
  if (!/^\d{3,}$/.test(raw)) throw new Error('GLM签名时间戳无效');
  const digits = [...raw].map(Number);
  const check = (digits.reduce((sum, digit) => sum + digit, 0) - digits.at(-2)) % 10;
  const timestamp = raw.slice(0, -2) + check + raw.slice(-1);
  const sign = createHash('md5').update(`${timestamp}-${nonce}-8a1317a7468aa3ad86e997d08f3f31cb`).digest('hex');
  return { 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Sign': sign };
}

/** 官网PC认证入口要求应用标识与平台版本；登录、刷新和发送统一组装，避免只签名却漏头。 */
function createGlmAuthHeaders() {
  return {
    'App-Name': 'chatglm', 'X-App-Platform': 'pc', 'X-App-Version': '0.0.1',
    'X-App-fr': 'default', 'X-Lang': 'zh-CN', 'X-Device-Model': '', 'X-Device-Brand': '',
    'X-Request-Id': randomUUID().replaceAll('-', ''), ...createGlmSignature(),
  };
}

module.exports = { createGlmSignature, createGlmAuthHeaders };
