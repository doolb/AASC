// ttslive 独立网页使用的原始 PCM 采集器，输出 16kHz 单声道 16-bit WAV。
(function(global) {
    'use strict';

    class PcmAudioCapture {
        constructor() {
            this.targetSampleRate = 16000;
            this.context = null;
            this.source = null;
            this.processor = null;
            this.silentGain = null;
            this.sourceSampleRate = 0;
            this.chunks = [];
            this.active = false;
        }

        start(stream) {
            const AudioContextClass = global.AudioContext || global.webkitAudioContext;
            if (!AudioContextClass) throw new Error('浏览器不支持 AudioContext');
            this.context = new AudioContextClass();
            this.sourceSampleRate = this.context.sampleRate;
            this.source = this.context.createMediaStreamSource(stream);
            this.processor = this.context.createScriptProcessor(4096, 1, 1);
            this.silentGain = this.context.createGain();
            this.silentGain.gain.value = 0;
            this.chunks = [];
            this.active = true;
            this.processor.onaudioprocess = (event) => {
                if (this.active) this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
            };
            this.source.connect(this.processor);
            this.processor.connect(this.silentGain);
            this.silentGain.connect(this.context.destination);
            return this;
        }

        stopWav() {
            const sampleCount = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
            const samples = new Float32Array(sampleCount);
            let offset = 0;
            this.chunks.forEach((chunk) => {
                samples.set(chunk, offset);
                offset += chunk.length;
            });
            const wav = PcmAudioCapture.encodeWav(samples, this.sourceSampleRate, this.targetSampleRate);
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
        }

        static encodeWav(samples, sourceSampleRate, targetSampleRate) {
            const sourceRate = Math.max(Number(sourceSampleRate) || targetSampleRate, 1);
            const outputLength = Math.max(1, Math.round(samples.length * targetSampleRate / sourceRate));
            const pcm = new Int16Array(outputLength);
            for (let index = 0; index < outputLength; index += 1) {
                const position = index * sourceRate / targetSampleRate;
                const left = Math.max(0, Math.min(Math.floor(position), samples.length - 1));
                const right = Math.max(0, Math.min(left + 1, samples.length - 1));
                const fraction = position - left;
                const value = (samples[left] || 0) * (1 - fraction) + (samples[right] || 0) * fraction;
                const clipped = Math.max(-1, Math.min(1, value));
                pcm[index] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
            }
            const buffer = new ArrayBuffer(44 + pcm.length * 2);
            const view = new DataView(buffer);
            const writeAscii = (offset, value) => {
                for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
            };
            writeAscii(0, 'RIFF');
            view.setUint32(4, 36 + pcm.length * 2, true);
            writeAscii(8, 'WAVE');
            writeAscii(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, targetSampleRate, true);
            view.setUint32(28, targetSampleRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeAscii(36, 'data');
            view.setUint32(40, pcm.length * 2, true);
            for (let index = 0; index < pcm.length; index += 1) view.setInt16(44 + index * 2, pcm[index], true);
            return new Blob([buffer], { type: 'audio/wav' });
        }
    }

    global.PcmAudioCapture = PcmAudioCapture;
})(window);
