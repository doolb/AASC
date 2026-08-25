const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const app = express();

// ======= 配置区 =======
const PORT = Number(process.env.PORT || 3001);
const WINE_BIN = process.env.WINE_BIN || 'wine';
const DEFAULT_WINE_PREFIX = path.join(
  __dirname,
  '..',
  'NaturalVoiceSAPIAdapter',
  'nvsapi-linux-poc',
  'tmp',
  'wine-probe',
  'prefix'
);
const WINEPREFIX = process.env.WINEPREFIX || DEFAULT_WINE_PREFIX;
const WORKER_DIR = path.join(__dirname, 'wine', 'bin');
const WORKER_EXE = path.join(WORKER_DIR, 'worker_tts_windows.exe');
const MODEL_DIR = path.join(__dirname, 'models', 'extracted');
const DEFAULT_VOICE = process.env.TTS_DEFAULT_VOICE || 'Microsoft Xiaoxiao';
const DEFAULT_LICENSE = process.env.MS_TTS_KEY || 'Key:ZCjZ7nHDSLvf4gpELteM4AnzaWUjTpn7UkV7D@vvksl0w1SNgon6d1905WANbktDc9S39oaA4r29HJNayXvTq8fJsq';
const WORKER_COUNT = Math.max(1, parseInt(process.env.TTS_WINE_WORKERS, 10) || 3);
const REQUEST_TIMEOUT_MS = Number(process.env.TTS_WINE_TIMEOUT_MS || 300000);
const MAX_QUEUE_LENGTH = Math.max(1, parseInt(process.env.TTS_WINE_MAX_QUEUE, 10) || 100);
const QUEUE_TIMEOUT_MS = Number(process.env.TTS_WINE_QUEUE_TIMEOUT_MS || 300000);
// Embedded Speech SDK 的 native allocator 不保证在句柄释放后立即归还 RSS；按请求数回收进程可硬隔离其增长。
const configuredMaxRequests = Number.parseInt(process.env.TTS_WINE_MAX_REQUESTS, 10);
const MAX_REQUESTS_PER_WORKER = Number.isFinite(configuredMaxRequests)
  ? Math.max(0, configuredMaxRequests)
  : 10;
// ======================

const requestQueue = [];
const workers = [];
let tagCounter = 0;

function toWindowsPath(linuxPath) {
  if (/^[A-Za-z]:[\\/]/.test(linuxPath)) {
    return linuxPath.replace(/\//g, '\\');
  }
  const absolute = path.resolve(linuxPath);
  return `Z:${absolute.replace(/\//g, '\\')}`;
}

function base64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function unbase64(text) {
  return Buffer.from(text, 'base64').toString('utf8');
}

function sendJsonError(res, statusCode, message, details) {
  if (res.headersSent) return;
  res.status(statusCode).json({ success: false, error: message, details });
}

class WineWorker {
  constructor(index) {
    this.index = index;
    this.name = `wine-worker-${index}`;
    this.ready = false;
    this.busy = false;
    this.pending = new Map();
    this.stopping = false;
    this.restartTimer = null;
    this.child = null;
    this.rl = null;
    this.completedRequests = 0;
    this.recycleAfterTask = false;
    this.runActive = false;
    this.spawn();
  }

  spawn() {
    if (this.stopping) return;

    const args = [
      WORKER_EXE,
      '--model',
      toWindowsPath(MODEL_DIR),
      '--license',
      DEFAULT_LICENSE
    ];

    this.ready = false;
    this.busy = false;
    this.completedRequests = 0;
    this.recycleAfterTask = false;
    this.runActive = false;

    const child = spawn(WINE_BIN, args, {
      cwd: WORKER_DIR,
      env: {
        ...process.env,
        WINEPREFIX,
        WINEARCH: 'win64',
        WINEDEBUG: '-all'
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.child = child;
    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on('line', line => this.handleLine(line));

    child.stderr.on('data', chunk => {
      const text = chunk.toString().trim();
      if (text) console.log(`[${this.name}] ${text.slice(0, 500)}`);
    });

    child.on('error', err => {
      console.log(`[${this.name}] spawn error: ${err.message}`);
      this.failAll(`Wine worker 启动失败: ${err.message}`);
      this.scheduleRestart();
    });

    child.on('exit', (code, signal) => {
      console.log(`[${this.name}] exited code=${code} signal=${signal}`);
      if (this.rl) this.rl.close();
      this.failAll(`Wine worker 已退出 code=${code} signal=${signal}`);
      this.scheduleRestart();
    });
  }

  handleLine(line) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === 'READY') {
      console.log(`[${this.name}] ready`);
      this.ready = true;
      drain();
      return;
    }

    const parts = line.split('\t');
    if (parts.length < 3) {
      console.log(`[${this.name}] unknown line: ${line.slice(0, 200)}`);
      return;
    }

    const pending = this.pending.get(parts[1]);
    if (!pending) {
      console.log(`[${this.name}] response for unknown id: ${parts[1]}`);
      return;
    }

    this.pending.delete(parts[1]);
    if (pending.timer) clearTimeout(pending.timer);
    this.busy = false;
    const shouldRecycle = parts[0] === 'S' && MAX_REQUESTS_PER_WORKER > 0 &&
      this.completedRequests + 1 >= MAX_REQUESTS_PER_WORKER;
    if (parts[0] === 'S') this.completedRequests += 1;

    const ok = parts[2] === '1';
    if (ok) pending.resolve({ data: parts[3] || '', error: parts[4] || '' });
    else pending.reject(new Error(unbase64(parts[4] || 'aW52YWxpZCBlcnJvcg==')));

    // 在下一项任务派发前回收 worker，避免 native RSS 增长跨请求累积。
    if (shouldRecycle) {
      // 先阻止新任务派发，等当前 HTTP 任务 finally 完成后再终止子进程。
      this.ready = false;
      this.recycleAfterTask = true;
    }
  }

  send(kind, fields) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now().toString(36)}${(++tagCounter).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const line = [kind, id, ...fields].join('\t');
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.busy = false;
        this.kill('request-timeout');
        reject(new Error(`Wine worker 请求超时`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      this.busy = true;

      try {
        if (!this.child.stdin.write(`${line}\n`)) {
          // Backpressure is handled by the worker's single-flight queue.
        }
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.busy = false;
        reject(new Error(`写入 Wine worker 失败: ${err.message}`));
      }
    });
  }

  synthesize(text, voice, speed) {
    return this.send('S', [
      base64(text),
      base64(voice || ''),
      String(Number(speed) || 0)
    ]).then(result => Buffer.from(result.data, 'base64'));
  }

  listVoices() {
    return this.send('L', []).then(result => {
      const text = unbase64(result.data);
      return text ? text.split('\n').filter(Boolean) : [];
    });
  }

  failAll(message) {
    this.ready = false;
    const entries = [...this.pending.entries()];
    this.pending.clear();
    this.busy = false;
    for (const [, pending] of entries) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    drain();
  }

  kill(reason) {
    console.log(`[${this.name}] kill: ${reason}`);
    this.stopping = true;
    this.ready = false;
    this.failAll(`Wine worker 已中止: ${reason}`);
    try {
      if (this.child) this.child.kill('SIGKILL');
    } catch (_) {}
    this.scheduleRestart();
  }

  scheduleRestart() {
    if (this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.stopping = false;
      this.spawn();
    }, 1500);
  }

  async run(task) {
    try {
      if (task.type === 'voices') return await handleVoices(this, task);
      return await handleTts(this, task);
    } finally {
      if (this.recycleAfterTask) {
        this.recycleAfterTask = false;
        this.kill(`request-limit-${MAX_REQUESTS_PER_WORKER}`);
      }
    }
  }

  close() {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.child) this.child.kill('SIGKILL');
  }
}

function pickIdleWorker() {
  return workers.find(worker => worker.ready && !worker.busy && !worker.runActive) || null;
}

function drain() {
  while (requestQueue.length) {
    const worker = pickIdleWorker();
    if (!worker) return;
    const task = requestQueue.shift();
    clearQueuedTask(task);
    if (task.cancelled || (task.res && task.res.destroyed)) {
      continue;
    }
    task.started = true;
    worker.busy = true;
    worker.runActive = true;
    worker.run(task).catch(err => {
      if (task.res && !task.res.destroyed) {
        sendJsonError(task.res, 500, 'TTS 失败', err.message);
      }
    }).finally(() => {
      worker.runActive = false;
      worker.busy = false;
      drain();
    });
  }
}

function enqueue(task) {
  if (task.res && task.res.destroyed) return;
  if (requestQueue.length >= MAX_QUEUE_LENGTH) {
    sendJsonError(task.res, 503, 'TTS 队列已满', `最多排队 ${MAX_QUEUE_LENGTH} 个请求`);
    return;
  }
  task.started = false;
  task.cancelled = false;
  task.queueTimer = setTimeout(() => expireQueuedTask(task), QUEUE_TIMEOUT_MS);
  task.disconnectHandler = () => {
    if (task.started) return;
    task.cancelled = true;
    const index = requestQueue.indexOf(task);
    if (index >= 0) requestQueue.splice(index, 1);
    clearQueuedTask(task);
    drain();
  };
  task.res.once('close', task.disconnectHandler);
  requestQueue.push(task);
  drain();
}

function clearQueuedTask(task) {
  if (task.queueTimer) {
    clearTimeout(task.queueTimer);
    task.queueTimer = null;
  }
  if (task.disconnectHandler && task.res) {
    task.res.removeListener('close', task.disconnectHandler);
    task.disconnectHandler = null;
  }
}

function expireQueuedTask(task) {
  if (task.started || task.cancelled) return;
  const index = requestQueue.indexOf(task);
  if (index < 0) return;
  requestQueue.splice(index, 1);
  task.cancelled = true;
  clearQueuedTask(task);
  if (task.res && !task.res.destroyed) {
    sendJsonError(task.res, 503, 'TTS 排队超时', `排队超过 ${QUEUE_TIMEOUT_MS} 毫秒`);
  }
  drain();
}

async function handleTts(worker, task) {
  const audio = await worker.synthesize(task.text, task.voice, task.speed);
  if (task.res.destroyed) return;
  task.res.setHeader('Content-Type', 'audio/wav');
  task.res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  task.res.end(audio);
}

async function handleVoices(worker, task) {
  const voices = await worker.listVoices();
  if (task.res.destroyed) return;
  task.res.json({ success: true, data: voices });
}

for (let i = 0; i < WORKER_COUNT; i++) {
  workers.push(new WineWorker(i + 1));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/voices', (req, res) => {
  enqueue({ type: 'voices', res });
});

app.post('/api/tts', (req, res) => {
  const { text, voice, speed } = req.body;
  if (!text) return sendJsonError(res, 400, 'text 不能为空');
  enqueue({ type: 'tts', text, voice: voice || DEFAULT_VOICE, speed, res });
});

app.get('/api/tts/status', (req, res) => {
  res.json({
      queueLength: requestQueue.length,
      workerCount: workers.length,
      readyWorkers: workers.filter(w => w.ready).length,
      maxQueueLength: MAX_QUEUE_LENGTH,
      queueTimeoutMs: QUEUE_TIMEOUT_MS,
      workers: workers.map(w => ({
      name: w.name,
      ready: w.ready,
      busy: w.busy,
      pending: w.pending.size,
      runActive: w.runActive,
      completedRequests: w.completedRequests,
      maxRequests: MAX_REQUESTS_PER_WORKER
    }))
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`received ${signal}, stopping Wine workers`);
    for (const worker of workers) worker.close();
    process.exit(0);
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wine TTS 服务器已启动: http://localhost:${PORT}`);
  console.log(`model=${MODEL_DIR}`);
  console.log(`winePrefix=${WINEPREFIX}`);
  console.log(`workers=${WORKER_COUNT}`);
});
