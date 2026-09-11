/**
 * 音频录制器模块
 * 支持麦克风录音、VAD静音检测、WAV编码
 * 使用 naudiodon (PortAudio) 进行音频录制，无需 ffmpeg
 */

const naudiodon = require('naudiodon');

class AudioRecorder {
    /**
     * @param {Object} options - 配置选项
     * @param {number} options.sampleRate - 采样率 (默认 16000)
     * @param {number} options.vadThreshold - VAD 静音阈值 (默认 0.01)
     * @param {number} options.minSpeechDuration - 兼容旧配置，等同于最短语音时长 ms
     * @param {number} options.vadSilenceDurationMs - 结束语音前需要持续静音的时长 (默认 500)
     * @param {number} options.vadMinSpeechDurationMs - 最短语音片段时长 (默认 300)
     */
    constructor(options = {}) {
        this.sampleRate = options.sampleRate || 16000;
        this.vadThreshold = 0.01;
        this.vadSilenceDurationMs = 500;
        this.vadMinSpeechDurationMs = 300;
        this.minSpeechDuration = 300;
        this.setVadConfig(options);
        
        this.recording = false;
        this.paused = false;
        this.audioInput = null;

        /** @type {Function|null} 语音开始回调（cut 模式用） */
        this.onSpeechStart = null;
        /** @type {Function|null} VAD 完成回调（cut 模式用） */
        this.onVadSpeech = null;
    }

    /**
     * 获取可用的音频输入设备列表
     * @returns {Array}
     */
    static getDevices() {
        return naudiodon.getDevices().filter(device => device.maxInputChannels > 0);
    }

    /**
     * 开始录音
     * @param {Function} onAudioData - 音频数据回调函数，接收 WAV Buffer
     * @param {Object} signals - 信号对象
     * @param {AbortSignal} signals.stopSignal - 停止信号
     * @returns {Promise<void>}
     */
    async start(onAudioData, signals = {}) {
        if (this.recording) {
            throw new Error('录音已在进行中');
        }

        this.recording = true;

        console.log('[录音] 开始录音...');

        const frameDurationMs = 20;
        const framesPerBuffer = Math.floor(this.sampleRate * frameDurationMs / 1000);
        let hasSpeech = false;
        let speechSamples = [];
        let speechVoiceSamples = [];
        let silenceFrameCount = 0;
        let speechStartAt = null;

        const processAudioData = (int16Samples) => {
            const rms = this.computeRMS(int16Samples);

            if (rms >= this.vadThreshold) {
                if (!hasSpeech) {
                    speechStartAt = Date.now();
                    if (this.onSpeechStart) {
                        this.onSpeechStart();
                    }
                }
                hasSpeech = true;
                speechSamples.push(...int16Samples);
                speechVoiceSamples.push(...int16Samples);
                silenceFrameCount = 0;
            } else if (hasSpeech) {
                speechSamples.push(...int16Samples);
                silenceFrameCount++;

                if (silenceFrameCount >= this.getSilenceFramesNeeded(frameDurationMs)) {
                    if (speechVoiceSamples.length >= this.getMinSpeechSamples()) {
                        const wavData = this.encodeWAV(speechSamples, this.sampleRate);
                        this.emitAudioSegment(onAudioData, wavData, speechStartAt);
                    }
                    speechSamples = [];
                    speechVoiceSamples = [];
                    hasSpeech = false;
                    silenceFrameCount = 0;
                    speechStartAt = null;
                }
            }
        };

        return new Promise((resolve, reject) => {
            try {
                this.audioInput = new naudiodon.AudioIO({
                    inOptions: {
                        channelCount: 1,
                        sampleFormat: naudiodon.SampleFormat16Bit,
                        sampleRate: this.sampleRate,
                        deviceId: -1,
                        closeOnError: true
                    }
                });

                let bufferQueue = Buffer.alloc(0);

                this.audioInput.on('data', (data) => {
                    if (!this.recording) return;

                    if (this.paused) {
                        hasSpeech = false;
                        speechSamples = [];
                        speechVoiceSamples = [];
                        silenceFrameCount = 0;
                        speechStartAt = null;
                        return;
                    }

                    bufferQueue = Buffer.concat([bufferQueue, data]);

                    const bytesPerFrame = 2;
                    const frameSize = framesPerBuffer * bytesPerFrame;

                    while (bufferQueue.length >= frameSize) {
                        const frameBuffer = bufferQueue.slice(0, frameSize);
                        bufferQueue = bufferQueue.slice(frameSize);

                        const int16Samples = [];
                        for (let i = 0; i < frameBuffer.length; i += 2) {
                            int16Samples.push(frameBuffer.readInt16LE(i));
                        }

                        processAudioData(int16Samples);
                    }
                });

                this.audioInput.on('error', (err) => {
                    console.error('[录音] 录音错误:', err.message);
                    this.recording = false;
                    reject(err);
                });

                this.audioInput.on('close', () => {
                    this.recording = false;
                    console.log('[录音] 录音已关闭');

                    if (hasSpeech && speechVoiceSamples.length >= this.getMinSpeechSamples()) {
                        const wavData = this.encodeWAV(speechSamples, this.sampleRate);
                        this.emitAudioSegment(onAudioData, wavData, speechStartAt);
                    }

                    resolve();
                });

                if (signals.stopSignal) {
                    signals.stopSignal.addEventListener('abort', () => {
                        this.stop();
                    });
                }

                this.audioInput.start();
                console.log('[录音] 录音已启动');

            } catch (error) {
                this.recording = false;
                console.error('[录音] 初始化失败:', error.message);
                reject(error);
            }
        });
    }

    /**
     * 停止录音
     */
    stop() {
        if (!this.recording) return;

        this.recording = false;

        if (this.audioInput) {
            try {
                this.audioInput.quit();
                this.audioInput = null;
            } catch (error) {
                console.error('[录音] 停止录音时出错:', error.message);
            }
        }

        console.log('[录音] 已停止录音');
    }

    /**
     * 检查是否正在录音
     * @returns {boolean}
     */
    isRecording() {
        return this.recording;
    }

    pause() {
        this.paused = true;
        console.log('[录音] 已暂停');
    }

    resume() {
        this.paused = false;
        console.log('[录音] 已恢复');
    }

    isPaused() {
        return this.paused;
    }

    /**
     * 更新 VAD 配置；服务端重连或控制端调整参数时可以即时生效。
     * @param {Object} config - 服务端下发的 VAD 配置
     */
    setVadConfig(config = {}) {
        const threshold = Number(config.threshold ?? config.vadThreshold);
        if (Number.isFinite(threshold)) {
            this.vadThreshold = Math.min(0.2, Math.max(0.001, threshold));
        }

        const silenceDuration = Number(config.silenceDurationMs ?? config.vadSilenceDurationMs);
        if (Number.isFinite(silenceDuration)) {
            this.vadSilenceDurationMs = Math.min(5000, Math.max(100, Math.round(silenceDuration)));
        }

        const minSpeechDuration = Number(
            config.minSpeechDurationMs ?? config.vadMinSpeechDurationMs ?? config.minSpeechDuration
        );
        if (Number.isFinite(minSpeechDuration)) {
            this.vadMinSpeechDurationMs = Math.min(5000, Math.max(100, Math.round(minSpeechDuration)));
        }
        // 保留旧属性，避免现有 cut/soft 模式代码读取时行为改变。
        this.minSpeechDuration = this.vadMinSpeechDurationMs;
    }

    getSilenceFramesNeeded(frameDurationMs) {
        return Math.max(1, Math.ceil(this.vadSilenceDurationMs / frameDurationMs));
    }

    getMinSpeechSamples() {
        return Math.max(1, Math.floor(this.vadMinSpeechDurationMs * this.sampleRate / 1000));
    }

    emitAudioSegment(onAudioData, wavData, speechStartAt) {
        const speechEndAt = Date.now();
        const timing = Number.isFinite(speechStartAt)
            ? { speechStartAt, speechEndAt }
            : {};
        onAudioData(wavData, timing);
        if (this.onVadSpeech) {
            this.onVadSpeech(wavData, timing);
        }
    }

    /**
     * 计算 RMS 音量
     * @param {Int16Array|number[]} samples - 音频采样
     * @returns {number}
     */
    computeRMS(samples) {
        if (!samples || samples.length === 0) return 0;

        let sumSquares = 0;
        for (const s of samples) {
            const v = s / 32768.0;
            sumSquares += v * v;
        }

        return Math.sqrt(sumSquares / samples.length);
    }

    /**
     * 编码 WAV 格式
     * @param {Int16Array|number[]} samples - 音频采样
     * @param {number} sampleRate - 采样率
     * @returns {Buffer}
     */
    encodeWAV(samples, sampleRate) {
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * bitsPerSample / 8;
        const blockAlign = numChannels * bitsPerSample / 8;
        const dataSize = samples.length * 2;

        const buffer = Buffer.alloc(44 + dataSize);

        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + dataSize, 4);
        buffer.write('WAVE', 8);

        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);
        buffer.writeUInt16LE(1, 20);
        buffer.writeUInt16LE(numChannels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(byteRate, 28);
        buffer.writeUInt16LE(blockAlign, 32);
        buffer.writeUInt16LE(bitsPerSample, 34);

        buffer.write('data', 36);
        buffer.writeUInt32LE(dataSize, 40);

        for (let i = 0; i < samples.length; i++) {
            buffer.writeInt16LE(samples[i], 44 + i * 2);
        }

        return buffer;
    }
}

module.exports = AudioRecorder;
