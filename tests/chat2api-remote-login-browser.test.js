const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createDoubaoBrowserLauncher, profilePath, configureRunningPreferences } = require('../src/apps/server/modules/chat2api/chat2api-doubao-browser-launcher');
const { createDoubaoBrowserBridge } = require('../src/apps/server/modules/chat2api/chat2api-doubao-browser-bridge');
const { acquireDoubaoBrowserPort } = require('../src/apps/server/modules/chat2api/chat2api-doubao-browser-port');
async function freePort() {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
const { openLoginBrowser, createLoginBrowserHost } = require('../src/apps/server/modules/chat2api/chat2api-login-browser');

test('真实浏览器：独立资料、中文输入、拖动、画面和凭据保存采集', async t => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<input style="position:absolute;left:10px;top:10px" oninput="localStorage.setItem(\'token\',this.value)"><div id="drag" style="position:absolute;left:10px;top:100px;width:200px;height:100px;background:red" onmousedown="window.down=true" onmouseup="if(window.down)localStorage.setItem(\'drag\',\'ok\')"></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-shared-login-'));
  t.after(async () => {
    await launcherCleanup();
    await fs.rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let launcherCleanup = async () => {};
  const config = { browserExecutable: 'vivaldi', debugPort: await freePort(), mode: 'browser-fetch', accountId: 'fixture' };
  let child;
  const launcher = createDoubaoBrowserLauncher({ rootDir, spawnBrowser: (executable, args, options) => {
    child = spawn(executable, [...args, ...(process.env.AASC_LOGIN_HEADFUL === '1' ? [] : ['--headless=new'])], options); return child;
  } });
  launcherCleanup = () => launcher.close();
  const bridge = createDoubaoBrowserBridge({ launcher, rootDir, getConfig: () => config });
  const runtime = acquireDoubaoBrowserPort({ rootDir, config, factory: () => bridge, android: false });
  t.after(() => runtime.stop());
  const bootstrap = await runtime.openLogin({ accountId: 'fixture' });
  await bootstrap.release();
  const host = createLoginBrowserHost();
  t.after(() => host.stop());
  const options = { host, providerId: 'fixture', browserOptions: { rootDir, accountId: 'fixture' },
    profile: { loginUrl: origin, allowedOrigins: [origin], cookies: [], localStorage: [{ key: 'token', field: 'token' }, { key: 'drag', field: 'drag' }], requiredFields: ['token'] } };
  const login = await openLoginBrowser(options);
  t.after(() => login.close());
  const actualBrowser = await launcher.open(config, 'fixture');
  if (process.env.AASC_LOGIN_HEADFUL === '1') {
    // 有窗口实测内置prefs API，避免仅凭磁盘字段推断已运行实例行为。
    assert.equal(await configureRunningPreferences(actualBrowser), true);
  }
  await login.frame(); // 控制端先收到首帧后才开始点击。
  await login.input({ kind: 'down', x: 50, y: 20 }); await login.input({ kind: 'up', x: 50, y: 20 });
  await login.input({ kind: 'text', text: '中文登录测试' });
  await login.input({ kind: 'down', x: 30, y: 130 });
  await login.input({ kind: 'move', x: 100, y: 140 });
  await login.input({ kind: 'up', x: 100, y: 140 });
  assert.deepEqual(await login.capture(), { token: '中文登录测试', drag: 'ok' });
  const frame = await login.frame();
  assert.equal(Buffer.from(frame.image, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
  const directory = profilePath(rootDir, 'fixture');
  const pid = child.pid;
  const other = await actualBrowser.newPage();
  await other.goto(origin + '/other');
  const loginPage = (await actualBrowser.pages()).find(page => page.url() === origin + '/');
  await login.close();
  assert.equal(loginPage.isClosed(), true);
  assert.equal(other.isClosed(), false);
  assert.equal(actualBrowser.connected, true);
  assert.equal(child.exitCode, null);
  assert.equal(other.url(), origin + '/other');
  await fs.stat(directory);
  const reopened = await openLoginBrowser(options);
  t.after(() => reopened.close());
  assert.equal(child.pid, pid);
  await assert.rejects(reopened.capture(), /尚未捕获完整凭据/);
  const abandonedPage = (await actualBrowser.pages()).find(item => item.url() === origin + '/');
  const recovered = await openLoginBrowser(options);
  t.after(() => recovered.close());
  assert.equal(abandonedPage.isClosed(), true);
  assert.equal(other.isClosed(), false);
  await reopened.close(); // 迟到的旧会话清理不应删除新会话记录。
  const record = JSON.parse(await fs.readFile(path.join(rootDir, 'browser-profiles', 'remote-login-context.json'), 'utf8'));
  assert.ok(actualBrowser.browserContexts().some(item => item.id === record.contextId));
  await recovered.close();
  assert.equal(other.isClosed(), false);
  await host.stop();
  assert.equal(actualBrowser.connected, true); // 运行租约仍然持有共享浏览器。
  await runtime.stop();
  await fs.stat(directory); // 固定profile跨重启保留。
});


test('固定profile重连已有进程，拒绝其他profile占用端口', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-reconnect-'));
  t.after(async () => { await first.close(); await fs.rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const config = { browserExecutable: 'vivaldi', debugPort: await freePort(), mode: 'browser-fetch', accountId: '' };
  let child;
  const first = createDoubaoBrowserLauncher({ rootDir, spawnBrowser: (exe, args, options) => {
    child = spawn(exe, [...args, ...(process.env.AASC_LOGIN_HEADFUL === '1' ? [] : ['--headless=new'])], options); return child;
  } });
  t.after(() => first.close());
  const browser = await first.open(config, 'account');
  const page = await browser.newPage(); await page.goto('data:text/html,kept');
  const ws = browser.wsEndpoint(); browser.disconnect();
  assert.equal(await first.lastAccount(config), 'account');
  const wrong = createDoubaoBrowserLauncher({ rootDir });
  await assert.rejects(wrong.open(config, 'different-account'), /port_busy/);
  assert.equal(child.exitCode, null);
  const second = createDoubaoBrowserLauncher({ rootDir, spawnBrowser: () => { throw new Error('不应重新启动'); } });
  t.after(() => second.close());
  const attached = await second.open(config, 'account');
  assert.equal(attached.wsEndpoint(), ws);
  assert.ok((await attached.pages()).some(item => item.url() === 'data:text/html,kept'));
  const prefs = JSON.parse(await fs.readFile(path.join(profilePath(rootDir, 'account'), 'Default', 'Preferences'), 'utf8'));
  assert.equal(prefs.vivaldi.system.show_exit_confirmation_dialog, false);
  await second.close();
});
