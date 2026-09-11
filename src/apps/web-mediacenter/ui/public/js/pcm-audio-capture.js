// 浏览器统一原始 PCM 采集器。
// 所有 ASR/声纹录音入口都使用 16kHz、单声道、16-bit PCM WAV，避免 MediaRecorder 编码器差异。
(function(global) {
    'use strict';

    class PcmAudioCapture {
        constructor(options = {}) {
            this.targetSampleRate = options.targetSampleRate || 16000;
            this.bufferSize = options.bufferSize || 4096;
            this.context = null;
            this.source = null;
            this.processor = null;
            this.silentGain = null;
            this.sourceSampleRate = 0;
            this.chunks = [];
            // 分段模式只由持续监听的显示端使用，其他录音入口仍完整缓存所有 PCM。
            this.segmentMode = options.segmentMode === true;
            this.preRollMs = Math.max(Number(options.preRollMs) || 300, 0);
            this.preRollChunks = [];
            this.preRollSampleCount = 0;
            this.preRollSampleLimit = 0;
            this.segmentActive = !this.segmentMode;
            this.active = false;
            this.paused = false;
            // 实时录音只把音频块交给上层传输，不保留整段录音，避免长时间录音持续占用内存。
            this.streamOnly = options.streamOnly === true;
            this.onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
        }

        start(stream) {
            if (this.active) throw new Error('PCM 录音已在进行中');
            const AudioContextClass = global.AudioContext || global.webkitAudioContext;
            if (!AudioContextClass) throw new Error('浏览器不支持 AudioContext');

            this.context = new AudioContextClass();
            this.sourceSampleRate = this.context.sampleRate;
            this.chunks = [];
            this.preRollChunks = [];
            this.preRollSampleCount = 0;
            this.preRollSampleLimit = Math.max(1, Math.round(this.sourceSampleRate * this.preRollMs / 1000));
            this.segmentActive = !this.segmentMode;
            this.paused = false;
            this.source = this.context.createMediaStreamSource(stream);
            this.processor = this.context.createScriptProcessor(this.bufferSize, 1, 1);
            this.silentGain = this.context.createGain();
            this.silentGain.gain.value = 0;
            this.active = true;
            this.processor.onaudioprocess = (event) => {
                if (!this.active || this.paused) return;
                const samples = new Float32Array(event.inputBuffer.getChannelData(0));
                if (this.segmentMode && !this.segmentActive) {
                    this.appendPreRoll(samples);
                    return;
                }
                if (!this.streamOnly) {
                    this.chunks.push(samples);
                }
                if (this.onChunk) {
                    try {
                        this.onChunk(samples, this.sourceSampleRate);
                    } catch (error) {
                        // 音频线程不能因为网络发送或业务回调异常而中断采集。
                        console.warn('[PcmAudioCapture] 音频块回调失败:', error);
                    }
                }
            };
            this.source.connect(this.processor);
            this.processor.connect(this.silentGain);
            this.silentGain.connect(this.context.destination);
            return this;
        }

        // 记录有限长度的循环前置缓冲，避免 VAD 检测延迟时截断首字，同时不让静音无限增长。
        appendPreRoll(samples) {
            this.preRollChunks.push(samples);
            this.preRollSampleCount += samples.length;
            while (this.preRollSampleCount > this.preRollSampleLimit && this.preRollChunks.length > 0) {
                const firstChunk = this.preRollChunks[0];
                const overflow = this.preRollSampleCount - this.preRollSampleLimit;
                if (firstChunk.length <= overflow) {
                    this.preRollChunks.shift();
                    this.preRollSampleCount -= firstChunk.length;
                    continue;
                }
                this.preRollChunks[0] = firstChunk.slice(overflow);
                this.preRollSampleCount -= overflow;
            }
        }

        // 开始一个新的语音段：把短前置缓冲转入当前段，之后才正式累计 PCM。
        beginSegment() {
            if (!this.active || this.paused) return false;
            if (!this.segmentMode) return true;
            if (this.segmentActive) return false;
            this.chunks = this.preRollChunks.slice();
            this.preRollChunks = [];
            this.preRollSampleCount = 0;
            this.segmentActive = true;
            return true;
        }

        // 暂停只停止 PCM 缓冲，不关闭音频上下文和媒体流，供 TTS 播报期间复用采集链路。
        setPaused(paused) {
            if (!this.active) return;
            this.paused = paused === true;
            this.chunks = [];
            this.preRollChunks = [];
            this.preRollSampleCount = 0;
            this.segmentActive = !this.segmentMode;
        }

        takeWav() {
            if (!this.active || this.chunks.length === 0 || (this.segmentMode && !this.segmentActive)) return null;
            const sampleCount = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
            const samples = new Float32Array(sampleCount);
            let offset = 0;
            this.chunks.forEach((chunk) => {
                samples.set(chunk, offset);
                offset += chunk.length;
            });
            this.chunks = [];
            if (this.segmentMode) this.segmentActive = false;
            return PcmAudioCapture.encodeWav(samples, this.sourceSampleRate, this.targetSampleRate);
        }

        stopWav() {
            const wav = this.takeWav();
            this.stop();
            return wav;
        }

        stop() {
            this.active = false;
            this.chunks = [];
            this.preRollChunks = [];
            this.preRollSampleCount = 0;
            this.preRollSampleLimit = 0;
            this.segmentActive = !this.segmentMode;
            this.paused = false;
            if (this.processor) this.processor.disconnect();
            if (this.source) this.source.disconnect();
            if (this.silentGain) this.silentGain.disconnect();
            if (this.context) this.context.close().catch(() => {});
            this.processor = null;
            this.source = null;
            this.silentGain = null;
            this.context = null;
            this.sourceSampleRate = 0;
        }

        static encodeWav(samples, sourceSampleRate, targetSampleRate = 16000) {
            const sourceRate = Math.max(Number(sourceSampleRate) || targetSampleRate, 1);
            const targetRate = Math.max(Number(targetSampleRate) || 16000, 1);
            const pcm = PcmAudioCapture.encodePcm16(samples, sourceRate, targetRate);

            const buffer = new ArrayBuffer(44 + pcm.length * 2);
            const view = new DataView(buffer);
            const writeAscii = (offset, value) => {
                for (let index = 0; index < value.length; index += 1) {
                    view.setUint8(offset + index, value.charCodeAt(index));
                }
            };
            writeAscii(0, 'RIFF');
            view.setUint32(4, 36 + pcm.length * 2, true);
            writeAscii(8, 'WAVE');
            writeAscii(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, targetRate, true);
            view.setUint32(28, targetRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeAscii(36, 'data');
            view.setUint32(40, pcm.length * 2, true);
            for (let index = 0; index < pcm.length; index += 1) {
                view.setInt16(44 + index * 2, pcm[index], true);
            }
            return new Blob([buffer], { type: 'audio/wav' });
        }

        // 将 Float32 PCM 重采样并编码为 little-endian PCM16，供实时录音分块传输。
        static encodePcm16(samples, sourceSampleRate, targetSampleRate = 16000) {
            const sourceRate = Math.max(Number(sourceSampleRate) || targetSampleRate, 1);
            const targetRate = Math.max(Number(targetSampleRate) || 16000, 1);
            const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
            const pcm = new Int16Array(outputLength);
            for (let index = 0; index < outputLength; index += 1) {
                const sourcePosition = index * sourceRate / targetRate;
                const leftIndex = Math.max(0, Math.min(Math.floor(sourcePosition), samples.length - 1));
                const rightIndex = Math.max(0, Math.min(leftIndex + 1, samples.length - 1));
                const fraction = sourcePosition - leftIndex;
                const value = (samples[leftIndex] || 0) * (1 - fraction) + (samples[rightIndex] || 0) * fraction;
                const clipped = Math.max(-1, Math.min(1, value));
                pcm[index] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
            }
            return pcm;
        }
    }

    global.PcmAudioCapture = PcmAudioCapture;
})(window);
