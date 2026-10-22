'use strict';

const crypto = require('node:crypto');
const { getAndroidLoginProfile } = require('./chat2api-login-profiles');
const { accountLoginVersion } = require('./chat2api-data-store');
const { openLoginBrowser, createLoginBrowserHost } = require('./chat2api-login-browser');
const fail = message => Object.assign(new Error(message), { publicMessage: message });

/** 固定视口与有界输入；不得把控制端任意CDP命令直接交给浏览器。 */
function validateInput(value) {
  if (!value || typeof value !== 'object') throw fail('输入参数无效');
  const kind = value.kind;
  if (['move', 'down', 'up'].includes(kind)) {
    if (![value.x, value.y].every(Number.isFinite) || value.x < 0 || value.x > 1024 || value.y < 0 || value.y > 720) throw fail('输入坐标超出登录画面');
    return { kind, x: value.x, y: value.y };
  }
  if (kind === 'wheel' && [value.deltaX, value.deltaY].every(Number.isFinite)) return {
    kind, deltaX: Math.max(-720, Math.min(720, value.deltaX)), deltaY: Math.max(-720, Math.min(720, value.deltaY)) };
  if (kind === 'text' && typeof value.text === 'string' && value.text.length <= 4096 && !value.text.includes('\0')) return { kind, text: value.text };
  if (kind === 'key' && ['Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Control+A'].includes(value.key)) return { kind, key: value.key };
  throw fail('不支持的登录操作');
}

/** 全服务只装配一个管理器；所有控制端共享槽位，浏览器属于登录角色而非豆包运行任务。 */
function createRemoteBrowserSessions({ getRuntime, getBrowserConfig = () => undefined, openBrowser = openLoginBrowser,
  now = Date.now, ttlMs = 15 * 60 * 1000 } = {}) {
  const browserHost = createLoginBrowserHost();
  let active = null;
  let tail = Promise.resolve();
  let queued = 0;
  const dispose = async session => {
    if (!session) return;
    session.closed = true;
    try { await session.browser?.close(); }
    finally {
      await session.runtime?.oauth.cancelLogin?.(session.login?.state).catch(() => {});
      if (active === session) active = null;
    }
  };
  const live = session => session && !session.closed && session.owner.readyState === 1
    && session.expiresAt > now() && session.runtime.getStatus().running;
  const check = (owner, data) => {
    if (!active || active.owner !== owner || active.id !== data.sessionId || !live(active)) throw fail('登录会话已结束或不属于当前控制端');
    return active;
  };
  const publicSession = session => ({ sessionId: session.id, providerId: session.providerId,
    expiresAt: session.expiresAt, width: 1024, height: 720 });
  const operations = {
    async open(owner, data) {
      if (active && !live(active)) await dispose(active);
      if (active?.owner !== owner && active) throw fail('登录页面正被其他控制端使用');
      if (active && active.providerId === data.providerId && active.accountId === (data.accountId || '')
        && active.instanceId === data.instanceId) return publicSession(active);
      if (active && data.replace !== true) throw fail('请先关闭或确认切换当前登录页面');
      if (active) await dispose(active);
      const profile = getAndroidLoginProfile(data.providerId);
      if (!profile) throw fail('此Provider没有网页登录声明，请使用手工配置');
      const runtime = await getRuntime(data.instanceId);
      if (!runtime?.getStatus().running) throw fail('Chat2API任务未运行');
      const account = data.accountId ? await runtime.dataStore.getAccount(data.accountId) : null;
      if (data.accountId && (!account || account.providerId !== data.providerId || account.enabled === false)) throw fail('账号不可用或Provider不匹配');
      const session = { id: crypto.randomUUID(), owner, providerId: data.providerId, accountId: data.accountId || '',
        instanceId: data.instanceId, runtime, expiresAt: now() + ttlMs, sequence: 0, closed: false,
        version: account ? accountLoginVersion(account) : undefined, account };
      active = session;
      try {
        session.login = await runtime.oauth.startLogin(data.providerId);
        const oauthExpiry = Number(session.login.expiresAt);
        if (Number.isFinite(oauthExpiry)) session.expiresAt = Math.min(session.expiresAt, oauthExpiry);
        let restore;
        if (account) {
          const token = await runtime.accountWebSession.createSession(account.accountId);
          restore = await runtime.accountWebSession.consumeSession(token.sessionId);
        }
        session.browser = await openBrowser({ profile, providerId: data.providerId, restore, host: browserHost, browserOptions: { rootDir: runtime.dataStore?.rootDir,
          config: getBrowserConfig(), accountIds: (await runtime.dataStore?.listAccounts?.() || [])
            .filter(item => item.providerId === 'doubaochat').map(item => item.accountId), accountId: data.providerId === 'doubaochat' ? data.accountId : undefined } });
        if (!live(session)) throw fail('登录页面打开期间连接已结束');
        return publicSession(session);
      } catch (error) { await dispose(session); throw error; }
    },
    async frame(owner, data) {
      const session = check(owner, data);
      if (session.frame && now() - session.frameAt < 250) return session.frame;
      const frame = await session.browser.frame();
      if (!live(session)) throw fail('登录会话已结束');
      session.frame = { ...publicSession(session), ...frame };
      session.frameAt = now();
      return session.frame;
    },
    async input(owner, data) {
      const session = check(owner, data);
      if (!Number.isSafeInteger(data.sequence) || data.sequence <= session.sequence) throw fail('输入顺序已失效');
      const input = validateInput(data.payload);
      session.sequence = data.sequence;
      await session.browser.input(input);
      return { sessionId: session.id };
    },
    async complete(owner, data) {
      const session = check(owner, data);
      const credentials = await session.browser.capture();
      if (!live(session)) throw fail('登录会话已结束');
      const result = await session.runtime.oauth.completeLogin({ state: session.login.state,
        providerId: session.providerId, credentials, accountId: session.accountId || undefined,
        label: session.account?.label, expectedCredentialVersion: session.version });
      await dispose(session);
      // 即使注入的OAuth实现返回私有字段，也不把账号原始结构回送控制端。
      return { saved: true, accountId: result.account?.accountId, providerId: session.providerId };
    },
    async close(owner, data) { const session = check(owner, data); await dispose(session); return { closed: true }; },
  };
  const respond = (owner, data, result) => {
    try {
      if (owner.readyState === 1) owner.send(JSON.stringify({ type: 'chat2apiRemoteLoginResult',
        requestId: data.requestId, ...result }));
    } catch { /* 发送期间断线由连接关闭回调释放登录资源。 */ }
  };
  const handle = (owner, data) => {
    if (typeof data.requestId !== 'string' || data.requestId.length > 100) return Promise.resolve();
    if (!Object.hasOwn(operations, data.action) || queued >= 64) {
      respond(owner, data, { success: false, message: '登录操作无效或请求过多' }); return Promise.resolve();
    }
    queued++;
    const run = tail.catch(() => {}).then(async () => {
      if (owner.readyState !== 1) return;
      try { respond(owner, data, { success: true, ...await operations[data.action](owner, data) }); }
      catch (error) { respond(owner, data, { success: false, message: error.publicMessage
        || (data.action === 'complete' ? '登录资料未就绪、账号已变化或校验失败，请完成官网登录后重试' : '服务器登录浏览器不可用，请检查浏览器路径、显示环境和页面状态') }); }
    }).finally(() => { queued--; });
    tail = run;
    return run;
  };
  const disconnect = owner => {
    if (active?.owner !== owner) return;
    active.closed = true;
    const session = active;
    tail = tail.catch(() => {}).then(() => dispose(session));
  };
  const timer = setInterval(() => {
    if (!active || live(active)) return;
    const session = active;
    session.closed = true;
    tail = tail.catch(() => {}).then(() => dispose(session));
  }, 5000);
  timer.unref?.();
  return { handle, disconnect, async stop() { clearInterval(timer); if (active) active.closed = true; await tail; try { await dispose(active); } finally { await browserHost.stop(); } } };
}

module.exports = { createRemoteBrowserSessions, validateInput };
