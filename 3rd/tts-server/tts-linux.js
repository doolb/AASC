'use strict';

const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_VOICE = 'Microsoft Xiaoxiao';
const DEFAULT_PORT = 3002;
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_MAX_QUEUE = 16;
const HARD_CODED_LICENSE = 'Key:ZCjZ7nHDSLvf4gpELteM4AnzaWUjTpn7UkV7D@vvksl0w1SNgon6d1905WANbktDc9S39oaA4r29HJNayXvTq8fJsq';

function readPositiveInteger(value, fallback, minimum = 1) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, parsed);
}

function resolveLinuxRuntimeConfig(environment = process.env) {
    const linuxRoot = path.join(__dirname, 'linux');
    const sdkPath = environment.TTS_LINUX_SDK_DIR || '';

    return {
        port: readPositiveInteger(environment.PORT, DEFAULT_PORT),
        binaryPath: environment.TTS_LINUX_BIN || path.join(linuxRoot, 'bin', 'tts_linux'),
        modelPath: environment.TTS_LINUX_MODEL_DIR || path.join(linuxRoot, 'models', 'extracted'),
        sdkPath,
        license: HARD_CODED_LICENSE,
        defaultVoice: environment.TTS_DEFAULT_VOICE || DEFAULT_VOICE,
        voices: (environment.TTS_LINUX_VOICES || environment.TTS_DEFAULT_VOICE || DEFAULT_VOICE)
            .split(',')
            .map((voice) => voice.trim())
            .filter(Boolean),
        workerCount: readPositiveInteger(environment.TTS_LINUX_WORKERS, 1),
        maxQueueLength: readPositiveInteger(environment.TTS_LINUX_MAX_QUEUE, DEFAULT_MAX_QUEUE),
        timeoutMs: readPositiveInteger(environment.TTS_LINUX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
    };
}

function sendJsonError(response, statusCode, message, details) {
    if (response.headersSent || response.destroyed) return;
    response.status(statusCode).json({
        success: false,
        error: message,
        details
    });
}

function buildLinuxCliArguments(params, runtime, outputPath) {
    const args = [
        '--model', runtime.modelPath,
        '--text', params.text,
        '--out', outputPath,
        '--voice', params.voice || runtime.defaultVoice
    ];

    if (runtime.license) args.push('--license', runtime.license);
    if (params.speed !== undefined && Number(params.speed) !== 0) {
        args.push('--speed', String(Number(params.speed) || 0));
    }
    return args;
}

function buildChildEnvironment(runtime) {
    const childEnvironment = { ...process.env };
    if (!runtime.sdkPath) return childEnvironment;

    const libraryPath = childEnvironment.LD_LIBRARY_PATH || '';
    childEnvironment.LD_LIBRARY_PATH = libraryPath
        ? `${runtime.sdkPath}${path.delimiter}${libraryPath}`
        : runtime.sdkPath;
    return childEnvironment;
}

function runChildProcess(binaryPath, args, runtime) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let stderr = '';
        const child = spawn(binaryPath, args, {
            cwd: path.dirname(binaryPath),
            env: buildChildEnvironment(runtime),
            stdio: ['ignore', 'ignore', 'pipe']
        });

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill('SIGKILL');
            reject(new Error(`Linux TTS 请求超时(${runtime.timeoutMs}ms)`));
        }, runtime.timeoutMs);

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
            if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
        });

        child.once('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(`Linux TTS 启动失败: ${error.message}`));
        });

        child.once('exit', (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) {
                resolve();
                return;
            }
            const suffix = stderr.trim() ? `: ${stderr.trim()}` : '';
            reject(new Error(`Linux TTS 进程失败 code=${code} signal=${signal}${suffix}`));
        });
    });
}

async function runLinuxCli(params, runtime) {
    const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-tts-linux-'));
    const outputPath = path.join(temporaryDirectory, 'speech.wav');

    try {
        const args = buildLinuxCliArguments(params, runtime, outputPath);
        await runChildProcess(runtime.binaryPath, args, runtime);
        return await fs.promises.readFile(outputPath);
    } finally {
        await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    }
}

function createTtsLinuxServer(options = {}) {
    const runtime = {
        ...resolveLinuxRuntimeConfig(options.environment || process.env),
        ...(options.runtime || {})
    };
    const synthesize = options.synthesize || ((params) => runLinuxCli(params, runtime));
    const voices = options.voices || runtime.voices;
    const requestQueue = [];
    let activeWorkers = 0;

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    function clearQueuedTask(task) {
        if (task.disconnectHandler) {
            task.response.removeListener('close', task.disconnectHandler);
            task.disconnectHandler = null;
        }
    }

    function cancelQueuedTask(task) {
        if (task.started) return;
        task.cancelled = true;
        const index = requestQueue.indexOf(task);
        if (index >= 0) requestQueue.splice(index, 1);
        clearQueuedTask(task);
    }

    function drainQueue() {
        while (activeWorkers < runtime.workerCount && requestQueue.length > 0) {
            const task = requestQueue.shift();
            clearQueuedTask(task);
            if (task.cancelled || task.response.destroyed) continue;

            task.started = true;
            activeWorkers += 1;
            executeTask(task)
                .catch((error) => {
                    sendJsonError(task.response, 500, 'Linux TTS 失败', error.message);
                })
                .finally(() => {
                    activeWorkers -= 1;
                    drainQueue();
                });
        }
    }

    function enqueueTask(task) {
        if (requestQueue.length >= runtime.maxQueueLength) {
            sendJsonError(task.response, 503, 'Linux TTS 队列已满', `最多排队 ${runtime.maxQueueLength} 个请求`);
            return;
        }

        task.started = false;
        task.cancelled = false;
        task.disconnectHandler = () => cancelQueuedTask(task);
        task.response.once('close', task.disconnectHandler);
        requestQueue.push(task);
        drainQueue();
    }

    async function executeTask(task) {
        const audio = await synthesize({
            text: task.text,
            voice: task.voice,
            speed: task.speed
        });
        if (task.response.destroyed) return;
        if (!Buffer.isBuffer(audio) && !(audio instanceof Uint8Array)) {
            throw new Error('Linux TTS 返回的音频不是二进制数据');
        }

        task.response.setHeader('Content-Type', 'audio/wav');
        task.response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        task.response.end(Buffer.from(audio));
    }

    app.post('/api/tts', (request, response) => {
        const { text, voice, speed } = request.body || {};
        if (typeof text !== 'string' || !text.trim()) {
            sendJsonError(response, 400, 'text 不能为空');
            return;
        }

        enqueueTask({
            response,
            text,
            voice: voice || runtime.defaultVoice,
            speed: speed === undefined ? 0 : speed
        });
    });

    app.get('/api/voices', (request, response) => {
        response.json({ success: true, data: voices });
    });

    app.get('/api/tts/status', (request, response) => {
        response.json({
            queueLength: requestQueue.length,
            activeWorkers,
            workerCount: runtime.workerCount,
            maxQueueLength: runtime.maxQueueLength,
            timeoutMs: runtime.timeoutMs,
            binaryPath: runtime.binaryPath,
            modelPath: runtime.modelPath
        });
    });

    return app;
}

if (require.main === module) {
    const runtime = resolveLinuxRuntimeConfig();
    const app = createTtsLinuxServer({ runtime });
    app.listen(runtime.port, '0.0.0.0', () => {
        console.log(`Linux TTS 服务器已启动: http://localhost:${runtime.port}`);
        console.log(`binary=${runtime.binaryPath}`);
        console.log(`model=${runtime.modelPath}`);
        console.log(`workers=${runtime.workerCount}`);
    });
}

module.exports = {
    buildLinuxCliArguments,
    createTtsLinuxServer,
    resolveLinuxRuntimeConfig,
    runLinuxCli
};
