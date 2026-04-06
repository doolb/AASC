const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');

class TTSWrapper {
    constructor() {
        this.balconPath = config.BALCON_PATH;
        this.voice = config.BALCON_VOICE;
        this.outputDir = config.OUTPUT_DIR;
        
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
        
        console.log(`TTS 初始化: ${this.balconPath}, 语音: ${this.voice}`);
    }

    synthesize(text, outputPath) {
        return new Promise((resolve, reject) => {
            if (!text || !text.trim()) {
                reject(new Error('文本为空'));
                return;
            }

            const args = [
                '-n', this.voice,
                '-t', text,
                '-w', outputPath
            ];

            console.log(`  🔧 TTS 命令: "${this.balconPath}" ${args.map(a => `"${a}"`).join(' ')}`);

            const proc = spawn(this.balconPath, args, {
                windowsHide: true
            });

            let stderr = '';
            
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    resolve(outputPath);
                } else {
                    reject(new Error(`TTS 合成失败: ${stderr || `退出码 ${code}`}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`TTS 进程错误: ${err.message}`));
            });
        });
    }

    async synthesizeToBuffer(text) {
        const tempFile = path.join(this.outputDir, `temp_${Date.now()}.wav`);
        
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

    speak(text) {
        return new Promise((resolve, reject) => {
            if (!text || !text.trim()) {
                reject(new Error('文本为空'));
                return;
            }

            const args = [
                '-n', this.voice,
                '-t', text
            ];

            const proc = spawn(this.balconPath, args, {
                windowsHide: true
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`TTS 播放失败，退出码: ${code}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`TTS 进程错误: ${err.message}`));
            });
        });
    }
}

module.exports = TTSWrapper;
