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
            this.active = false;
        }

        start(stream) {
            if (this.active) throw new Error('PCM 录音已在进行中');
            const AudioContextClass = global.AudioContext || global.webkitAudioContext;
            if (!AudioContextClass) throw new Error('浏览器不支持 AudioContext');

            this.context = new AudioContextClass();
            this.sourceSampleRate = this.context.sampleRate;
            this.chunks = [];
            this.source = this.context.createMediaStreamSource(stream);
            this.processor = this.context.createScriptProcessor(this.bufferSize, 1, 1);
            this.silentGain = this.context.createGain();
            this.silentGain.gain.value = 0;
            this.active = true;
            this.processor.onaudioprocess = (event) => {
                if (!this.active) return;
                this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
            };
            this.source.connect(this.processor);
            this.processor.connect(this.silentGain);
            this.silentGain.connect(this.context.destination);
            return this;
        }

        takeWav() {
            if (!this.active || this.chunks.length === 0) return null;
            const sampleCount = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
            const samples = new Float32Array(sampleCount);
            let offset = 0;
            this.chunks.forEach((chunk) => {
                samples.set(chunk, offset);
                offset += chunk.length;
            });
            this.chunks = [];
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
    }

    global.PcmAudioCapture = PcmAudioCapture;
})(window);
