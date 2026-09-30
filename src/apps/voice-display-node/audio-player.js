/**
 * 音频播放器模块
 * 使用系统命令播放音频，无需编译原生模块
 * 
 * Windows: PowerShell SoundPlayer 从 MemoryStream 播放
 * macOS: Buffer 使用 ffplay；显式本地文件仍支持 afplay
 * Linux: aplay 从标准输入播放 WAV
 */

const { spawn } = require('child_process');
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const os = require('os');

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

class AudioPlayer {
    constructor() {
        this.isPlaying = false;
        this.stopRequested = false;
        this.currentProcess = null;
        this.downloadController = null;
        this.playbackGeneration = 0;
        this.queueGeneration = 0;
        this.playQueue = [];
        this.isProcessingQueue = false;
        this.onPlayStart = null;
        this.onPlayEnd = null;
        // 队列完全空闲时通知需要等待整段播报结束的业务，例如 Windows 语音输入提示。
        this.onQueueIdle = null;
        /** @type {Function|null} 播放PCM数据回调，用于SpeexDSP AEC参考信号 */
        this.onPlayData = null;
    }

    /** 当前队列长度 */
    get queueLength() { return this.playQueue.length; }

    /**
     * 将音频URL加入播放队列
     * @param {string} url - 音频URL
     */
    queueURL(url, options = {}) {
        this.stopRequested = false;
        this.playQueue.push({
            type: 'url',
            url,
            onComplete: typeof options.onComplete === 'function' ? options.onComplete : null
        });
        console.log(`[音频队列] 加入队列，当前队列长度: ${this.playQueue.length}`);
        this.processQueue();
    }

    /**
     * 将音频Buffer加入播放队列
     * @param {Buffer} wavBuffer - WAV格式音频数据
     */
    queueBuffer(wavBuffer, options = {}) {
        this.stopRequested = false;
        this.playQueue.push({
            type: 'buffer',
            buffer: wavBuffer,
            onComplete: typeof options.onComplete === 'function' ? options.onComplete : null
        });
        console.log(`[音频队列] 加入队列，当前队列长度: ${this.playQueue.length}`);
        this.processQueue();
    }

    /**
     * 处理播放队列
     */
    async processQueue() {
        if (this.isProcessingQueue) return;
        if (this.playQueue.length === 0) return;

        const generation = this.queueGeneration;
        this.isProcessingQueue = true;

        if (this.onPlayStart) {
            this.onPlayStart();
        }

        while (this.playQueue.length > 0) {
            if (this.stopRequested || generation !== this.queueGeneration) {
                console.log('[音频队列] 收到停止信号，退出队列处理');
                break;
            }

            const item = this.playQueue.shift();
            let playbackError = null;

            try {
                if (item.type === 'url') {
                    await this.playFromURL(item.url);
                } else if (item.type === 'buffer') {
                    await this.playWavBuffer(item.buffer);
                }
            } catch (error) {
                playbackError = error;
                if (generation === this.queueGeneration) console.error('[音频队列] 播放失败:', error.message);
            }

            // 停止后旧下载/子进程的回调不再通知新播报，也不抢占新队列。
            if (generation !== this.queueGeneration) return;
            if (item.onComplete) {
                try {
                    item.onComplete(playbackError, this.playQueue.length === 0);
                } catch (error) {
                    console.error('[音频队列] 完成回调失败:', error.message);
                }
            }
        }

        if (generation !== this.queueGeneration) return;
        this.isProcessingQueue = false;

        if (this.onPlayEnd) {
            this.onPlayEnd();
        }
        if (generation === this.queueGeneration && !this.isProcessingQueue && this.playQueue.length === 0 && this.onQueueIdle) {
            this.onQueueIdle();
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
        if (!Buffer.isBuffer(wavBuffer) || wavBuffer.length < 12
            || wavBuffer.toString('ascii', 0, 4) !== 'RIFF'
            || wavBuffer.toString('ascii', 8, 12) !== 'WAVE') return null;
        let format = null;
        let pcmData = null;
        // WAV 可带额外 fmt/JUNK/LIST 块，不能假定音频永远从第44字节开始。
        for (let offset = 12; offset + 8 <= wavBuffer.length;) {
            const type = wavBuffer.toString('ascii', offset, offset + 4);
            const size = wavBuffer.readUInt32LE(offset + 4);
            const start = offset + 8;
            if (start + size > wavBuffer.length) return null;
            if (type === 'fmt ' && size >= 16) {
                format = { encoding: wavBuffer.readUInt16LE(start), channels: wavBuffer.readUInt16LE(start + 2),
                    sampleRate: wavBuffer.readUInt32LE(start + 4), bits: wavBuffer.readUInt16LE(start + 14) };
            }
            if (type === 'data') pcmData = wavBuffer.subarray(start, start + size);
            offset = start + size + (size % 2);
        }
        if (!format || !pcmData || format.encoding !== 1 || format.bits !== 16
            || format.channels < 1 || format.channels > 8 || !format.sampleRate) return null;
        const sampleCount = Math.floor(pcmData.length / (format.channels * 2));
        const samples = new Int16Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
            let sum = 0;
            for (let channel = 0; channel < format.channels; channel++) {
                sum += pcmData.readInt16LE((i * format.channels + channel) * 2);
            }
            samples[i] = Math.round(sum / format.channels);
        }
        return { samples, sampleRate: format.sampleRate };
    }

    async playFromURL(url) {
        const generation = this.playbackGeneration;
        if (this.stopRequested) return;
        const controller = new AbortController();
        this.downloadController = controller;
        this.isPlaying = true;
        console.log(`[音频] 正在下载: ${url}`);
        try {
            const response = await fetch(url, {
                signal: controller.signal, size: 16 * 1024 * 1024, timeout: 30000,
                ...(url.startsWith('https://') ? { agent: httpsAgent } : {})
            });
            if (!response.ok) {
                response.body?.destroy();
                throw new Error(`下载音频失败: HTTP ${response.status}`);
            }
            if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) {
                response.body?.destroy();
                throw new Error('下载音频超过16MiB上限');
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            if (generation !== this.playbackGeneration || this.stopRequested) return;
            console.log(`[音频] 下载完成 (${buffer.length} bytes)`);
            await this.playWavBuffer(buffer, generation);
        } finally {
            if (this.downloadController === controller) this.downloadController = null;
            if (generation === this.playbackGeneration) this.isPlaying = false;
        }
    }

    /** 显式本地文件仍可读取；TTS 的 URL/Buffer 路径不再创建文件。 */
    async playFile(filePath) {
        if (this.stopRequested) return;
        const generation = this.playbackGeneration;
        if (os.platform() === 'darwin') {
            this.isPlaying = true;
            return this.runPlayer('afplay', [filePath], null, generation);
        }
        return this.playWavBuffer(await fs.promises.readFile(filePath), generation);
    }

    /** 直接启动播放器并写标准输入，不经过 shell，也不将音频放进命令行。 */
    runPlayer(command, args, input, generation) {
        return new Promise((resolve, reject) => {
            if (this.stopRequested || generation !== this.playbackGeneration) { resolve(); return; }
            console.log(`[音频] 使用系统播放器: ${command}（内存输入）`);
            let settled = false;
            let detail = '';
            let inputError = null;
            const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
            this.currentProcess = child;
            const done = (error) => {
                if (settled) return;
                settled = true;
                if (this.currentProcess === child) this.currentProcess = null;
                if (generation === this.playbackGeneration) this.isPlaying = false;
                if (this.stopRequested || generation !== this.playbackGeneration) { resolve(); return; }
                if (error) { reject(error); return; }
                console.log('[音频] 播放完成');
                resolve();
            };
            child.on('error', (error) => done(new Error(`无法启动播放器 ${command}: ${error.message}`)));
            child.stderr.on('data', (chunk) => {
                if (detail.length < 4096) detail += chunk.toString('utf8').slice(0, 4096 - detail.length);
            });
            child.stdin.on('error', (error) => {
                inputError = error;
                child.kill();
            });
            child.on('close', (code, signal) => {
                const error = inputError || ((code !== 0 || signal)
                    ? new Error(`播放器 ${command} 退出失败 (${code ?? signal}): ${detail.trim()}`) : null);
                done(error);
            });
            child.stdin.end(input);
        });
    }

    /** WAV Buffer 直接送给系统播放器，并保留一次 PCM/AEC 参考信号回调。 */
    async playWavBuffer(wavBuffer, generation = this.playbackGeneration) {
        if (this.stopRequested || generation !== this.playbackGeneration) return;
        if (!Buffer.isBuffer(wavBuffer) || !wavBuffer.length || wavBuffer.length > 16 * 1024 * 1024) {
            throw new Error('播放音频为空或超过16MiB上限');
        }
        if (this.onPlayData) {
            const pcm = this.extractPCMFromWav(wavBuffer);
            if (pcm) this.onPlayData(pcm.samples, pcm.sampleRate);
        }
        if (this.stopRequested || generation !== this.playbackGeneration) return;
        this.isPlaying = true;
        const platform = os.platform();
        if (platform === 'win32') {
            // stdin 传base64避开命令行长度限制；SoundPlayer只读取MemoryStream。
            const script = [
                "$ErrorActionPreference='Stop'; $stream=$null; $player=$null;",
                'try { $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd());',
                '$stream=[IO.MemoryStream]::new($bytes,$false);',
                '$player=[System.Media.SoundPlayer]::new($stream); $player.Load(); $player.PlaySync(); }',
                'catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }',
                'finally { if ($player) { $player.Dispose() }; if ($stream) { $stream.Dispose() } }'
            ].join(' ');
            return this.runPlayer('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
                wavBuffer.toString('base64'), generation);
        }
        if (platform === 'darwin') {
            return this.runPlayer('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'error', '-i', 'pipe:0'], wavBuffer, generation);
        }
        return this.runPlayer('aplay', ['-q', '-t', 'wav'], wavBuffer, generation);
    }

    /**
     * 停止播放
     */
    stop() {
        const wasProcessingQueue = this.isProcessingQueue;
        this.stopRequested = true;
        this.playbackGeneration += 1;
        this.queueGeneration += 1;
        this.downloadController?.abort();
        this.downloadController = null;

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
        // 队列的旧异步结束已作废，在停止时同步通知恢复录音，避免一直暂停。
        if (wasProcessingQueue && this.onPlayEnd) this.onPlayEnd();
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
