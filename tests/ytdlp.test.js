'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createYtdlp, safeYtdlpArgs } = require('../res/tasks/overseas-media/providers/ytdlp');

const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-ytdlp-'));
  const binary = path.join(dir, 'yt-dlp');
  return { dir, binary, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test('只接受白名单 HTTPS 地址，阻止配置文件和播放列表', () => {
  assert.deepEqual(safeYtdlpArgs(url), ['--ignore-config', '--no-playlist', '--no-warnings']);
  for (const bad of ['https://youtube.com.evil.test/', 'http://youtube.com/', 'https://u:p@youtube.com/', 'https://youtube.com:444/', 'file:///etc/passwd']) assert.throws(() => safeYtdlpArgs(bad));
});
test('自定义路径不存在时不下载或覆盖', async () => {
  const f = setup();
  try { await assert.rejects(createYtdlp({ binary: f.binary, dataDir: f.dir }).ensure(), /不可执行/); assert.equal(fs.existsSync(f.binary), false); }
  finally { f.cleanup(); }
});
test('显式代理和直连覆盖环境代理，返回真实文件路径', async () => {
  const f = setup();
  const saved = process.env.HTTPS_PROXY;
  try {
    fs.writeFileSync(f.binary, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(path.join(f.dir, 'args.json'))},JSON.stringify({args:process.argv.slice(2),proxy:process.env.HTTPS_PROXY}));if(process.argv.includes('--dump-json'))console.log(JSON.stringify({url:'https://media.example/video',ext:'webm',title:'title'}));else console.log('/tmp/actual.webm');\n`, { mode: 0o755 });
    process.env.HTTPS_PROXY = 'http://ambient.invalid';
    let selected = 'http://user:secret@localhost:8888';
    const y = createYtdlp({ binary: f.binary, dataDir: f.dir, proxyUrl: () => selected });
    assert.deepEqual(await y.resolve(url), { url: 'https://media.example/video', ext: 'webm', title: 'title' });
    let seen = JSON.parse(fs.readFileSync(path.join(f.dir, 'args.json')));
    assert.ok(!JSON.stringify(seen.args).includes('secret'));
    assert.equal(seen.proxy, selected);
    selected = '';
    assert.equal(await y.run(url, '/tmp/result.%(ext)s'), '/tmp/actual.webm');
    seen = JSON.parse(fs.readFileSync(path.join(f.dir, 'args.json')));
    assert.equal(seen.args[seen.args.indexOf('--proxy') + 1], '');
    assert.equal(seen.proxy, undefined);
    await y.stop();
    await assert.rejects(y.resolve(url), /已停止/);
  } finally { if (saved === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = saved; f.cleanup(); }
});
test('子进程失败不泄露 stderr 中的凭据，停止会终止子进程', async () => {
  const f = setup();
  try {
    fs.writeFileSync(f.binary, '#!/bin/sh\necho secret >&2\nexit 1\n', { mode: 0o755 });
    const y = createYtdlp({ binary: f.binary, dataDir: f.dir });
    await assert.rejects(y.resolve(url, 'http://user:secret@localhost:8888'), e => !e.message.includes('secret'));
    fs.writeFileSync(f.binary, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
    const pending = y.resolve(url);
    await new Promise(resolve => setTimeout(resolve, 100));
    await y.stop();
    await assert.rejects(pending, /已停止/);
  } finally { f.cleanup(); }
});
test('自动安装拒绝散列不匹配的文件并清理临时文件，并发下载合并', async t => {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) || !process.report?.getReport()?.header?.glibcVersionRuntime) return t.skip('仅支持 Linux glibc');
  const { Readable } = require('node:stream');
  const axios = require('axios');
  const original = axios.get;
  const f = setup(); let calls = 0;
  try {
    axios.get = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 30)); return { data: Readable.from(['tampered']) }; };
    const y = createYtdlp({ dataDir: f.dir });
    const results = await Promise.allSettled([y.ensure(), y.ensure()]);
    assert.equal(calls, 1);
    assert.ok(results.every(result => result.status === 'rejected'));
    assert.deepEqual(fs.readdirSync(path.join(f.dir, 'bin')), []);
  } finally { axios.get = original; f.cleanup(); }
});
test('文件检查期间停止不会开始下载或返回可执行路径', async () => {
  const f = setup();
  const access = fs.promises.access;
  let release; let started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  try {
    fs.writeFileSync(f.binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.promises.access = async (...args) => { started(); await gate; return access(...args); };
    const y = createYtdlp({ binary: f.binary, dataDir: f.dir });
    const pending = y.ensure().then(() => null, error => error);
    await entered; await y.stop(); release();
    assert.match((await pending).message, /已停止/);
  } finally { fs.promises.access = access; f.cleanup(); }
});
test('停止时终止此 yt-dlp 的后代进程', async t => {
  if (process.platform === 'win32') return t.skip('Windows 由 taskkill 清理进程树');
  const f = setup(); const pidfile = path.join(f.dir, 'child.pid');
  try {
    fs.writeFileSync(f.binary, `#!/usr/bin/env node\nconst {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidfile)},String(c.pid));setInterval(()=>{},1000);\n`, { mode: 0o755 });
    const y = createYtdlp({ binary: f.binary, dataDir: f.dir });
    const pending = y.resolve(url).then(() => null, error => error);
    for (let i = 0; i < 100 && !fs.existsSync(pidfile); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(fs.existsSync(pidfile), '后代进程未启动');
    const pid = Number(fs.readFileSync(pidfile, 'utf8'));
    await y.stop();
    assert.match((await pending).message, /已停止/);
    let live = true;
    for (let i = 0; i < 100; i++) {
      try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); live = !/^\d+ \(.*\) Z /.test(stat); }
      catch { live = false; }
      if (!live) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(live, false, '后代进程仍在运行');
  } finally { f.cleanup(); }
});
test('自动安装检查期间停止后不会启动下载', async t => {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) || !process.report?.getReport()?.header?.glibcVersionRuntime) return t.skip('仅支持 Linux glibc');
  const f = setup(); const access = fs.promises.access; const axios = require('axios'); const get = axios.get;
  let release; let entered; let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  try {
    fs.promises.access = async () => { entered(); await gate; throw new Error('不存在'); };
    axios.get = async () => { calls++; throw new Error('不得下载'); };
    const y = createYtdlp({ dataDir: f.dir });
    const pending = y.ensure().then(() => null, error => error);
    await started; await y.stop(); release();
    assert.match((await pending).message, /已停止/);
    assert.equal(calls, 0);
  } finally { fs.promises.access = access; axios.get = get; f.cleanup(); }
});
test('Cookie 仅进入受限临时文件，成功、失败和停止后清理', async () => {
  const f = setup();
  try {
    const observed = path.join(f.dir, 'observed.json');
    fs.writeFileSync(f.binary, `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);const p=a[a.indexOf('--cookies')+1];fs.writeFileSync(${JSON.stringify(observed)},JSON.stringify({args:a,mode:fs.statSync(p).mode&0o777,text:fs.readFileSync(p,'utf8'),file:p}));if(process.env.TEST_COOKIE_WAIT)setInterval(()=>{},1000);else if(process.env.TEST_COOKIE_FAIL)process.exit(1);else console.log(JSON.stringify({url:'https://media.example/video',ext:'mp4',title:'title'}));\n`, {mode: 0o755});
    const y = createYtdlp({ binary:f.binary, cookie:'SID=secret; PREF=value' });
    await y.resolve(url);
    let seen = JSON.parse(fs.readFileSync(observed));
    assert.equal(seen.mode, 0o600); assert.match(seen.text, /SID\tsecret/); assert.ok(!JSON.stringify(seen.args).includes('secret')); assert.equal(fs.existsSync(seen.file), false);
    process.env.TEST_COOKIE_FAIL = '1';
    await assert.rejects(y.resolve(url));
    seen = JSON.parse(fs.readFileSync(observed)); assert.equal(fs.existsSync(seen.file), false);
    delete process.env.TEST_COOKIE_FAIL;
    process.env.TEST_COOKIE_WAIT = '1';
    fs.unlinkSync(observed);
    const pending = y.resolve(url).then(() => null, error => error);
    for (let i = 0; i < 100 && !fs.existsSync(observed); i++) await new Promise(resolve => setTimeout(resolve, 20));
    seen = JSON.parse(fs.readFileSync(observed));
    await y.stop(); assert.match((await pending).message, /已停止/); assert.equal(fs.existsSync(seen.file), false);
    assert.throws(() => createYtdlp({binary:f.binary, cookie:'SID=secret\nInjected=x'}), /格式无效/);
  } finally { delete process.env.TEST_COOKIE_WAIT; delete process.env.TEST_COOKIE_FAIL; f.cleanup(); }
});
