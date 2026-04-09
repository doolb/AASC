/**
 * 音频播放器模块
 * 支持从URL下载并播放音频，支持WAV格式
 */

const Speaker = require('speaker');
const fetch = require('node-fetch');
const wav = require('wav');

class AudioPlayer {
    constructor() {
        this.speaker = null;
        this.isPlaying = false;
        this.stopRequested = false;
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
            
            await this.playWavBuffer(buffer);
        } catch (error) {
            this.isPlaying = false;
            throw error;
        }
    }

    /**
     * 播放WAV格式的Buffer
     * @param {Buffer} wavBuffer - WAV格式的音频数据
     * @returns {Promise<void>}
     */
    playWavBuffer(wavBuffer) {
        return new Promise((resolve, reject) => {
            if (this.stopRequested) {
                this.isPlaying = false;
                resolve();
                return;
            }

            const reader = new wav.Reader();
            
            reader.on('format', (format) => {
                if (this.stopRequested) {
                    this.isPlaying = false;
                    resolve();
                    return;
                }

                console.log(`[音频] 格式: ${format.sampleRate}Hz, ${format.channels}声道, ${format.bitDepth}bit`);

                this.speaker = new Speaker({
                    channels: format.channels,
                    bitDepth: format.bitDepth,
                    sampleRate: format.sampleRate
                });

                this.speaker.on('close', () => {
                    this.isPlaying = false;
                    this.speaker = null;
                    console.log('[音频] 播放完成');
                    resolve();
                });

                this.speaker.on('error', (err) => {
                    this.isPlaying = false;
                    this.speaker = null;
                    reject(err);
                });

                reader.pipe(this.speaker);
            });

            reader.on('error', (err) => {
                this.isPlaying = false;
                reject(err);
            });

            const bufferStream = require('stream').Readable.from(wavBuffer);
            bufferStream.pipe(reader);
        });
    }

    /**
     * 停止播放
     */
    stop() {
        this.stopRequested = true;
        
        if (this.speaker) {
            try {
                this.speaker.end();
                this.speaker = null;
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
