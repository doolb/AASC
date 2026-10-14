const { createHash } = require('crypto');

const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value) && value !== '0';
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const safeAccountId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
const isDoubaoSession = state => isRecord(state) && state.version === 1 && state.transport === 'node-http';
const isValidDoubaoSession = state => isDoubaoSession(state) && safeId(state.conversationId)
  && safeAccountId(state.accountId) && state.mode === 0 && /^[a-f0-9]{64}$/u.test(state.identityFingerprint || '')
  && ['ready','uncertain'].includes(state.status);
const isReadyDoubaoSession = state => isValidDoubaoSession(state) && state.status === 'ready';
const sessionError = (code = 'doubao_session_conflict') => Object.assign(new Error({
  doubao_session_conflict: '豆包会话的账号、登录身份或模式不匹配，请新建会话',
  doubao_session_uncertain: '豆包上游会话位置已不确定，请新建会话',
  doubao_protocol_error: '豆包网页返回了无法安全解析的响应',
}[code]), { code, statusCode: code === 'doubao_protocol_error' ? 502 : 409 });

/** 私有存储只保存身份摘要；Cookie、动态令牌、CSRF及设备原值都不写入nativeState。 */
const getDoubaoIdentity = (account) => {
  const credentials = account?.credentials;
  const profile = credentials?.nodeProfile;
  if (!profile || typeof credentials.cookie !== 'string') throw sessionError();
  const cookieMap = new Map(credentials.cookie.split(';').map(part => {
    const index = part.indexOf('='); return [part.slice(0,index).trim(),part.slice(index+1).trim()];
  }));
  const sessionId = cookieMap.get('sessionid');
  if (!sessionId) throw sessionError();
  return createHash('sha256').update(JSON.stringify([account.accountId,sessionId,profile.deviceId,profile.webId,profile.fp])).digest('hex');
};

/**
 * 旧observed字段只用于历史观测。经过两轮验证的普通Node模式才建立版本化状态。
 * 续接在发送前核对身份，ACK只进入临时状态，完成时才提交。
 */
const createDoubaoSessionFlow = ({ account, mode, state = {}, nodeMode = Boolean(account?.credentials?.nodeProfile) }) => {
  const saved = isDoubaoSession(state);
  if (isRecord(state) && state.transport === 'node-http' && !saved) throw sessionError();
  if (saved && (!isValidDoubaoSession(state) || !nodeMode || mode !== 0)) throw sessionError();
  if (saved && state.status === 'uncertain') throw sessionError('doubao_session_uncertain');
  const enabled = nodeMode && mode === 0;
  const identityFingerprint = enabled ? getDoubaoIdentity(account) : '';
  if (saved && (state.accountId !== account.accountId || state.identityFingerprint !== identityFingerprint)) throw sessionError();
  let observed = '';
  const observe = conversationId => {
    if (!enabled || !conversationId) return;
    if (!safeId(conversationId) || (observed && observed !== conversationId)
      || (saved && state.conversationId !== conversationId)) throw sessionError('doubao_protocol_error');
    observed = conversationId;
  };
  return {
    enabled, continuing: saved,
    observe,
    complete: (conversationId) => {
      observe(conversationId);
      if (!enabled) return null;
      if (!observed) {
        if (saved) throw sessionError('doubao_protocol_error');
        return null;
      }
      return { version: 1, transport: 'node-http', status: 'ready', conversationId: observed,
        accountId: account.accountId, mode: 0, identityFingerprint };
    },
  };
};

module.exports = { isDoubaoSession, isReadyDoubaoSession, getDoubaoIdentity, createDoubaoSessionFlow, sessionError };
