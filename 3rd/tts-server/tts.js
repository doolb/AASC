const express = require('express');
const bodyParser = require('body-parser');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const app = express();
const PORT = 3000;

// ======= 配置区 =======
const BALCON_PATH = '.\\balcon\\balcon.exe'; // 请修改为实际路径
const DEFAULT_VOICE = 'Microsoft Xiaoxiao';

const CACHE_DIR = path.join(__dirname, 'audio_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);
const OUTPUT_WAV = path.join(CACHE_DIR, 'output.wav');
// ======================

const execFileAsync = util.promisify(execFile);

// ======= 请求队列 =======
const ttsQueue = [];
let isProcessing = false;

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
  if (isProcessing || ttsQueue.length === 0) {
    return;
  }

  isProcessing = true;
  const { text, voice, speed, res } = ttsQueue.shift();

  const processTask = async () => {
    try {
      const finalVoice = voice || DEFAULT_VOICE;
      console.log(`[TTS] 生成: "${text}" | 语音: ${finalVoice} | 语速: ${speed || 0} | 队列剩余: ${ttsQueue.length}`);

      if (fs.existsSync(OUTPUT_WAV)) {
        fs.unlinkSync(OUTPUT_WAV);
      }
      await runBalcon(text, voice, speed, OUTPUT_WAV);

      if (!fs.existsSync(OUTPUT_WAV)) {
        throw new Error('音频文件生成失败');
      }

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

      const stream = fs.createReadStream(OUTPUT_WAV);
      stream.pipe(res);

      stream.on('end', () => {
        isProcessing = false;
        processQueue();
      });

      stream.on('error', () => {
        isProcessing = false;
        processQueue();
      });

    } catch (err) {
      console.error('TTS 错误:', err);
      sendJsonError(res, 500, 'TTS 失败', err.message);
      isProcessing = false;
      processQueue();
    }
  };

  processTask();
}
// ========================

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * 修改：增加 speed 参数
 */
async function runBalcon(text, voice, speed, outputPath) {
  const args = ['-t', text, '-w', outputPath];
  
  // 语音设置
  if (voice) {
    args.push('-n', voice);
  } else {
    args.push('-n', DEFAULT_VOICE);
  }

  // 语速设置 (SAPI 5: -10 到 10)
  // 如果前端传了 speed，转换为整数。如果没传，默认为 0
  const rate = parseInt(speed) || 0;
  args.push('-s', String(rate));

  // balcon 参数说明：-s <integer>
  return await execFileAsync(BALCON_PATH, args);
}

// 获取语音列表 (不需要变动)
app.get('/api/voices', async (req, res) => {
  try {
    const { stdout } = await execFileAsync(BALCON_PATH, ['-l']);
    const lines = stdout.trim().split(/\r?\n/);
    const voices = [];
    for (const line of lines) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        const name = line.trim();
        if (name) voices.push(name);
      }
    }
    res.json({ success: true, data: voices });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器已启动: http://localhost:${PORT}`);
});
