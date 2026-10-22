(function () {
  'use strict';
  let session = null;
  let opening = false;
  let socket = null;
  let sequence = 0;
  let generation = 0;
  let pollTimer;
  let dialog;
  let image;
  let notice;
  let text;
  let dragging = false;
  let moveAt = 0;
  const pending = new Map();

  function reply(event) {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type !== 'chat2apiRemoteLoginResult') return;
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId); clearTimeout(request.timer);
    if (data.success) request.resolve(data); else request.reject(new Error(data.message || '登录操作失败'));
  }
  function disconnected() {
    generation++; clearTimeout(pollTimer); session = null; dragging = false;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('控制端已断线，请重新打开登录')); }
    pending.clear();
    if (notice) notice.textContent = '控制端已断线，请重新打开登录';
  }
  function connect() {
    const next = window.WebSocketManager?.ws;
    if (!next || next.readyState !== WebSocket.OPEN) throw new Error('控制端尚未连接服务器');
    if (socket === next) return;
    if (socket) { socket.removeEventListener('message', reply); socket.removeEventListener('close', disconnected); }
    socket = next; socket.addEventListener('message', reply); socket.addEventListener('close', disconnected);
  }
  function request(action, payload = {}) {
    connect();
    const requestId = 'remote-login-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('登录操作等待超时')); }, 60000);
      pending.set(requestId, { resolve, reject, timer });
      try { socket.send(JSON.stringify({ type: 'chat2apiRemoteLogin', requestId, action, sessionId: session?.sessionId, ...payload })); }
      catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
  }
  function input(payload) {
    if (!session) return;
    void request('input', { sequence: ++sequence, payload }).catch(error => { notice.textContent = error.message; });
  }
  function position(event) {
    const box = image.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1024, (event.clientX - box.left) * 1024 / box.width)),
      y: Math.max(0, Math.min(720, (event.clientY - box.top) * 720 / box.height)) };
  }
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('div'); dialog.className = 'chat2api-remote-login'; dialog.hidden = true;
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', '服务器网页登录');
    dialog.innerHTML = '<div class="chat2api-remote-panel"><div class="chat2api-remote-toolbar"><strong>服务器网页登录</strong><button data-action="complete">完成登录并保存</button><button data-action="close">关闭</button></div><p class="chat2api-remote-notice" aria-live="polite"></p><div class="chat2api-remote-viewport"><img draggable="false" tabindex="0" alt="远程登录页面"></div><div class="chat2api-remote-toolbar"><input type="password" autocomplete="off" placeholder="先点网页输入框，再在这里输入文字或密码" aria-label="发送到网页的文字"><button data-action="text">输入到网页</button><button data-key="Backspace">退格</button><button data-key="Enter">回车</button><button data-key="Tab">Tab</button><button data-key="Control+A">全选</button></div></div>';
    image = dialog.querySelector('img'); notice = dialog.querySelector('.chat2api-remote-notice'); text = dialog.querySelector('input');
    dialog.querySelector('[data-action="close"]').onclick = () => { void close(); };
    const sendText = () => { if (text.value) { input({ kind: 'text', text: text.value }); text.value = ''; } };
    text.maxLength = 4096;
    dialog.querySelector('[data-action="text"]').onclick = sendText;
    text.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); sendText(); } });
    dialog.querySelectorAll('[data-key]').forEach(button => { button.onclick = () => input({ kind: 'key', key: button.dataset.key }); });
    dialog.querySelector('[data-action="complete"]').onclick = async event => {
      if (!session || event.currentTarget.disabled) return;
      const button = event.currentTarget; button.disabled = true;
      try {
        const result = await request('complete');
        session = null; generation++; clearTimeout(pollTimer); dialog.hidden = true; image.removeAttribute('src');
        await window.Chat2APIControl?.refresh();
        window.Chat2APIControl?.message('账号已保存。');
      } catch (error) { notice.textContent = error.message; }
      finally { button.disabled = false; }
    };
    image.addEventListener('pointerdown', event => {
      if (!session || event.button !== 0) return;
      event.preventDefault(); dragging = true; image.focus(); image.setPointerCapture(event.pointerId);
      input({ kind: 'down', ...position(event) });
    });
    image.addEventListener('pointermove', event => {
      if (!dragging || performance.now() - moveAt < 35) return;
      moveAt = performance.now(); input({ kind: 'move', ...position(event) });
    });
    const release = event => { if (!dragging) return; dragging = false; input({ kind: 'up', ...position(event) }); };
    image.addEventListener('pointerup', release); image.addEventListener('pointercancel', release);
    image.addEventListener('wheel', event => { event.preventDefault(); input({ kind: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY }); }, { passive: false });
    image.addEventListener('keydown', event => {
      if (event.isComposing || event.metaKey) return;
      const key = event.ctrlKey && event.key.toLowerCase() === 'a' ? 'Control+A' : event.key;
      if (['Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Control+A'].includes(key)) {
        event.preventDefault(); input({ kind: 'key', key });
      } else if (!event.ctrlKey && event.key.length === 1) { event.preventDefault(); input({ kind: 'text', text: event.key }); }
    });
    document.body.appendChild(dialog);
  }
  async function poll(version) {
    if (!session || version !== generation) return;
    try {
      const frame = await request('frame');
      if (!session || version !== generation || frame.sessionId !== session.sessionId) return;
      image.src = 'data:image/jpeg;base64,' + frame.image;
      await image.decode().catch(() => {});
      if (frame.notice) notice.textContent = frame.notice;
    } catch (error) { if (version === generation) notice.textContent = error.message; }
    if (session && version === generation) pollTimer = setTimeout(() => { void poll(version); }, 300);
  }
  async function close() {
    generation++; clearTimeout(pollTimer); dragging = false;
    if (session) { try { await request('close'); } catch { /* 断线由服务端释放会话。 */ } }
    session = null;
    if (dialog) { dialog.hidden = true; image.removeAttribute('src'); text.value = ''; }
  }
  async function open({ providerId, accountId, instanceId }) {
    if (opening) return;
    ensureDialog(); connect();
    if (session && !window.confirm('切换将关闭当前登录页面，尚未保存的登录不会保存，是否继续？')) return;
    opening = true;
    const version = ++generation; clearTimeout(pollTimer); sequence = 0;
    dialog.hidden = false; image.removeAttribute('src'); notice.textContent = '正在打开服务器登录页面…';
    try {
      const opened = await request('open', { providerId, accountId, instanceId, replace: Boolean(session) });
      if (version !== generation) { await request('close', { sessionId: opened.sessionId }); return; }
      session = opened;
      notice.textContent = providerId === 'doubaochat' ? '请完成登录，并手动发送一条消息，等待完整回复后点“完成登录并保存”。' : '请在官网完成登录；需要时操作一次官网功能以取得凭据，再点“完成登录并保存”。';
      void poll(version);
    } catch (error) { if (version === generation) notice.textContent = error.message; }
    finally { opening = false; }
  }
  window.Chat2APIRemoteLogin = { open, close };
})();
