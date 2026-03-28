const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_WAV = path.join(process.cwd(), 'uploads/temp_tts.wav');

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

function callExternalTTS(text, voice, speed) {
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
    
    const finalVoice = voice || ttsConfig.defaultVoice;
    const finalSpeed = speed !== undefined ? speed : ttsConfig.defaultSpeed;
    console.log(`[TTS] 生成: "${text}" | 语音: ${finalVoice} | 语速: ${finalSpeed}`);
    
    cleanupTTS();
    
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
    try {
        if (fs.existsSync(OUTPUT_WAV)) {
            fs.unlinkSync(OUTPUT_WAV);
        }
    } catch (err) {
        console.error('[TTS] 清理临时文件失败:', err.message);
    }
}

module.exports = {
    init,
    generateTTS,
    getTTSAudioPath,
    cleanupTTS,
    getConfig
};
