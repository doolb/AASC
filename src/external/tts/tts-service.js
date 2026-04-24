const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(process.cwd(), 'res', 'uploads');
const TTS_DIR = path.join(UPLOADS_DIR, 'tts');

let ttsConfig = {
    serviceUrl: 'http://192.168.1.16:3000/api/tts',
    defaultVoice: 'Microsoft Xiaoxiao',
    defaultSpeed: 0
};

function init(config) {
    if (config) {
        if (config.serviceUrl) ttsConfig.serviceUrl = config.serviceUrl;
        if (config.defaultVoice) ttsConfig.defaultVoice = config.defaultVoice;
        if (config.defaultSpeed !== undefined) ttsConfig.defaultSpeed = config.defaultSpeed;
    }
    console.log(`[TTS] 服务地址: ${ttsConfig.serviceUrl}`);
    console.log(`[TTS] 默认语音: ${ttsConfig.defaultVoice}`);
}

function getConfig() {
    return { ...ttsConfig };
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
        
        const postData = JSON.stringify({
            text: text,
            voice: voice || ttsConfig.defaultVoice,
            speed: speed !== undefined ? speed : ttsConfig.defaultSpeed
        });
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = httpModule.request(options, (res) => {
            if (res.statusCode !== 200) {
                let errorData = '';
                res.on('data', chunk => errorData += chunk);
                res.on('end', () => {
                    reject(new Error(`TTS 服务返回错误: ${res.statusCode} - ${errorData}`));
                });
                return;
            }
            
            const writeStream = fs.createWriteStream(outputPath);
            res.pipe(writeStream);
            
            writeStream.on('finish', () => {
                resolve(outputPath);
            });
            
            writeStream.on('error', (err) => {
                reject(err);
            });
        });
        
        req.on('error', (err) => {
            reject(new Error(`TTS 服务连接失败: ${err.message}`));
        });
        
        req.write(postData);
        req.end();
    });
}

async function generateTTS(text, voice, speed) {
    if (!text) {
        throw new Error('text 不能为空');
    }
    
    const finalVoice = voice || ttsConfig.defaultVoice;
    const finalSpeed = speed !== undefined ? speed : ttsConfig.defaultSpeed;
    const outputPath = generateUniquePath();
    
    console.log(`[TTS] 生成: "${text}" | 语音: ${finalVoice} | 语速: ${finalSpeed}`);
    
    await callExternalTTS(text, voice, speed, outputPath);
    
    if (!fs.existsSync(outputPath)) {
        throw new Error('音频文件生成失败');
    }
    
    return outputPath;
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
