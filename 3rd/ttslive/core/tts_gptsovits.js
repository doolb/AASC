const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const GPT_SOVITS_INPUT_DIR = 'D:\\tts\\GPT-SoVITS-v2pro-20250604\\output\\asr_input';

function scanReferenceAudios(baseDir) {
    const results = [];
    
    if (!fs.existsSync(baseDir)) {
        return results;
    }
    
    function scanDir(dir, relativePath = '') {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const item of items) {
            const fullPath = path.join(dir, item.name);
            const relPath = path.join(relativePath, item.name);
            
            if (item.isDirectory()) {
                scanDir(fullPath, relPath);
            } else if (item.name.endsWith('.wav')) {
                let promptText = '';
                const match = item.name.match(/[（(](.+)[）)]/);
                if (match) {
                    promptText = match[1];
                } else if (item.name.startsWith('【')) {
                    const emotionMatch = item.name.match(/【(.+?)】(.+)/);
                    if (emotionMatch) {
                        promptText = emotionMatch[2].replace(/\.wav$/, '');
                    }
                }
                
                results.push({
                    path: fullPath,
                    name: item.name,
                    promptText: promptText,
                    relativePath: relPath
                });
            }
        }
    }
    
    scanDir(baseDir);
    return results;
}

class GPTSoVITSTTS {
    constructor() {
        this.host = config.GPT_SOVITS_HOST;
        this.refAudio = config.GPT_SOVITS_REF_AUDIO;
        this.promptText = config.GPT_SOVITS_PROMPT_TEXT;
        this.textLang = config.GPT_SOVITS_TEXT_LANG;
        this.promptLang = config.GPT_SOVITS_PROMPT_LANG;
        this.outputDir = config.OUTPUT_DIR;
        this.referenceAudios = [];
        
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
        
        console.log(`\n🎙️ GPT-SoVITS TTS 初始化: ${this.host}`);
        
        this.referenceAudios = scanReferenceAudios(GPT_SOVITS_INPUT_DIR);
        
        if (this.referenceAudios.length > 0) {
            console.log(`\n📁 发现 ${this.referenceAudios.length} 个参考音频:\n`);
            this.referenceAudios.forEach((audio, index) => {
                console.log(`  [${index + 1}] ${audio.name}`);
                console.log(`      路径: ${audio.path}`);
                console.log(`      文本: ${audio.promptText || '(无)'}`);
                console.log('');
            });
        }
        
        if (this.refAudio) {
            console.log(`✅ 已配置参考音频: ${this.refAudio}`);
            console.log(`✅ 已配置参考文本: ${this.promptText || '(无)'}`);
        } else if (this.referenceAudios.length > 0) {
            console.log(`⚠️  未设置参考音频，请设置环境变量:`);
            console.log(`    set GPT_SOVITS_REF_AUDIO=<音频路径>`);
            console.log(`    set GPT_SOVITS_PROMPT_TEXT=<参考文本>`);
        }
        console.log('');
    }

    getReferenceAudios() {
        return this.referenceAudios;
    }

    setReference(audioPath, promptText) {
        this.refAudio = audioPath;
        this.promptText = promptText;
        console.log(`已更新参考音频: ${audioPath}`);
        console.log(`已更新参考文本: ${promptText}`);
    }

    synthesize(text, outputPath) {
        return new Promise((resolve, reject) => {
            if (!text || !text.trim()) {
                reject(new Error('文本为空'));
                return;
            }

            if (!this.refAudio) {
                reject(new Error('GPT-SoVITS 参考音频未设置，请设置 GPT_SOVITS_REF_AUDIO 环境变量'));
                return;
            }

            const requestBody = JSON.stringify({
                text: text,
                text_lang: this.textLang,
                ref_audio_path: this.refAudio,
                prompt_text: this.promptText,
                prompt_lang: this.promptLang,
                text_split_method: 'cut5',
                batch_size: 1,
                speed_factor: 1.0,
                media_type: 'wav',
                streaming_mode: false
            });

            const url = new URL(`${this.host}/tts`);
            
            const options = {
                hostname: url.hostname,
                port: url.port || 9880,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                }
            };

            console.log(`  🔧 GPT-SoVITS 请求: POST ${this.host}/tts`);
            console.log(`  📝 文本: ${text}`);

            const req = http.request(options, (res) => {
                const chunks = [];
                
                res.on('data', (chunk) => {
                    chunks.push(chunk);
                });
                
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        const buffer = Buffer.concat(chunks);
                        fs.writeFileSync(outputPath, buffer);
                        resolve(outputPath);
                    } else {
                        const errorText = Buffer.concat(chunks).toString();
                        reject(new Error(`GPT-SoVITS 合成失败: ${res.statusCode} - ${errorText}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(new Error(`GPT-SoVITS 请求错误: ${err.message}`));
            });

            req.write(requestBody);
            req.end();
        });
    }

    async synthesizeToBuffer(text) {
        const tempFile = path.join(this.outputDir, `temp_gptsovits_${Date.now()}.wav`);
        
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
}

module.exports = GPTSoVITSTTS;
