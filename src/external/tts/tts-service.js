const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');

const UPLOADS_DIR = path.join(process.cwd(), 'res', 'uploads');
const TTS_DIR = path.join(UPLOADS_DIR, 'tts');

let ttsConfig = {
    serviceUrl: 'http://192.168.1.16:3000/api/tts',
    defaultVoice: 'Microsoft Xiaoxiao',
    defaultSpeed: 0,
    requestTimeoutMs: 20000,
    extraTimeoutPerPending: 10000,
    maxErrorBytes: 64 * 1024
};

let pendingRequests = 0;

function init(config) {
    if (config) {
        if (config.serviceUrl) ttsConfig.serviceUrl = config.serviceUrl;
        if (config.defaultVoice) ttsConfig.defaultVoice = config.defaultVoice;
        if (config.defaultSpeed !== undefined) ttsConfig.defaultSpeed = config.defaultSpeed;
        if (config.requestTimeoutMs !== undefined) {
            ttsConfig.requestTimeoutMs = Math.max(1000, Number(config.requestTimeoutMs) || 20000);
        }
        if (config.extraTimeoutPerPending !== undefined) {
            ttsConfig.extraTimeoutPerPending = Math.max(0, Number(config.extraTimeoutPerPending) || 10000);
        }
        if (config.maxErrorBytes !== undefined) {
            ttsConfig.maxErrorBytes = Math.max(1024, Number(config.maxErrorBytes) || 64 * 1024);
        }
    }
    console.log(`[TTS] 服务地址: ${ttsConfig.serviceUrl}`);
    console.log(`[TTS] 默认语音: ${ttsConfig.defaultVoice}`);
}

function getConfig() {
    return { ...ttsConfig, pendingRequests };
}

function generateUniquePath() {
    if (!fs.existsSync(TTS_DIR)) {
        fs.mkdirSync(TTS_DIR, { recursive: true });
    }
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return path.join(TTS_DIR, `tts_${timestamp}_${random}.wav`);
}

function callExternalTTS(text, voice, speed, outputPath) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(ttsConfig.serviceUrl);
        const isHttps = urlObj.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        let settled = false;
        let req = null;

        const postData = JSON.stringify({
            text: text,
            voice: voice || ttsConfig.defaultVoice,
            speed: speed !== undefined ? speed : ttsConfig.defaultSpeed
        });
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: `${urlObj.pathname}${urlObj.search || ''}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        function safeUnlink(filePath) {
            if (!filePath || !fs.existsSync(filePath)) {
                return;
            }
            try {
                fs.unlinkSync(filePath);
            } catch (error) {
            }
        }

        function done(error, resultPath) {
            if (settled) {
                return;
            }
            settled = true;

            if (error) {
                safeUnlink(outputPath);
                reject(error);
                return;
            }

            resolve(resultPath);
        }

        req = httpModule.request(options, (res) => {

            if (res.statusCode !== 200) {
                let errorData = '';
                let truncated = false;
                let received = 0;

                res.on('data', chunk => {
                    received += chunk.length;
                    if (received > ttsConfig.maxErrorBytes) {
                        if (!truncated) {
                            errorData += chunk.toString('utf8', 0, Math.max(0, ttsConfig.maxErrorBytes - (received - chunk.length)));
                            truncated = true;
                        }
                        return;
                    }
                    errorData += chunk;
                });
                res.on('end', () => {
                    const suffix = truncated ? '...(truncated)' : '';
                    done(new Error(`TTS 服务返回错误: ${res.statusCode} - ${errorData}${suffix}`));
                });
                return;
            }

            const writeStream = fs.createWriteStream(outputPath);

            pipeline(res, writeStream, (error) => {
                if (error) {
                    done(new Error(`TTS 音频写入失败: ${error.message}`));
                    return;
                }
                done(null, outputPath);
            });
        });

        const queueAhead = Math.max(0, pendingRequests - 1);
        const effectiveTimeout = ttsConfig.requestTimeoutMs + queueAhead * ttsConfig.extraTimeoutPerPending;
        req.setTimeout(effectiveTimeout, () => {
            req.destroy(new Error(`TTS 请求超时(${effectiveTimeout}ms)`));
        });

        req.on('error', (err) => {
            const errorPrefix = err.message && err.message.includes('超时')
                ? ''
                : 'TTS 服务连接失败: ';
            done(new Error(`${errorPrefix}${err.message}`));
        });

        req.write(postData);
        req.end();
    });
}

async function generateTTS(text, voice, speed) {
    if (!text) {
        throw new Error('text 不能为空');
    }

    pendingRequests++;
    try {
        const finalVoice = voice || ttsConfig.defaultVoice;
        const finalSpeed = speed !== undefined ? speed : ttsConfig.defaultSpeed;
        const outputPath = generateUniquePath();

        console.log(`[TTS] 生成: "${text}" | 语音: ${finalVoice} | 语速: ${finalSpeed} | 排队: ${pendingRequests - 1}`);

        await callExternalTTS(text, voice, speed, outputPath);

        if (!fs.existsSync(outputPath)) {
            throw new Error('音频文件生成失败');
        }

        return outputPath;
    } finally {
        pendingRequests--;
    }
}

function cleanupOldTtsFiles() {
    if (!fs.existsSync(TTS_DIR)) return;
    
    try {
        const files = fs.readdirSync(TTS_DIR);
        const ttsFiles = files.filter(f => f.startsWith('tts_') && f.endsWith('.wav'));
        const now = Date.now();
        const maxAge = 10 * 60 * 1000;
        
        ttsFiles.forEach(f => {
            const filePath = path.join(TTS_DIR, f);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
                console.log(`[TTS] 清理旧文件: ${f}`);
            }
        });
    } catch (err) {
        console.error('[TTS] 清理旧文件失败:', err.message);
    }
}

module.exports = {
    init,
    generateTTS,
    cleanupOldTtsFiles,
    getConfig
};
