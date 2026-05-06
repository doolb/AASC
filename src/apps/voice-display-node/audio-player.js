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
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

class AudioPlayer {
    constructor() {
        this.isPlaying = false;
        this.stopRequested = false;
        this.currentProcess = null;
        this.tempDir = os.tmpdir();
        this.playQueue = [];
        this.isProcessingQueue = false;
        this.onPlayStart = null;
        this.onPlayEnd = null;
        /** @type {Function|null} 播放PCM数据回调，用于SpeexDSP AEC参考信号 */
        this.onPlayData = null;
    }

    /** 当前队列长度 */
    get queueLength() { return this.playQueue.length; }

    /**
     * 将音频URL加入播放队列
     * @param {string} url - 音频URL
     */
    queueURL(url) {
        this.stopRequested = false;
        this.playQueue.push({ type: 'url', url });
        console.log(`[音频队列] 加入队列，当前队列长度: ${this.playQueue.length}`);
        this.processQueue();
    }

    /**
     * 将音频Buffer加入播放队列
     * @param {Buffer} wavBuffer - WAV格式音频数据
     */
    queueBuffer(wavBuffer) {
        this.stopRequested = false;
        this.playQueue.push({ type: 'buffer', buffer: wavBuffer });
        console.log(`[音频队列] 加入队列，当前队列长度: ${this.playQueue.length}`);
        this.processQueue();
    }

    /**
     * 处理播放队列
     */
    async processQueue() {
        if (this.isProcessingQueue) return;
        if (this.playQueue.length === 0) return;

        this.isProcessingQueue = true;

        if (this.onPlayStart) {
            this.onPlayStart();
        }

        while (this.playQueue.length > 0) {
            if (this.stopRequested) {
                console.log('[音频队列] 收到停止信号，退出队列处理');
                break;
            }

            const item = this.playQueue.shift();

            try {
                if (item.type === 'url') {
                    await this.playFromURL(item.url);
                } else if (item.type === 'buffer') {
                    await this.playWavBuffer(item.buffer);
                }
            } catch (error) {
                console.error('[音频队列] 播放失败:', error.message);
            }
        }

        this.isProcessingQueue = false;

        if (this.onPlayEnd) {
            this.onPlayEnd();
        }
    }

    /**
     * 清空播放队列
     */
    clearQueue() {
        this.playQueue = [];
        console.log('[音频队列] 已清空');
    }

    /**
     * 从WAV Buffer中提取PCM采样数据
     * @param {Buffer} wavBuffer
     * @returns {{ samples: Int16Array, sampleRate: number }}
     */
    extractPCMFromWav(wavBuffer) {
        if (wavBuffer.toString('ascii', 0, 4) !== 'RIFF') return null;
        const sampleRate = wavBuffer.readUInt32LE(24);
        const dataSize = wavBuffer.readUInt32LE(40);
        const dataStart = 44;
        const sampleCount = Math.floor(dataSize / 2);
        if (dataStart + dataSize > wavBuffer.length) return null;
        const samples = new Int16Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
            samples[i] = wavBuffer.readInt16LE(dataStart + i * 2);
        }
        return { samples, sampleRate };
    }

    async playFromURL(url) {
        try {
            this.isPlaying = true;

            console.log(`[音频] 正在下载: ${url}`);

            if (this.stopRequested) {
                this.isPlaying = false;
                console.log('[音频] 跳过播放（已停止）');
                return;
            }
            const fetchOptions = {};
            if (url.startsWith('https://')) {
                fetchOptions.agent = httpsAgent;
            }

            const response = await fetch(url, fetchOptions);
            if (!response.ok) {
                throw new Error(`下载音频失败: HTTP ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            console.log(`[音频] 下载完成 (${buffer.length} bytes)`);

            if (this.onPlayData) {
                const pcm = this.extractPCMFromWav(buffer);
                if (pcm) {
                    this.onPlayData(pcm.samples, pcm.sampleRate);
                }
            }

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
        if (this.onPlayData) {
            const pcm = this.extractPCMFromWav(wavBuffer);
            if (pcm) {
                this.onPlayData(pcm.samples, pcm.sampleRate);
            }
        }

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
        this.isProcessingQueue = false;
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
