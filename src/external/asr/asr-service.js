const fs = require('fs');
const path = require('path');
const { fork, spawn } = require('child_process');

let sherpaOnnx = null;
let recognizer = null;

try {
    sherpaOnnx = require('sherpa-onnx-node');
} catch (e) {
    console.log('[ASR] sherpa-onnx-node 未安装，请运行: npm install sherpa-onnx-node');
}

// --- 无状态音频读取工具（不加载 ASR 模型）---
// 说明：readWavFile/convertAudioFile 只依赖输入文件，不依赖实例(this)状态；
// 提取为模块级函数便于 voiceprint-service 复用，避免为了读一个 wav 而加载整个 234MB ASR 模型。
// 函数声明会提升，readWavFileFromPath 引用后文定义的 convertAudioFile 没有问题。
function readWavFileFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('WAV 输入必须是 Buffer');
    }
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('音频不是 WAV 格式');
    }

    let dataOffset = 12;
    let sampleRate = 16000;
    let dataSize = 0;
    let bitsPerSample = 16;

    while (dataOffset < buffer.length - 8) {
        const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
        const chunkSize = buffer.readUInt32LE(dataOffset + 4);

        if (chunkId === 'fmt ' && chunkSize >= 16 && dataOffset + 24 <= buffer.length) {
            sampleRate = buffer.readUInt32LE(dataOffset + 12);
            bitsPerSample = buffer.readUInt16LE(dataOffset + 22);
        } else if (chunkId === 'data') {
            dataSize = Math.min(chunkSize, buffer.length - dataOffset - 8);
            dataOffset += 8;
            break;
        }
        dataOffset += 8 + chunkSize;
    }

    if (dataSize === 0) {
        return { samples: new Float32Array(0), sampleRate: 16000 };
    }

    const bytesPerSample = bitsPerSample === 16 ? 2 : 4;
    const sampleCount = Math.floor(dataSize / bytesPerSample);
    const samples = new Float32Array(sampleCount);

    if (bitsPerSample === 16) {
        for (let i = 0; i < sampleCount; i++) {
            samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768.0;
        }
    } else if (bitsPerSample === 32) {
        for (let i = 0; i < sampleCount; i++) {
            samples[i] = buffer.readFloatLE(dataOffset + i * 4);
        }
    }

    return { samples, sampleRate };
}

function readWavFileFromPath(filePath) {
    const buffer = fs.readFileSync(filePath);

    if (buffer.toString('ascii', 0, 4) !== 'RIFF') {
        return convertAudioFile(filePath);
    }

    return readWavFileFromBuffer(buffer);
}

function convertAudioBuffer(buffer) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const stdoutChunks = [];
        const stderrChunks = [];
        const ffmpeg = spawn('ffmpeg', [
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            'pipe:0',
            '-ar',
            '16000',
            '-ac',
            '1',
            '-f',
            'wav',
            'pipe:1'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        const fail = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        ffmpeg.stdout.on('data', chunk => stdoutChunks.push(chunk));
        ffmpeg.stderr.on('data', chunk => stderrChunks.push(chunk));
        ffmpeg.on('error', error => fail(new Error(`ffmpeg 启动失败: ${error.message}`)));
        ffmpeg.on('close', code => {
            if (settled) return;
            if (code !== 0) {
                const detail = Buffer.concat(stderrChunks).toString('utf8').trim();
                return fail(new Error(`ffmpeg 音频转换失败(${code}): ${detail || '未知错误'}`));
            }

            try {
                resolve(readWavFileFromBuffer(Buffer.concat(stdoutChunks)));
            } catch (error) {
                fail(new Error(`ffmpeg 输出音频解析失败: ${error.message}`));
            }
        });

        ffmpeg.stdin.on('error', error => fail(new Error(`ffmpeg 输入失败: ${error.message}`)));
        ffmpeg.stdin.end(buffer);
    });
}

async function readAudioInput(audioInput) {
    if (Buffer.isBuffer(audioInput)) {
        if (audioInput.toString('ascii', 0, 4) === 'RIFF') {
            return readWavFileFromBuffer(audioInput);
        }
        return convertAudioBuffer(audioInput);
    }

    if (typeof audioInput === 'string' && audioInput) {
        return readWavFileFromPath(audioInput);
    }

    throw new TypeError('ASR 音频输入必须是 Buffer 或文件路径');
}

function describeAudioInput(audioInput) {
    return Buffer.isBuffer(audioInput) ? `内存音频 ${audioInput.length}B` : String(audioInput);
}

function convertAudioFile(filePath) {
    try {
        const { execFileSync } = require('child_process');
        const inputBuffer = fs.readFileSync(filePath);
        const convertedBuffer = execFileSync('ffmpeg', [
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            'pipe:0',
            '-ar',
            '16000',
            '-ac',
            '1',
            '-f',
            'wav',
            'pipe:1'
        ], { input: inputBuffer, stdio: ['pipe', 'pipe', 'pipe'] });
        return readWavFileFromBuffer(convertedBuffer);
    } catch (e) {
        return { samples: new Float32Array(0), sampleRate: 16000 };
    }
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

    async recognize(audioInput) {
        if (!this.initialized || !recognizer) {
            throw new Error('ASR 未初始化');
        }

        if (this.pendingCount >= this.maxQueueLength) {
            throw new Error(`ASR 忙，排队请求过多(${this.pendingCount})`);
        }

        this.pendingCount++;

        const runRecognition = async () => {
            try {
                return await this.performRecognition(audioInput);
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

    async performRecognition(audioInput) {
        let stream = null;
        let audioData = null;
        const beforeRss = process.memoryUsage().rss;

        try {
            stream = recognizer.createStream();
            audioData = await this.readAudioInput(audioInput);

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
                console.log(`[ASR] 识别后RSS变化: ${deltaRss > 0 ? '+' : ''}${deltaRss.toFixed(1)}MB (音频: ${describeAudioInput(audioInput)})`);
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
        // 委托给模块级无状态函数（不加载 ASR 模型即可读取音频）
        return readWavFileFromPath(filePath);
    }

    async readAudioInput(audioInput) {
        return readAudioInput(audioInput);
    }

    convertAudioFile(filePath) {
        // 委托给模块级无状态函数；同名模块函数是独立绑定，非递归
        return convertAudioFile(filePath);
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

    async recognize(audioInput) {
        if (this.pendingCount >= this.maxQueueLength) {
            throw new Error(`ASR 忙，排队请求过多(${this.pendingCount})`);
        }

        this.pendingCount++;
        try {
            return await this.spawnWorker(audioInput);
        } finally {
            this.pendingCount--;
        }
    }

    spawnWorker(audioInput) {
        const workerPath = path.join(__dirname, 'asr-worker-process.js');

        return new Promise((resolve, reject) => {
            let settled = false;

            const child = fork(workerPath, [], {
                stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
                serialization: 'advanced'
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
                audioPath: typeof audioInput === 'string' ? audioInput : null,
                audioBuffer: Buffer.isBuffer(audioInput) ? audioInput : null,
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

function recognize(audioInput) {
    if (!asrInstance) {
        return Promise.reject(new Error('ASR 未初始化'));
    }
    return asrInstance.recognize(audioInput);
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
    isReady,
    readWavFileFromPath,
    readWavFileFromBuffer
};
