const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const DEFAULT_PORT = 3190;
const TEXT_SEED = '离线Wine语音合成稳定性测试文本，用于验证请求响应、FIFO队列、断连恢复以及常驻内存变化。';
const TEXT = [...TEXT_SEED.repeat(Math.ceil(100 / [...TEXT_SEED].length))].slice(0, 100).join('');
assert.equal([...TEXT].length, 100);

function parseArgs(argv) {
  const args = { total: 1000, concurrency: 3, workers: 3, port: DEFAULT_PORT };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--total') args.total = Math.max(1, Number(value) || args.total), index += 1;
    else if (key === '--concurrency') args.concurrency = Math.max(1, Number(value) || args.concurrency), index += 1;
    else if (key === '--workers') args.workers = Math.max(1, Number(value) || args.workers), index += 1;
    else if (key === '--port') args.port = Math.max(1, Number(value) || args.port), index += 1;
  }
  return args;
}

function request(port, method, pathname, body, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
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

function processTreeRss(serverPid) {
  try {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,cmd='], { encoding: 'utf8' })
      .trim().split('\n').map(row => row.trim().split(/\s+/)).filter(row => row.length >= 4);
    const ids = [serverPid];
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
    const total = rows.filter(row => ids.includes(Number(row[0])) || row.slice(3).join(' ').includes('wineserver'))
      .reduce((sum, row) => sum + Number(row[2]), 0);
    return { total, rows: rows.filter(row => ids.includes(Number(row[0])) || row.slice(3).join(' ').includes('wineserver')) };
  } catch (_) {
    return { total: 0, rows: [] };
  }
}

async function waitReady(port) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const response = await request(port, 'GET', '/api/tts/status', null, 3000);
      const status = JSON.parse(response.body.toString('utf8'));
      if (status.readyWorkers > 0) return status;
    } catch (_) {
      // 服务尚未监听，继续等待。
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Wine TTS server readiness timeout');
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = spawn(process.execPath, [path.join(ROOT, 'tts-wine.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(args.port), TTS_WINE_WORKERS: String(args.workers), TTS_WINE_MAX_QUEUE: String(args.total + args.concurrency) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => process.stdout.write(`[tts-wine] ${chunk}`));
  server.stderr.on('data', chunk => process.stderr.write(`[tts-wine] ${chunk}`));

  const rssSamples = [];
  const rssTimer = setInterval(() => {
    const sample = processTreeRss(server.pid);
    if (sample.total > 0) rssSamples.push({ at: Date.now(), rssKb: sample.total });
  }, 1000);

  try {
    const readyStatus = await waitReady(args.port);
    const readyRss = processTreeRss(server.pid).total;
    const latencies = [];
    const errors = [];
    let nextIndex = 0;
    const startedAt = performance.now();
    async function runClient() {
      while (true) {
        const current = nextIndex;
        nextIndex += 1;
        if (current >= args.total) return;
        const start = performance.now();
        try {
          const response = await request(args.port, 'POST', '/api/tts', { text: TEXT, voice: 'Microsoft Xiaoxiao', speed: 0 });
          const elapsed = performance.now() - start;
          if (response.statusCode !== 200 || response.headers['content-type']?.includes('audio/wav') !== true) {
            errors.push({ index: current, statusCode: response.statusCode, body: response.body.toString('utf8').slice(0, 200) });
          } else {
            latencies.push(elapsed);
          }
        } catch (error) {
          errors.push({ index: current, message: error.message });
        }
        if ((current + 1) % 50 === 0 || current + 1 === args.total) {
          console.log(`progress=${current + 1}/${args.total} success=${latencies.length} errors=${errors.length}`);
        }
      }
    }
    await Promise.all(Array.from({ length: args.concurrency }, () => runClient()));
    const wallMs = performance.now() - startedAt;
    const finalStatus = JSON.parse((await request(args.port, 'GET', '/api/tts/status')).body.toString('utf8'));
    const finalRss = processTreeRss(server.pid).total;
    const peakRss = Math.max(readyRss, ...rssSamples.map(sample => sample.rssKb), finalRss);
    console.log(JSON.stringify({
      textChars: [...TEXT].length,
      total: args.total,
      concurrency: args.concurrency,
      workers: args.workers,
      success: latencies.length,
      errors: errors.length,
      wallMs,
      tps: args.total / (wallMs / 1000),
      latencyMs: { min: Math.min(...latencies), avg: latencies.reduce((sum, value) => sum + value, 0) / latencies.length, p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99), max: Math.max(...latencies) },
      rssKb: { ready: readyRss, peak: peakRss, final: finalRss, delta: finalRss - readyRss },
      queue: { ready: readyStatus.queueLength, final: finalStatus.queueLength, finalBusy: finalStatus.workers.filter(worker => worker.busy).length },
      firstErrors: errors.slice(0, 5)
    }, null, 2));
    if (errors.length > 0 || finalStatus.queueLength !== 0 || finalStatus.workers.some(worker => worker.busy || worker.pending !== 0)) process.exitCode = 1;
  } finally {
    clearInterval(rssTimer);
    server.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
