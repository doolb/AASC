const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const audioCache = require('./tts-audio-cache');

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
// 只迁移清理启动前遗留的 WAV，清理完成后定时任务不再扫描磁盘。
let legacyCleanupPending = true;

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
        if (config.audioCacheMaxMiB !== undefined) {
            audioCache.configure(config.audioCacheMaxMiB);
        }
    }
    console.log(`[TTS] 服务地址: ${ttsConfig.serviceUrl}`);
    console.log(`[TTS] 默认语音: ${ttsConfig.defaultVoice}`);
}

function getConfig() {
    return { ...ttsConfig, audioCacheMaxMiB: audioCache.limits.maxMiB, pendingRequests };
}

// 上游响应只保存在内存；成功结束后才发布音频引用，半成品不进入缓存。
function callExternalTTS(text, voice, speed) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(ttsConfig.serviceUrl);
        const isHttps = urlObj.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        const postData = JSON.stringify({
            text,
            voice: voice || ttsConfig.defaultVoice,
            speed: speed !== undefined ? speed : ttsConfig.defaultSpeed
        });
        let settled = false;
        let response = null;
        let chunks = [];
        let received = 0;
        const req = httpModule.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: `${urlObj.pathname}${urlObj.search || ''}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        });

        function done(error, buffer) {
            if (settled) return;
            settled = true;
            chunks = [];
            if (error) {
                response?.destroy();
                req.destroy();
                reject(error);
                return;
            }
            resolve(buffer);
        }

        req.on('response', (res) => {
            response = res;
            const success = res.statusCode === 200;
            const limit = success ? audioCache.limits.maxAudioBytes : ttsConfig.maxErrorBytes;
            res.on('error', (error) => done(new Error(`TTS 音频接收失败: ${error.message}`)));
            res.on('aborted', () => done(new Error('TTS 响应在完成前已中断')));
            if (success && Number(res.headers['content-length']) > limit) {
                done(new Error('TTS 单段音频超过 16MiB 上限'));
                return;
            }
            res.on('data', (chunk) => {
                if (settled) return;
                const remaining = limit - received;
                if (chunk.length > remaining) {
                    if (success) {
                        done(new Error('TTS 单段音频超过 16MiB 上限'));
                    } else {
                        chunks.push(chunk.subarray(0, remaining));
                        const detail = Buffer.concat(chunks).toString('utf8');
                        done(new Error(`TTS 服务返回错误: ${res.statusCode} - ${detail}...(truncated)`));
                    }
                    return;
                }
                chunks.push(chunk);
                received += chunk.length;
            });
            res.on('end', () => {
                if (settled) return;
                if (!res.complete) {
                    done(new Error('TTS 音频响应不完整'));
                    return;
                }
                const buffer = Buffer.concat(chunks, received);
                if (!success) {
                    done(new Error(`TTS 服务返回错误: ${res.statusCode} - ${buffer.toString('utf8')}`));
                    return;
                }
                done(null, buffer);
            });
        });

        const queueAhead = Math.max(0, pendingRequests - 1);
        const effectiveTimeout = ttsConfig.requestTimeoutMs + queueAhead * ttsConfig.extraTimeoutPerPending;
        req.setTimeout(effectiveTimeout, () => req.destroy(new Error(`TTS 请求超时(${effectiveTimeout}ms)`)));
        req.on('error', (error) => {
            const prefix = error.message?.includes('超时') ? '' : 'TTS 服务连接失败: ';
            done(new Error(`${prefix}${error.message}`));
        });
        req.end(postData);
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

        console.log(`[TTS] 生成: "${text}" | 语音: ${finalVoice} | 语速: ${finalSpeed} | 排队: ${pendingRequests - 1}`);

        const buffer = await callExternalTTS(text, voice, speed);
        return audioCache.storeAudio(buffer);
    } finally {
        pendingRequests--;
    }
}

function cleanupOldTtsFiles() {
    audioCache.cleanup();
    if (!legacyCleanupPending) return;
    if (!fs.existsSync(TTS_DIR)) {
        legacyCleanupPending = false;
        return;
    }
    
    try {
        const files = fs.readdirSync(TTS_DIR);
        const ttsFiles = files.filter(f => /^tts_[0-9]+_[a-z0-9]+\.wav$/.test(f));
        let removed = 0;
        let remaining = 0;
        const now = Date.now();
        const maxAge = 10 * 60 * 1000;
        
        ttsFiles.forEach(f => {
            const filePath = path.join(TTS_DIR, f);
            const stat = fs.lstatSync(filePath);
            if (!stat.isFile()) return;
            if (now - stat.mtimeMs <= maxAge) {
                remaining += 1;
                return;
            }
            fs.unlinkSync(filePath);
            removed += 1;
        });
        legacyCleanupPending = remaining > 0;
        if (removed) console.log(`[TTS] 清理历史磁盘音频: ${removed} 个`);
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
