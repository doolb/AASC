const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const PORT = 3187;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEXT_SEED = '离线Wine语音合成稳定性测试文本，用于验证请求响应、FIFO队列、断连恢复以及常驻内存变化。';
const TEXT_100 = [...TEXT_SEED.repeat(Math.ceil(100 / [...TEXT_SEED].length))].slice(0, 100).join('');

assert.equal([...TEXT_100].length, 100);

let server;

function request(method, pathname, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(pathname, BASE_URL);
    const req = http.request(url, {
      method,
      timeout: timeoutMs,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function postTts() {
  return request('POST', '/api/tts', { text: TEXT_100, voice: 'Microsoft Xiaoxiao', speed: 0 });
}

async function waitReady() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const result = await request('GET', '/api/tts/status', null, 3000);
      const status = JSON.parse(result.body.toString('utf8'));
      if (status.readyWorkers > 0) return;
    } catch (_) {
      // 服务尚未监听，继续等待。
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Wine TTS server readiness timeout');
}

test.before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, 'tts-wine.js')], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT), TTS_WINE_WORKERS: '2', TTS_WINE_MAX_QUEUE: '20', TTS_WINE_QUEUE_TIMEOUT_MS: '30000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => process.stdout.write(`[tts-wine-test] ${chunk}`));
  server.stderr.on('data', chunk => process.stderr.write(`[tts-wine-test] ${chunk}`));
  await waitReady();
});

test.after(async () => {
  if (!server) return;
  server.kill('SIGTERM');
  await once(server, 'exit');
});

test('100字文本可以获取语音列表并生成 WAV', async () => {
  const voices = await request('GET', '/api/voices');
  assert.equal(voices.statusCode, 200);
  const voiceData = JSON.parse(voices.body.toString('utf8'));
  assert.equal(voiceData.success, true);
  assert.ok(Array.isArray(voiceData.data));

  const audio = await postTts();
  assert.equal(audio.statusCode, 200);
  assert.match(audio.headers['content-type'], /audio\/wav/);
  assert.ok(audio.body.length > 44);
  assert.equal(audio.body.toString('ascii', 0, 4), 'RIFF');
});

test('FIFO 队列可以完成 6 个并发 100 字请求并回到空闲', async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => postTts()));
  assert.deepEqual(results.map(result => result.statusCode), [200, 200, 200, 200, 200, 200]);
  const status = await request('GET', '/api/tts/status');
  const data = JSON.parse(status.body.toString('utf8'));
  assert.equal(data.queueLength, 0);
  assert.equal(data.readyWorkers, 2);
  assert.ok(data.workers.every(worker => worker.busy === false && worker.pending === 0));
});

test('客户端断连后，后续 100 字请求仍能完成', async () => {
  await new Promise(resolve => {
    const payload = JSON.stringify({ text: TEXT_100, voice: 'Microsoft Xiaoxiao', speed: 0 });
    const req = http.request(new URL('/api/tts', BASE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    });
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
    setTimeout(() => { req.destroy(); resolve(); }, 20);
  });

  const normal = await postTts();
  assert.equal(normal.statusCode, 200);
});
