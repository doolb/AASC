const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const test = require('node:test');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'tts-wine.js');
const PORT = 32700 + (process.pid % 500);
const REQUEST_COUNT = 30;
const MAX_REQUESTS_PER_WORKER = 10;
const RSS_DELTA_LIMIT_KB = 32 * 1024;
const TEXT_SEED = '离线Wine语音合成稳定性测试文本，用于定位Embedded Speech SDK句柄复用造成的原生内存增长。';
const TEXT = [...TEXT_SEED.repeat(Math.ceil(100 / [...TEXT_SEED].length))].slice(0, 100).join('');

assert.equal([...TEXT].length, 100);

function request(pathname, method, body, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathname,
      method,
      timeout: timeoutMs,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function processTreeRss(rootPid) {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,cmd='], { encoding: 'utf8' })
    .trim().split('\n').map(row => row.trim().split(/\s+/)).filter(row => row.length >= 4);
  const ids = [rootPid];
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (ids.includes(Number(row[1])) && !ids.includes(Number(row[0]))) {
        ids.push(Number(row[0]));
        changed = true;
      }
    }
  }
  return rows.filter(row => ids.includes(Number(row[0]))).reduce((sum, row) => sum + Number(row[2]), 0);
}

async function waitReady() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const response = await request('/api/tts/status', 'GET', null, 3000);
      const status = JSON.parse(response.body.toString('utf8'));
      if (status.readyWorkers === 1) return;
    } catch (_) {
      // 服务尚未监听，继续等待。
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Wine TTS server readiness timeout');
}

test('100 字 worker 长稳 RSS 不应持续增长', async () => {
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      TTS_WINE_WORKERS: '1',
      TTS_WINE_MAX_QUEUE: String(REQUEST_COUNT + 1),
      TTS_WINE_MAX_REQUESTS: String(MAX_REQUESTS_PER_WORKER)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  server.stdout.on('data', chunk => logs.push(chunk.toString()));
  server.stderr.on('data', chunk => logs.push(chunk.toString()));

  try {
    await waitReady();
    const readyRss = processTreeRss(server.pid);
    let success = 0;
    let finalRss = readyRss;
    for (let index = 0; index < REQUEST_COUNT; index += 1) {
      const response = await request('/api/tts', 'POST', { text: TEXT, voice: 'Microsoft Xiaoxiao', speed: 0 });
      assert.equal(response.statusCode, 200, response.body.toString('utf8').slice(0, 200));
      assert.match(response.headers['content-type'] || '', /audio\/wav/);
      assert.ok(response.body.length > 44, 'WAV 响应不应为空');
      success += 1;
      finalRss = processTreeRss(server.pid);
    }
    const delta = finalRss - readyRss;
    assert.equal(success, REQUEST_COUNT);
    assert.ok(delta <= RSS_DELTA_LIMIT_KB, `RSS delta ${delta}KB exceeds ${RSS_DELTA_LIMIT_KB}KB; ready=${readyRss}KB final=${finalRss}KB logs=${logs.join('').slice(-1000)}`);
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
});
