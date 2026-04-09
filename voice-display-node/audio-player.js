/**
 * 音频播放器模块
 * 使用系统命令播放音频，无需编译原生模块
 * 
 * Windows: 使用 PowerShell 的 Start-SoundFile
 * macOS: 使用 afplay
 * Linux: 使用 aplay 或 paplay
 */

const { exec } = require('child_process');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const os = require('os');

class AudioPlayer {
    constructor() {
        this.isPlaying = false;
        this.stopRequested = false;
        this.currentProcess = null;
        this.tempDir = os.tmpdir();
    }

    /**
     * 从URL播放音频
     * @param {string} url - 音频URL
     * @returns {Promise<void>}
     */
    async playFromURL(url) {
        try {
            this.stopRequested = false;
            this.isPlaying = true;

            console.log(`[音频] 正在下载: ${url}`);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`下载音频失败: HTTP ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            console.log(`[音频] 下载完成 (${buffer.length} bytes)`);
            
            const tempFile = path.join(this.tempDir, `audio_${Date.now()}.wav`);
            fs.writeFileSync(tempFile, buffer);
            
            await this.playFile(tempFile);
            
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {
                // 忽略删除失败
            }
        } catch (error) {
            this.isPlaying = false;
            throw error;
        }
    }

    /**
     * 播放本地音频文件
     * @param {string} filePath - 音频文件路径
     * @returns {Promise<void>}
     */
    playFile(filePath) {
        return new Promise((resolve, reject) => {
            if (this.stopRequested) {
                this.isPlaying = false;
                resolve();
                return;
            }

            const platform = os.platform();
            let command;
            let args = [];

            if (platform === 'win32') {
                command = 'powershell';
                args = [
                    '-c',
                    `(New-Object Media.SoundPlayer "${filePath}").PlaySync()`
                ];
            } else if (platform === 'darwin') {
                command = 'afplay';
                args = [filePath];
            } else {
                command = 'aplay';
                args = [filePath];
            }

            console.log(`[音频] 使用系统播放器: ${command} ${args.join(' ')}`);

            this.currentProcess = exec(
                `"${command}" ${args.map(a => `"${a}"`).join(' ')}`,
                { windowsHide: true },
                (error, stdout, stderr) => {
                    this.currentProcess = null;
                    this.isPlaying = false;
                    
                    if (this.stopRequested) {
                        console.log('[音频] 播放已停止');
                        resolve();
                        return;
                    }
                    
                    if (error && !error.killed) {
                        console.error('[音频] 播放错误:', error.message);
                        reject(error);
                        return;
                    }
                    
                    console.log('[音频] 播放完成');
                    resolve();
                }
            );
        });
    }

    /**
     * 播放WAV格式的Buffer
     * @param {Buffer} wavBuffer - WAV格式的音频数据
     * @returns {Promise<void>}
     */
    async playWavBuffer(wavBuffer) {
        const tempFile = path.join(this.tempDir, `audio_${Date.now()}.wav`);
        fs.writeFileSync(tempFile, wavBuffer);
        
        try {
            await this.playFile(tempFile);
        } finally {
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {
                // 忽略删除失败
            }
        }
    }

    /**
     * 停止播放
     */
    stop() {
        this.stopRequested = true;
        
        if (this.currentProcess) {
            try {
                this.currentProcess.kill();
                this.currentProcess = null;
            } catch (error) {
                console.error('[音频] 停止播放时出错:', error.message);
            }
        }
        
        this.isPlaying = false;
        console.log('[音频] 已停止播放');
    }

    /**
     * 检查是否正在播放
     * @returns {boolean}
     */
    isCurrentlyPlaying() {
        return this.isPlaying;
    }

    /**
     * 等待播放完成
     * @param {number} timeout - 超时时间（毫秒）
     * @returns {Promise<void>}
     */
    async waitForCompletion(timeout = 60000) {
        const startTime = Date.now();
        
        while (this.isPlaying && !this.stopRequested) {
            if (Date.now() - startTime > timeout) {
                this.stop();
                throw new Error('播放超时');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}

module.exports = AudioPlayer;
