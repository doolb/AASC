const express = require('express');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// ======= 配置区 =======
const BALCON_PATH = '.\\balcon\\balcon.exe'; // 请修改为实际路径
const DEFAULT_VOICE = 'Microsoft Xiaoxiao';

const CACHE_DIR = path.join(__dirname, 'audio_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

function tempOutputPath() {
  return path.join(CACHE_DIR, `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);
}

function cleanupStaleFiles() {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const now = Date.now();
    for (const f of files) {
      if (!f.startsWith('tts_') || !f.endsWith('.wav')) continue;
      const fp = path.join(CACHE_DIR, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > 300000) { // 5 分钟前的残留文件
        fs.unlinkSync(fp);
        console.log(`[TTS] 清理残留: ${f}`);
      }
    }
  } catch (_) {}
}
// ======================

// ======= 请求队列 =======
const ttsQueue = [];
let activeWorkers = 0;
const MAX_CONCURRENCY = 3;
let tagCounter = 0;
let currentTask = null;     // 当前处理中的文本（诊断用）
let processingSince = 0;    // 开始处理的时间戳
const PROCESS_TIMEOUT_MS = 300000; // 单次处理超时（含 balcon 耗时）

function sendJsonError(res, statusCode, message, details) {
  if (res.headersSent) {
    return;
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    details
  });
}

function processQueue() {
  if (activeWorkers >= MAX_CONCURRENCY || ttsQueue.length === 0) {
    return;
  }

  activeWorkers++;
  const { text, voice, speed, res } = ttsQueue.shift();
  const tag = `[${(++tagCounter) + Date.now().toString(36).slice(-4)}]`;

  // 客户端已断连，跳过
  if (res.destroyed) { console.log(`${tag} skip: destroyed`); activeWorkers--; processQueue(); return; }

  let released = false;
  let releaseTimer = null;
  let disconnectCleanup = null;

  function releaseQueue() {
    if (released) return;
    released = true;
    if (releaseTimer) clearTimeout(releaseTimer);
    if (disconnectCleanup) disconnectCleanup();
    console.log(`${tag} releaseQueue`);
    activeWorkers--;
    processQueue();
  }

  // 出队后若已断连，跳过
  if (res.destroyed) { console.log(`${tag} close_missed`); releaseQueue(); return; }

  // 监听底层 TCP 断连，释放队列（比 res.on('close') 更可靠，在响应开始前也能触发）
  const sock = res.socket || (res.req && res.req.socket) || null;
  const onDisconnect = () => {
    if (!released) {
      console.log(`${tag} exit: disconnect`);
      currentTask = null;
      releaseQueue();
    }
  };
  if (sock && !sock.destroyed) {
    sock.once('close', onDisconnect);
    disconnectCleanup = () => sock.removeListener('close', onDisconnect);
  }

  const processTask = async () => {
    const outputPath = tempOutputPath();
    currentTask = text;
    processingSince = Date.now();

    function safeCleanup() {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
    }

    try {
      const finalVoice = voice || DEFAULT_VOICE;
      console.log(`${tag} "${text.slice(0, 50)}..." | voice=${finalVoice} | queue=${ttsQueue.length}`);

      await runBalcon(text, voice, speed, outputPath);

      if (res.destroyed) { console.log(`${tag} exit: balcon_ok_res_gone`); currentTask = null; safeCleanup(); releaseQueue(); return; }
      if (!fs.existsSync(outputPath)) { throw new Error('音频文件生成失败'); }

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

      const stream = fs.createReadStream(outputPath);
      stream.pipe(res);

      stream.on('end', () => { console.log(`${tag} exit: stream_end`); currentTask = null; safeCleanup(); releaseQueue(); });
      stream.on('error', () => { console.log(`${tag} exit: stream_err`); currentTask = null; safeCleanup(); releaseQueue(); });

      // 客户端断连时释放队列 — 流被 unpiped 后 'end' 可能永不触发
      res.on('close', () => {
        if (!released) {
          console.log(`${tag} exit: res_close`);
          currentTask = null;
          safeCleanup();
          releaseQueue();
        }
      });

    } catch (err) {
      console.log(`${tag} exit: catch(${err.message})`);
      safeCleanup();
      if (!res.destroyed) sendJsonError(res, 500, 'TTS 失败', err.message);
      currentTask = null;
      releaseQueue();
    }
  };

  processTask();

  // 处理超时兜底：超过 PROCESS_TIMEOUT_MS 强制释放队列
  releaseTimer = setTimeout(() => {
    if (!released) {
      console.log(`${tag} exit: processing_timeout`);
      currentTask = null;
      releaseQueue();
    }
  }, PROCESS_TIMEOUT_MS);
}
// ========================

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * 修改：增加 speed 参数
 */
async function runBalcon(text, voice, speed, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ['-t', text, '-w', outputPath];

    if (voice) args.push('-n', voice);
    else args.push('-n', DEFAULT_VOICE);

    const rate = parseInt(speed) || 0;
    args.push('-s', String(rate));

    const child = spawn(BALCON_PATH, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`balcon 异常退出 code=${code} signal=${signal}`));
    });
  });
}

// 获取语音列表
app.get('/api/voices', async (req, res) => {
  try {
    const child = spawn(BALCON_PATH, ['-l'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', c => stdout += c);
    child.on('error', err => sendJsonError(res, 500, '获取语音列表失败', err.message));
    child.on('exit', () => {
      const lines = stdout.trim().split(/\r?\n/);
      const voices = [];
      for (const line of lines) {
        if (line.startsWith(' ') || line.startsWith('\t')) {
          const name = line.trim();
          if (name) voices.push(name);
        }
      }
      res.json({ success: true, data: voices });
    });
  } catch (err) {
    sendJsonError(res, 500, '获取语音列表失败', err.message);
  }
});

// TTS 接口
app.post('/api/tts', (req, res) => {
  const { text, voice, speed } = req.body;

  if (!text) {
    return sendJsonError(res, 400, 'text 不能为空');
  }

  console.log(`[TTS] 加入队列: "${text}" | 当前队列长度: ${ttsQueue.length + 1}`);

  ttsQueue.push({ text, voice, speed, res });
  processQueue();
});

// 队列状态诊断接口
app.get('/api/tts/status', (req, res) => {
  res.json({
    queueLength: ttsQueue.length,
    activeWorkers,
    maxConcurrency: MAX_CONCURRENCY,
    currentTask: currentTask ? currentTask.slice(0, 120) : null,
    processingElapsed: processingSince ? Date.now() - processingSince : 0,
    processingTimeoutMs: PROCESS_TIMEOUT_MS
  });
});

// 启动时清理残留，每小时扫一次
cleanupStaleFiles();
setInterval(cleanupStaleFiles, 3600000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
});
