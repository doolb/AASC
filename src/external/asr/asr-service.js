const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

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
        this.lastTrimTime = 0;
        this.mallocTrimEnabled = options.mallocTrimEnabled !== false;
        
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
                    numThreads: 1,
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
        const beforeRss = process.memoryUsage().rss;

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

            const deltaRss = (process.memoryUsage().rss - beforeRss) / 1024 / 1024;
            if (Math.abs(deltaRss) > 0.5) {
                console.log(`[ASR] 识别后RSS变化: ${deltaRss > 0 ? '+' : ''}${deltaRss.toFixed(1)}MB (音频: ${audioPath})`);
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
        if (this.pendingCount > 0) {
            return;
        }

        if (this.completedCount % 20 !== 0) {
            return;
        }

        const usage = process.memoryUsage();
        const rssMB = usage.rss / 1024 / 1024;

        if (rssMB < 200) {
            return;
        }

        const now = Date.now();
        if (this.lastTrimTime && now - this.lastTrimTime < 5 * 60 * 1000) {
            return;
        }
        this.lastTrimTime = now;

        setImmediate(() => {
            let freed = 0;
            if (typeof global.gc === 'function') {
                try {
                    global.gc();
                    freed++;
                } catch (e) {}
            }
            if (this.mallocTrimEnabled) {
                try {
                    const mallocTrim = require('../../../src/native/malloc-trim/build/Release/malloc-trim');
                    freed += mallocTrim.trim();
                } catch (e) {}
            }
            if (freed > 0) {
                const after = process.memoryUsage();
                const delta = ((after.rss - usage.rss) / 1024 / 1024).toFixed(1);
                console.log(`[ASR] 内存回收(G+g) RSS变化: ${delta}MB`);
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

        const sampleCount = bitsPerSample === 16 ? dataSize / 2 : dataSize / 4;
        const samples = new Float32Array(sampleCount);

        if (bitsPerSample === 16) {
            const int16View = new Int16Array(buffer.buffer, dataOffset, sampleCount);
            for (let i = 0; i < sampleCount; i++) {
                samples[i] = int16View[i] / 32768.0;
            }
        } else if (bitsPerSample === 32) {
            const float32View = new Float32Array(buffer.buffer, dataOffset, sampleCount);
            for (let i = 0; i < sampleCount; i++) {
                samples[i] = float32View[i];
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

            const sampleCount = dataSize / 2;
            const int16View = new Int16Array(buffer.buffer, dataOffset, sampleCount);
            const samples = new Float32Array(sampleCount);
            for (let i = 0; i < sampleCount; i++) {
                samples[i] = int16View[i] / 32768.0;
            }

            return { samples, sampleRate };
        } catch (e) {
            return { samples: new Float32Array(0), sampleRate: 16000 };
        }
    }
}

function resolveIsolateProcessConfig(options = {}) {
    // mode: "embedded" | "isolated"，优先使用，向后兼容旧的 isolateProcess.enabled
    if (options.mode === 'isolated') {
        const requestTimeoutMs = Math.max(1000, (options.isolateProcess && options.isolateProcess.requestTimeoutMs) || 60000);
        return { enabled: true, requestTimeoutMs, autoRestart: true };
    }
    if (options.mode === 'embedded') {
        return { enabled: false, requestTimeoutMs: 60000, autoRestart: true };
    }

    const isolateOption = options.isolateProcess;
    const asObject = isolateOption && typeof isolateOption === 'object' ? isolateOption : {};
    const enabled = isolateOption === true || asObject.enabled === true;
    const requestTimeoutMs = Math.max(1000, asObject.requestTimeoutMs || 60000);
    const autoRestart = asObject.autoRestart !== false;

    return {
        enabled,
        requestTimeoutMs,
        autoRestart
    };
}

class IsolatedAsrProcessClient {
    constructor(options = {}) {
        this.options = options;
        const isolateConfig = resolveIsolateProcessConfig(options);
        this.requestTimeoutMs = isolateConfig.requestTimeoutMs;
        this.maxQueueLength = Math.max(1, options.maxQueueLength || 8);
        this.pendingCount = 0;
    }

    buildWorkerOptions() {
        const workerOptions = { ...this.options };
        workerOptions.isolateProcess = { enabled: false };
        return workerOptions;
    }

    isReady() {
        return true;
    }

    async recognize(audioPath) {
        if (this.pendingCount >= this.maxQueueLength) {
            throw new Error(`ASR 忙，排队请求过多(${this.pendingCount})`);
        }

        this.pendingCount++;
        try {
            return await this.spawnWorker(audioPath);
        } finally {
            this.pendingCount--;
        }
    }

    spawnWorker(audioPath) {
        const workerPath = path.join(__dirname, 'asr-worker-process.js');

        return new Promise((resolve, reject) => {
            let settled = false;

            const child = fork(workerPath, [], {
                stdio: ['inherit', 'pipe', 'pipe', 'ipc']
            });

            // TUI 模式下子进程 stdout/stderr 若继承父进程会直接写终端，破坏 blessed 渲染。
            // pipe 捕获后由主进程 console.log 输出，自动进入 TUI 日志面板。
            child.stdout.on('data', (data) => {
                const text = data.toString().trim();
                if (text) console.log('[ASR子进程] ' + text);
            });
            child.stderr.on('data', (data) => {
                const text = data.toString().trim();
                if (text) console.log('[ASR子进程] ' + text);
            });

            const requestId = `asr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const timeout = this.requestTimeoutMs;

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                child.kill('SIGKILL');
                reject(new Error(`ASR 独立进程识别超时(${timeout}ms)`));
            }, timeout);

            child.on('message', (message) => {
                if (settled) return;
                if (!message || message.type !== 'response' || message.id !== requestId) return;

                clearTimeout(timer);
                settled = true;

                if (message.ok) {
                    resolve(message.text || '');
                } else {
                    reject(new Error(message.error || 'ASR 独立进程识别失败'));
                }
            });

            child.on('exit', () => {
                if (settled) return;
                clearTimeout(timer);
                settled = true;
                reject(new Error('ASR 独立进程异常退出'));
            });

            child.on('error', (err) => {
                if (settled) return;
                clearTimeout(timer);
                settled = true;
                reject(new Error(`ASR 独立进程启动失败: ${err.message}`));
            });

            child.send({
                type: 'recognize',
                id: requestId,
                audioPath,
                options: this.buildWorkerOptions()
            });
        });
    }
}

let asrInstance = null;
let currentMode = 'embedded';

function init(options = {}) {
    if (!asrInstance) {
        const isolateConfig = resolveIsolateProcessConfig(options);
        currentMode = isolateConfig.enabled ? 'isolated' : 'embedded';
        if (isolateConfig.enabled) {
            asrInstance = new IsolatedAsrProcessClient(options);
        } else {
            asrInstance = new SherpaOnnxASR(options);
        }
    }
    return asrInstance;
}

function reset(options = {}) {
    if (asrInstance && asrInstance.destroy) {
        asrInstance.destroy();
    }
    asrInstance = null;
    return init(options);
}

function getMode() {
    return currentMode;
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
    reset,
    getMode,
    recognize,
    isReady
};
