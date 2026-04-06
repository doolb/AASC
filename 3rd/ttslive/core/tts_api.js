const fs = require('fs');
const path = require('path');
const config = require('../config');

class TTSApiWrapper {
    constructor() {
        this.serviceUrl = config.TTS_API_URL;
        this.defaultVoice = config.TTS_API_VOICE;
        this.defaultSpeed = config.TTS_API_SPEED;
        this.outputDir = config.OUTPUT_DIR;
        
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
        
        console.log(`\n🌐 TTS-API 初始化:`);
        console.log(`  服务地址: ${this.serviceUrl}`);
        console.log(`  默认语音: ${this.defaultVoice}`);
        console.log(`  默认语速: ${this.defaultSpeed}`);
        console.log('');
    }

    synthesize(text, outputPath) {
        return new Promise((resolve, reject) => {
            if (!text || !text.trim()) {
                reject(new Error('文本为空'));
                return;
            }

            const http = require('http');
            const https = require('https');
            
            const urlObj = new URL(this.serviceUrl);
            const isHttps = urlObj.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            
            const postData = JSON.stringify({
                text: text,
                voice: this.defaultVoice,
                speed: this.defaultSpeed
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
            
            console.log(`  🔧 TTS-API 请求: POST ${this.serviceUrl}`);
            console.log(`  📝 文本: ${text}`);
            console.log(`  🎤 语音: ${this.defaultVoice}`);
            
            const req = httpModule.request(options, (res) => {
                if (res.statusCode !== 200) {
                    let errorData = '';
                    res.on('data', chunk => errorData += chunk);
                    res.on('end', () => {
                        reject(new Error(`TTS-API 服务返回错误: ${res.statusCode} - ${errorData}`));
                    });
                    return;
                }
                
                const writeStream = fs.createWriteStream(outputPath);
                res.pipe(writeStream);
                
                writeStream.on('finish', () => {
                    console.log(`  ✅ TTS-API 完成: ${path.basename(outputPath)}`);
                    resolve(outputPath);
                });
                
                writeStream.on('error', (err) => {
                    reject(err);
                });
            });
            
            req.on('error', (err) => {
                reject(new Error(`TTS-API 服务连接失败: ${err.message}`));
            });
            
            req.write(postData);
            req.end();
        });
    }

    async synthesizeToBuffer(text) {
        const tempFile = path.join(this.outputDir, `temp_api_${Date.now()}.wav`);
        
        try {
            await this.synthesize(text, tempFile);
            const buffer = fs.readFileSync(tempFile);
            fs.unlinkSync(tempFile);
            return buffer;
        } catch (err) {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
            throw err;
        }
    }

    setVoice(voice) {
        this.defaultVoice = voice;
        console.log(`TTS-API 语音已更新: ${voice}`);
    }

    setSpeed(speed) {
        this.defaultSpeed = speed;
        console.log(`TTS-API 语速已更新: ${speed}`);
    }
}

module.exports = TTSApiWrapper;
