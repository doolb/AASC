const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const { openLoginBrowser, createLoginBrowserHost } = require('../src/apps/server/modules/chat2api/chat2api-login-browser');

test('真实浏览器：独立资料、中文输入、拖动、画面和凭据保存采集', async t => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<input style="position:absolute;left:10px;top:10px" oninput="localStorage.setItem(\'token\',this.value)"><div id="drag" style="position:absolute;left:10px;top:100px;width:200px;height:100px;background:red" onmousedown="window.down=true" onmouseup="if(window.down)localStorage.setItem(\'drag\',\'ok\')"></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let actualBrowser, directory;
  const host = createLoginBrowserHost();
  t.after(() => host.stop());
  const options = { host, providerId: 'fixture', executable: 'vivaldi',
    profile: { loginUrl: origin, allowedOrigins: [origin], cookies: [], localStorage: [{ key: 'token', field: 'token' }, { key: 'drag', field: 'drag' }], requiredFields: ['token'] },
    launch: async options => { directory = options.userDataDir; actualBrowser = await require('puppeteer-core').launch({ ...options, headless: true }); return actualBrowser; } };
  const login = await openLoginBrowser(options);
  t.after(() => login.close());
  await login.input({ kind: 'down', x: 50, y: 20 }); await login.input({ kind: 'up', x: 50, y: 20 });
  await login.input({ kind: 'text', text: '中文登录测试' });
  await login.input({ kind: 'down', x: 30, y: 130 });
  await login.input({ kind: 'move', x: 100, y: 140 });
  await login.input({ kind: 'up', x: 100, y: 140 });
  assert.deepEqual(await login.capture(), { token: '中文登录测试', drag: 'ok' });
  const frame = await login.frame();
  assert.equal(Buffer.from(frame.image, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
  const pid = actualBrowser.process().pid;
  const other = await actualBrowser.newPage();
  await other.goto(origin + '/other');
  const loginPage = (await actualBrowser.pages()).find(page => page.url() === origin + '/');
  await login.close();
  assert.equal(loginPage.isClosed(), true);
  assert.equal(other.isClosed(), false);
  assert.equal(actualBrowser.connected, true);
  assert.equal(actualBrowser.process().exitCode, null);
  assert.equal(other.url(), origin + '/other');
  await fs.stat(directory);
  const reopened = await openLoginBrowser(options);
  t.after(() => reopened.close());
  assert.equal(actualBrowser.process().pid, pid);
  await assert.rejects(reopened.capture(), /尚未捕获完整凭据/);
  await reopened.close();
  assert.equal(other.isClosed(), false);
  await host.stop();
  await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
});
