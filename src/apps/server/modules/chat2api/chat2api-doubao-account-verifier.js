const axios = require('axios');
const { randomUUID } = require('node:crypto');
const { normalizeDoubaoCredentials, assertDoubaoProvider } = require('./chat2api-doubao-chat-adapter');

const MAX_RESPONSE_BYTES = 512 * 1024;
const TIMEOUT_MS = 15_000;
const ERROR_CODES = new Set(['credentials', 'auth', 'risk', 'redirect', 'http', 'business', 'anonymous', 'response', 'size', 'network', 'timeout', 'cancelled', 'busy']);

// 元数据只来自有限状态，不带上游错误消息、账号资料或会话内容。
const verificationAccountInfo = result => ({
  credentialVerification: result?.verified === true ? 'conversation-list' : 'format-only',
  credentialVerificationStatus: result?.verified === true ? 'verified' : 'failed',
  credentialVerificationCheckedAt: result.checkedAt,
  credentialVerificationError: result?.verified === true ? '' : ERROR_CODES.has(result?.errorCode) ? result.errorCode : 'response',
});

const parseResponse = response => {
  const status = Number(response?.status);
  if (status === 401) return 'auth';
  if (status === 403) return 'risk';
  if (status >= 300 && status < 400) return 'redirect';
  if (status !== 200) return 'http';
  const raw = typeof response.data === 'string' || Buffer.isBuffer(response.data)
    ? response.data : JSON.stringify(response.data ?? null);
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) return 'size';
  let data;
  try { data = JSON.parse(String(raw)); } catch { return 'response'; }
  if (!data || Array.isArray(data) || typeof data !== 'object') return 'response';
  if (['is_login', 'is_logged_in', 'authenticated'].some(key => data[key] === false) || data.is_anonymous === true) return 'anonymous';
  if (data.status_code !== undefined && data.status_code !== 0) return 'business';
  // 仅接受已定位的IM下行契约。官网结构变化时保守地保留未验证状态。
  if (data.status_code !== 0 || data.cmd !== 3200
    || !Array.isArray(data.downlink_body?.pull_recent_conv_chain_downlink_body?.cells)) return 'response';
  return '';
};

const createDoubaoAccountVerifier = ({ httpClient = axios, timeoutMs = TIMEOUT_MS, maxConcurrent = 4 } = {}) => {
  let active = 0;
  const verify = async (credentials, provider, { signal } = {}) => {
    const result = errorCode => ({ verified: !errorCode, method: 'conversation-list', checkedAt: new Date().toISOString(), ...(errorCode ? { errorCode } : {}) });
    let normalized;
    try { assertDoubaoProvider(provider); normalized = normalizeDoubaoCredentials(credentials); }
    catch { return result('credentials'); }
    if (signal?.aborted) return result('cancelled');
    if (active >= maxConcurrent) return result('busy');
    active++;
    const controller = new AbortController();
    let timer, onAbort;
    try {
      const cookies = Object.fromEntries(normalized.cookie.split(';').map(part => {
        const separator = part.indexOf('=');
        return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
      }));
      const profile = normalized.nodeProfile;
      const params = { aid: '497858', device_platform: 'web', doubao_device_platform: 'web', web_platform: 'browser' };
      if (profile) Object.assign(params, { device_id: profile.deviceId, web_id: profile.webId, tea_uuid: profile.webId, fp: profile.fp, pc_version: profile.pcVersion });
      if (cookies.msToken) params.msToken = cookies.msToken;
      const config = {
        method: 'POST', url: 'https://www.doubao.com/im/chain/recent_conv', params,
        headers: { Cookie: normalized.cookie, Origin: 'https://www.doubao.com', Referer: 'https://www.doubao.com/',
          'Content-Type': 'application/json; encoding=utf-8', Accept: 'application/json',
          'X-Flow-Csrf-Token': cookies.passport_csrf_token || cookies.passport_csrf_token_default,
          ...(profile ? { 'User-Agent': profile.userAgent } : {}),
        },
        data: { cmd: 3200, sequence_id: randomUUID(), channel: 2, version: '1',
          uplink_body: { pull_recent_conv_chain_uplink_body: { api_version: 1, conv_version: 0, direction: 3,
            limit: 1, message_count_per_conv: 0,
            option: { not_need_message: true, need_complete_conversation: true, need_coco_conversation: true, need_coco_bot: true },
          } },
        },
        timeout: Math.min(TIMEOUT_MS, Math.max(1, timeoutMs)), signal: controller.signal,
        maxRedirects: 0, maxContentLength: MAX_RESPONSE_BYTES, maxBodyLength: 32 * 1024,
        responseType: 'text', transformResponse: [value => value], validateStatus: () => true,
      };
      const stop = new Promise(resolve => {
        const finish = code => { resolve(result(code)); controller.abort(); };
        timer = setTimeout(() => finish('timeout'), config.timeout);
        onAbort = () => finish('cancelled');
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      const request = Promise.resolve().then(() => {
        if (controller.signal.aborted) return result('cancelled');
        return httpClient.request(config).then(response => result(parseResponse(response)));
      }).catch(error => result(error?.code === 'ERR_BAD_RESPONSE' ? 'size' : 'network'));
      return await Promise.race([request, stop]);
    } catch { return result('response'); }
    finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      controller.abort();
      active--;
    }
  };
  return { verify };
};

module.exports = { createDoubaoAccountVerifier, verificationAccountInfo, ERROR_CODES };
