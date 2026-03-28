const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_WAV = path.join(process.cwd(), 'uploads/temp_tts.wav');
const DEFAULT_VOICE = 'Microsoft Xiaoxiao';

let ttsServiceUrl = 'http://192.168.1.16:3000/api/tts';

function init(config) {
    if (config && config.ttsServiceUrl) {
        ttsServiceUrl = config.ttsServiceUrl;
    }
    console.log(`[TTS] 服务地址: ${ttsServiceUrl}`);
}

function getTtsServiceUrl() {
    return ttsServiceUrl;
}

function setTtsServiceUrl(url) {
    ttsServiceUrl = url;
    console.log(`[TTS] 服务地址已更新: ${ttsServiceUrl}`);
}

function callExternalTTS(text, voice, speed) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(ttsServiceUrl);
        const isHttps = urlObj.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        const postData = JSON.stringify({
            text: text,
            voice: voice || DEFAULT_VOICE,
            speed: speed || 0
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
            
            const writeStream = fs.createWriteStream(OUTPUT_WAV);
            res.pipe(writeStream);
            
            writeStream.on('finish', () => {
                resolve(OUTPUT_WAV);
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
    
    const finalVoice = voice || DEFAULT_VOICE;
    console.log(`[TTS] 生成: "${text}" | 语音: ${finalVoice} | 语速: ${speed || 0}`);
    
    await callExternalTTS(text, voice, speed);
    
    if (!fs.existsSync(OUTPUT_WAV)) {
        throw new Error('音频文件生成失败');
    }
    
    return OUTPUT_WAV;
}

function getTTSAudioPath() {
    return OUTPUT_WAV;
}

function cleanupTTS() {
    if (fs.existsSync(OUTPUT_WAV)) {
        fs.unlinkSync(OUTPUT_WAV);
    }
}

module.exports = {
    init,
    generateTTS,
    getTTSAudioPath,
    cleanupTTS,
    DEFAULT_VOICE,
    getTtsServiceUrl,
    setTtsServiceUrl
};
