const fs = require('fs');
const path = require('path');

let sherpaOnnx = null;
let recognizer = null;

try {
    sherpaOnnx = require('sherpa-onnx-node');
} catch (e) {
    console.log('[ASR] sherpa-onnx-node 未安装，请运行: npm install sherpa-onnx-node');
}

class SherpaOnnxASR {
    constructor(options = {}) {
        const preferredModelDir = path.join(__dirname, '../../../res/models/sensevoice');
        this.modelDir = options.modelDir || preferredModelDir;
        this.initialized = false;
        this.recognitionQueue = Promise.resolve();
        this.maxQueueLength = Math.max(1, options.maxQueueLength || 8);
        this.pendingCount = 0;
        this.completedCount = 0;
        
        console.log(`\n🎤 Sherpa-ONNX ASR 初始化:`);
        console.log(`  模型目录: ${this.modelDir}`);
        
        if (sherpaOnnx) {
            this.initRecognizer();
        } else {
            console.log(`  ⚠️  sherpa-onnx-node 未安装`);
        }
        console.log('');
    }

    initRecognizer() {
        try {
            const modelPath = path.join(this.modelDir, 'model.int8.onnx');
            const tokensPath = path.join(this.modelDir, 'tokens.txt');
            
            if (!fs.existsSync(modelPath)) {
                console.log(`  ⚠️  模型文件不存在: ${modelPath}`);
                return;
            }
            
            if (!fs.existsSync(tokensPath)) {
                console.log(`  ⚠️  tokens.txt 不存在: ${tokensPath}`);
                return;
            }

            const config = {
                featConfig: {
                    sampleRate: 16000
                },
                modelConfig: {
                    senseVoice: {
                        model: modelPath,
                        language: 'auto',
                        useInverseTextNormalization: 1
                    },
                    tokens: tokensPath,
                    numThreads: 4,
                    debug: false,
                    provider: 'cpu'
                }
            };

            recognizer = new sherpaOnnx.OfflineRecognizer(config);
            
            this.initialized = true;
            console.log(`  ✅ SenseVoice 模型加载成功`);
        } catch (e) {
            console.error(`  ❌ 模型加载失败: ${e.message}`);
        }
    }

    isReady() {
        return this.initialized && recognizer !== null;
    }

    async recognize(audioPath) {
        if (!this.initialized || !recognizer) {
            throw new Error('ASR 未初始化');
        }

        if (this.pendingCount >= this.maxQueueLength) {
            throw new Error(`ASR 忙，排队请求过多(${this.pendingCount})`);
        }

        this.pendingCount++;

        const runRecognition = async () => {
            try {
                return await this.performRecognition(audioPath);
            } finally {
                this.pendingCount--;
                this.completedCount++;
                this.tryCompactMemory();
            }
        };

        const queuedTask = this.recognitionQueue.then(runRecognition, runRecognition);
        this.recognitionQueue = queuedTask.catch(() => {});
        return queuedTask;
    }

    async performRecognition(audioPath) {
        let stream = null;
        let audioData = null;

        try {
            stream = recognizer.createStream();
            audioData = this.readWavFile(audioPath);

            stream.acceptWaveform({
                samples: audioData.samples,
                sampleRate: audioData.sampleRate
            });
            recognizer.decode(stream);

            const result = recognizer.getResult(stream);
            return result.text || '';
        } catch (e) {
            throw new Error(`ASR 识别失败: ${e.message}`);
        } finally {
            this.destroyStreamSafely(stream);
            stream = null;

            if (audioData) {
                audioData.samples = null;
                audioData = null;
            }
        }
    }

    destroyStreamSafely(stream) {
        if (!stream || typeof stream.destroy !== 'function') {
            return;
        }

        try {
            stream.destroy();
        } catch (e) {
            console.error(`[ASR] stream.destroy() 失败: ${e.message}`);
        }
    }

    tryCompactMemory() {
        if (typeof global.gc !== 'function') {
            return;
        }

        if (this.pendingCount > 0) {
            return;
        }

        if (this.completedCount % 10 !== 0) {
            return;
        }

        const usage = process.memoryUsage();
        const rssMB = usage.rss / 1024 / 1024;
        const arrayBuffersMB = (usage.arrayBuffers || 0) / 1024 / 1024;

        if (rssMB < 1024 && arrayBuffersMB < 32) {
            return;
        }

        setImmediate(() => {
            try {
                global.gc();
            } catch (e) {
            }
        });
    }

    readWavFile(filePath) {
        const buffer = fs.readFileSync(filePath);
        
        if (buffer.toString('ascii', 0, 4) !== 'RIFF') {
            return this.convertAudioFile(filePath);
        }
        
        let dataOffset = 12;
        let sampleRate = 16000;
        let dataSize = 0;
        let bitsPerSample = 16;
        
        while (dataOffset < buffer.length - 8) {
            const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
            const chunkSize = buffer.readUInt32LE(dataOffset + 4);
            
            if (chunkId === 'fmt ') {
                sampleRate = buffer.readUInt32LE(dataOffset + 12);
                bitsPerSample = buffer.readUInt16LE(dataOffset + 22);
            } else if (chunkId === 'data') {
                dataSize = chunkSize;
                dataOffset += 8;
                break;
            }
            dataOffset += 8 + chunkSize;
        }
        
        if (dataSize === 0) {
            return { samples: new Float32Array(0), sampleRate: 16000 };
        }
        
        const samples = new Float32Array(dataSize / (bitsPerSample / 8));
        
        if (bitsPerSample === 16) {
            for (let i = 0; i < samples.length; i++) {
                samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768.0;
            }
        } else if (bitsPerSample === 32) {
            for (let i = 0; i < samples.length; i++) {
                samples[i] = buffer.readFloatLE(dataOffset + i * 4);
            }
        }
        
        return { samples, sampleRate };
    }
    
    convertAudioFile(filePath) {
        const { execSync } = require('child_process');
        const outputPath = filePath + '.converted.wav';
        
        try {
            execSync(`ffmpeg -y -i "${filePath}" -ar 16000 -ac 1 -f wav "${outputPath}"`, { stdio: 'pipe' });
            const buffer = fs.readFileSync(outputPath);
            fs.unlinkSync(outputPath);
            
            let dataOffset = 12;
            let sampleRate = 16000;
            let dataSize = 0;
            
            while (dataOffset < buffer.length - 8) {
                const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
                const chunkSize = buffer.readUInt32LE(dataOffset + 4);
                
                if (chunkId === 'fmt ') {
                    sampleRate = buffer.readUInt32LE(dataOffset + 12);
                } else if (chunkId === 'data') {
                    dataSize = chunkSize;
                    dataOffset += 8;
                    break;
                }
                dataOffset += 8 + chunkSize;
            }
            
            const samples = new Float32Array(dataSize / 2);
            
            for (let i = 0; i < samples.length; i++) {
                samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768.0;
            }
            
            return { samples, sampleRate };
        } catch (e) {
            return { samples: new Float32Array(0), sampleRate: 16000 };
        }
    }
}

let asrInstance = null;

function init(options = {}) {
    if (!asrInstance) {
        asrInstance = new SherpaOnnxASR(options);
    }
    return asrInstance;
}

function recognize(audioPath) {
    if (!asrInstance) {
        return Promise.reject(new Error('ASR 未初始化'));
    }
    return asrInstance.recognize(audioPath);
}

function isReady() {
    return asrInstance && asrInstance.isReady();
}

module.exports = {
    SherpaOnnxASR,
    init,
    recognize,
    isReady
};
