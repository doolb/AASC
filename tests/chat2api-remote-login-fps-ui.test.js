const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('实际UI帧率权威更新、解码背压、耗时补偿与关闭停止', async () => {
  const sent = [], timers = new Map(), handlers = new Map();
  let timerId = 0, now = 0, decode;
  const element = () => ({ value: '', addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {} });
  const pointers = new Map();
  const img = { ...element(), style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 720 }), addEventListener: (name, fn) => pointers.set(name, fn), decode: () => new Promise(resolve => { decode = resolve; }) };
  const fields = { img, '.chat2api-remote-notice': element(), 'input[type=password]': element(), '[data-view-mode]': element(), '[data-fps]': element(), '[data-action="close"]': element(), '[data-action="text"]': element(), '[data-action="complete"]': element() };
  const dialog = { ...element(), querySelector: selector => fields[selector], querySelectorAll: () => [] };
  const socket = { readyState: 1, send: value => sent.push(JSON.parse(value)), addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener() {} };
  const context = { window: { WebSocketManager: { ws: socket }, confirm: () => true }, document: { createElement: () => dialog, body: { appendChild() {} } }, WebSocket: { OPEN: 1 }, performance: { now: () => now },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id), console };
  vm.runInNewContext(fs.readFileSync('src/apps/web-mediacenter/ui/public/js/chat2api-remote-login.js', 'utf8'), context);
  const ui = context.window.Chat2APIRemoteLogin;
  const respond = (request, extra = {}) => handlers.get('message')({ data: JSON.stringify({ type: 'chat2apiRemoteLoginResult', requestId: request.requestId, success: true, sessionId: 's', ...extra }) });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const opening = ui.open({ providerId: 'deepseek', instanceId: 'one' });
  assert.equal(sent[0].type, 'getChat2ApiRemoteLoginConfig');
  respond(sent.find(value => value.action === 'open')); await opening;
  const request = sent.find(value => value.action === 'frame'); assert.ok(request);
  const point = (x, y) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, preventDefault() {} });
  const inputCount = () => sent.filter(value => value.action === 'input').length;
  pointers.get('pointerdown')(point(256, 10)); assert.equal(inputCount(), 0); // 适应上方留白。
  pointers.get('pointerdown')(point(256, 360));
  assert.deepEqual(sent.at(-1).payload, { kind: 'down', x: 512, y: 360 }); respond(sent.at(-1));
  pointers.get('pointerup')(point(900, 900));
  assert.deepEqual(sent.at(-1).payload, { kind: 'up', x: 1023, y: 719 }); respond(sent.at(-1));
  fields['[data-view-mode]'].value = 'cover'; fields['[data-view-mode]'].onchange();
  assert.equal(img.style.objectFit, 'cover');
  pointers.get('pointerdown')(point(0, 360));
  assert.deepEqual(sent.at(-1).payload, { kind: 'down', x: 256, y: 360 }); respond(sent.at(-1));
  pointers.get('pointerup')(point(512, 360)); respond(sent.at(-1));

  ui.handleConfig({ fps: 30 }); assert.equal(fields['[data-fps]'].value, 30);
  assert.equal(sent.filter(value => value.action === 'frame').length, 1);
  respond(request, { image: 'jpeg' }); await flush();
  assert.equal([...timers.values()].filter(value => value.delay < 60000).length, 0);
  now = 120; decode(); await flush();
  assert.equal([...timers.values()][0].delay, 0);
  ui.handleConfig({ fps: 2 }); assert.equal([...timers.values()][0].delay, 380);
  fields['[data-fps]'].value = '20'; fields['[data-fps]'].onchange();
  assert.equal(sent.at(-1).type, 'setChat2ApiRemoteLoginConfig'); assert.equal(sent.at(-1).fps, 20);
  assert.equal(fields['[data-fps]'].value, '20');
  assert.equal(fields['[data-fps]'].disabled, true);
  const saveId = sent.at(-1).requestId;
  ui.handleConfig({ fps: 10 }); // 迟到初始化不得抹掉正在保存的输入。
  assert.equal(fields['[data-fps]'].value, '20');
  ui.handleConfig({ requestId: saveId, fps: 2, success: false, message: '保存失败' });
  assert.equal(fields['[data-fps]'].value, 2);
  assert.equal(fields['[data-fps]'].disabled, false); assert.equal(fields['.chat2api-remote-notice'].textContent, '保存失败');
  const closing = ui.close(); respond(sent.at(-1)); await closing;
  assert.equal(timers.size, 0);
  handlers.get('close')(); assert.equal(fields['[data-fps]'].value, 10);
});


test('帧率消息同时注册AASC handler、初始化快照及控制端回执分发', () => {
  const server = fs.readFileSync('src/apps/server/boot/server-app.js', 'utf8');
  const types = server.match(/const controlTypes = \[([\s\S]*?)\];/)[1];
  assert.match(types, /'getChat2ApiRemoteLoginConfig'/);
  assert.match(types, /'setChat2ApiRemoteLoginConfig'/);
  assert.match(server, /remoteLoginSettings\.handle\(ws, data\)/);
  assert.match(server, /JSON\.stringify\(remoteLoginSettings\.snapshot\(\)\)/);
  assert.match(fs.readFileSync('src/apps/web-mediacenter/ui/public/js/websocket.js', 'utf8'), /chat2apiRemoteLoginConfig: data => window\.Chat2APIRemoteLogin\?\.handleConfig\(data\)/);
});
