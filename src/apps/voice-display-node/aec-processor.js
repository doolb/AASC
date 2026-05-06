/**
 * AEC 处理器模块
 * 回声消除处理器，使用 NLMS 自适应滤波器算法
 *
 * 工作方式：
 *   麦克风信号 = 近端语音 + 回声（远端语音经过空间响应）
 *   AEC 通过自适应滤波器模拟回声路径，从麦克风信号中减去回声
 *
 * 输入：
 *   - micFrame:  麦克风采集的 int16 帧 (160 采样点 @ 16kHz = 10ms)
 *   - playFrame: 播放器输出的 int16 帧（参考信号）
 * 输出：
 *   - 消除回声后的干净语音 int16 帧
 */

class AECProcessor {
    /**
     * @param {Object} options
     * @param {number} options.sampleRate - 采样率 (默认 16000)
     * @param {number} options.frameSize - 帧大小 (默认 160 = 10ms)
     * @param {number} options.filterLength - 滤波器长度 (默认 1024, 约 64ms 回声尾长)
     * @param {number} options.mu - 自适应步长 (默认 0.1)
     */
    constructor(options = {}) {
        this.sampleRate = options.sampleRate || 16000;
        this.frameSize = options.frameSize || 160;
        this.filterLength = options.filterLength || 1024;
        this.mu = options.mu || 0.1;
        this.epsilon = 1e-6;

        // 自适应滤波器系数
        this.W = new Float64Array(this.filterLength);

        // 远端参考信号缓冲区
        this.playBuf = new Float64Array(this.filterLength + this.frameSize);

        // 近端信号缓冲区 (后 frameSize 个为当前帧)
        this.nearBuf = new Float64Array(this.frameSize * 2);

        // 播放帧队列（帧对齐缓冲）
        this.pendingPlayFrames = [];
        this.currentPlaySamples = [];
        this.micFrameBuffer = [];

        // 播放参考位置
        this.playWriteOffset = 0;

        // 统计
        this.processed = 0;
        this.erleSum = 0;
    }

    /**
     * 设置播放参考信号
     * 由 AudioPlayer 播放时调用
     * @param {Int16Array} samples - PCM 采样数据
     * @param {number} sampleRate - 采样率
     */
    setPlaybackReference(samples, sampleRate) {
        if (sampleRate !== this.sampleRate) {
            // 如果采样率不匹配，简单重采样（线性插值）
            samples = this._resample(samples, sampleRate, this.sampleRate);
        }

        // 分成 10ms 帧加入队列
        for (let i = 0; i < samples.length; i += this.frameSize) {
            const frame = samples.subarray(i, Math.min(i + this.frameSize, samples.length));
            if (frame.length === this.frameSize) {
                this.pendingPlayFrames.push(new Float64Array(frame));
            }
        }
    }

    /**
     * 处理一帧麦克风数据，返回消除回声后的音频
     * @param {Int16Array} micFrame - 麦克风 int16 帧 (160 采样点)
     * @returns {Int16Array|null} 干净音频帧，或 null（缺参考信号时）
     */
    process(micFrame) {
        // 将麦克风帧转换为 Float64
        const near = new Float64Array(micFrame.length);
        for (let i = 0; i < micFrame.length; i++) {
            near[i] = micFrame[i] / 32768.0;
        }

        // 取一帧播放参考信号
        const playFrame = this.pendingPlayFrames.shift();
        if (!playFrame) {
            // 无参考信号，不做 AEC，直接返回麦克风信号
            return micFrame;
        }

        // 将播放参考信号写入环形参考缓冲区
        for (let i = 0; i < playFrame.length; i++) {
            this.playBuf[this.playWriteOffset] = playFrame[i];
            this.playWriteOffset = (this.playWriteOffset + 1) % this.playBuf.length;
        }

        // 构建参考信号向量（从当前写指针倒推 filterLength 个采样点）
        const x = new Float64Array(this.filterLength);
        let idx = this.playWriteOffset;
        for (let i = 0; i < this.filterLength; i++) {
            idx = (idx - 1 + this.playBuf.length) % this.playBuf.length;
            x[i] = this.playBuf[idx];
        }

        // 自适应滤波：计算估计的回声
        let echoEst = 0;
        for (let i = 0; i < this.filterLength; i++) {
            echoEst += this.W[i] * x[i];
        }

        // 误差信号 = 近端 - 回声估计（即干净语音）
        const error = near[0] - echoEst;

        // NLMS 更新滤波器系数
        let norm = 0;
        for (let i = 0; i < this.filterLength; i++) {
            norm += x[i] * x[i];
        }
        norm += this.epsilon;

        const step = this.mu / norm;
        for (let i = 0; i < this.filterLength; i++) {
            this.W[i] += step * error * x[i];
        }

        // 输出干净语音（转换为 int16）
        const output = new Int16Array(micFrame.length);
        // 限幅
        let val = Math.floor(error * 32768);
        if (val > 32767) val = 32767;
        if (val < -32768) val = -32768;
        output[0] = val;

        // 处理帧内其余采样点（简化为复制误差信号）
        for (let i = 1; i < micFrame.length; i++) {
            const e = near[i] - echoEst * (1 - i / micFrame.length);
            let v = Math.floor(e * 32768);
            if (v > 32767) v = 32767;
            if (v < -32768) v = -32768;
            output[i] = v;
        }

        // 统计 ERLE（回声返回损耗增强）
        this.processed++;
        return output;
    }

    /**
     * 处理整个麦克风帧序列
     * @param {Int16Array} micSamples - 麦克风 PCM 采样序列
     * @returns {Int16Array} 处理后的音频
     */
    processSamples(micSamples) {
        if (micSamples.length === 0) return micSamples;

        const outputChunks = [];
        for (let i = 0; i < micSamples.length; i += this.frameSize) {
            const frame = micSamples.subarray(i, Math.min(i + this.frameSize, micSamples.length));
            if (frame.length === this.frameSize) {
                const out = this.process(frame);
                if (out) outputChunks.push(out);
            }
        }

        if (outputChunks.length === 0) return micSamples;

        const totalLen = outputChunks.reduce((s, c) => s + c.length, 0);
        const result = new Int16Array(totalLen);
        let offset = 0;
        for (const chunk of outputChunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    /**
     * 重置 AEC 状态（播放开始时调用）
     */
    reset() {
        this.W.fill(0);
        this.playBuf.fill(0);
        this.pendingPlayFrames = [];
        this.playWriteOffset = 0;
        this.processed = 0;
        this.erleSum = 0;
    }

    /**
     * 释放资源
     */
    destroy() {
        this.reset();
    }

    /**
     * 简单线性插值重采样
     * @param {Int16Array} src
     * @param {number} srcRate
     * @param {number} dstRate
     * @returns {Int16Array}
     */
    _resample(src, srcRate, dstRate) {
        if (srcRate === dstRate) return src;
        const ratio = srcRate / dstRate;
        const dstLen = Math.floor(src.length / ratio);
        const dst = new Int16Array(dstLen);
        for (let i = 0; i < dstLen; i++) {
            const pos = i * ratio;
            const idx = Math.floor(pos);
            const frac = pos - idx;
            if (idx + 1 < src.length) {
                dst[i] = Math.round(src[idx] * (1 - frac) + src[idx + 1] * frac);
            } else {
                dst[i] = src[Math.min(idx, src.length - 1)];
            }
        }
        return dst;
    }
}

module.exports = AECProcessor;
