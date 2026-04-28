/**
 * ASR 压力测试脚本 - 真实显示端模式
 *
 * 模拟 voice-display-node 的完整链路：
 *   WebSocket → 声明能力 → HTTP POST /api/asr/recognize → voiceInput → 断开
 *
 * 用法:
 *   node src/scripts/asr-stress-test.js --url http://127.0.0.1:8081
 *   node src/scripts/asr-stress-test.js --url http://127.0.0.1:8081 --total 200 --concurrency 10
 *   node src/scripts/asr-stress-test.js --url http://127.0.0.1:8081 --file /path/to/test.wav
 *   node src/scripts/asr-stress-test.js --url http://127.0.0.1:8081 --audio-type noise --audio-duration 3
 *   node src/scripts/asr-stress-test.js --url http://127.0.0.1:8081 --no-system-stats --no-ws
 *   node src/scripts/asr-stress-test.js --url https://192.168.1.39:8081
 *
 * 音频类型 (--audio-type):
 *   sine       纯音（默认，440Hz）
 *   multi-tone 多频混合（模拟语音频谱）
 *   sweep      频率扫描（200Hz→4kHz）
 *   noise      白噪声
 *   silence    静音
 *   burst      短脉冲串（200ms 音频 + 300ms 静音交替）
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

function parseArgs(argv) {
    const args = {
        url: 'http://127.0.0.1:8081',
        file: '',
        total: 50,
        concurrency: 1,
        timeout: 1260000,
        outputEvery: 5,
        retry429: 0,
        pollSystemStats: true,
        statsInterval: 1000,
        displayId: '',
        enableWS: true,
        audioType: 'sine',
        audioDuration: 30,
        insecure: true
    };

    for (let i = 0; i < argv.length; i++) {
        const item = argv[i];
        const next = argv[i + 1];

        if (item === '--url' && next) {
            args.url = next;
            i++;
            continue;
        }
        if (item === '--file' && next) {
            args.file = next;
            i++;
            continue;
        }
        if (item === '--total' && next) {
            args.total = Math.max(1, parseInt(next, 10) || args.total);
            i++;
            continue;
        }
        if (item === '--concurrency' && next) {
            args.concurrency = Math.max(1, parseInt(next, 10) || args.concurrency);
            i++;
            continue;
        }
        if (item === '--timeout' && next) {
            args.timeout = Math.max(1000, parseInt(next, 10) || args.timeout);
            i++;
            continue;
        }
        if (item === '--output-every' && next) {
            args.outputEvery = Math.max(1, parseInt(next, 10) || args.outputEvery);
            i++;
            continue;
        }
        if (item === '--retry-429' && next) {
            args.retry429 = Math.max(0, parseInt(next, 10) || 0);
            i++;
            continue;
        }
        if (item === '--stats-interval' && next) {
            args.statsInterval = Math.max(200, parseInt(next, 10) || args.statsInterval);
            i++;
            continue;
        }
        if (item === '--display-id' && next) {
            args.displayId = next;
            i++;
            continue;
        }
        if (item === '--no-system-stats') {
            args.pollSystemStats = false;
        }
        if (item === '--no-ws') {
            args.enableWS = false;
        }
        if (item === '--audio-type' && next) {
            const valid = ['sine', 'multi-tone', 'sweep', 'noise', 'silence', 'burst'];
            if (valid.includes(next)) {
                args.audioType = next;
            } else {
                console.error(`[ASR压测] 不支持的音频类型: ${next}，可选: ${valid.join(', ')}`);
                process.exit(1);
            }
            i++;
            continue;
        }
        if (item === '--audio-duration' && next) {
            args.audioDuration = Math.max(0.1, parseFloat(next) || args.audioDuration);
            i++;
            continue;
        }
        if (item === '--no-insecure') {
            args.insecure = false;
        }
    }

    return args;
}

// ---------------------------------------------------------------------------
// 测试音频生成 — 多种假音频数据
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 16000;

function resolveAudioFile(fileArg) {
    if (fileArg) {
        return path.resolve(fileArg);
    }
    return path.join(__dirname, '../../res/temp/asr/asr-stress-sample.wav');
}

function ensureDirExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * 编码 WAV 容器
 * @param {Int16Array|number[]} samples - PCM16 采样
 * @param {number} sampleRate
 * @returns {Buffer}
 */
function encodeWav(samples, sampleRate) {
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
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, samples[i])), 44 + i * 2);
    }
    return buffer;
}

/** 纯音 (sine) */
function genSine(sampleRate, durationSec, freq, amplitude) {
    const n = Math.floor(sampleRate * durationSec);
    const samples = new Array(n);
    for (let i = 0; i < n; i++) {
        samples[i] = Math.round(Math.sin(2 * Math.PI * freq * (i / sampleRate)) * amplitude * 32767);
    }
    return samples;
}

/** 多频混合 (multi-tone) — 模拟语音频谱 */
function genMultiTone(sampleRate, durationSec, amplitude) {
    const n = Math.floor(sampleRate * durationSec);
    const freqs = [200, 400, 800, 1200, 2000, 3600];
    const amps = freqs.map((_, idx) => amplitude / (idx + 1.5));
    const samples = new Array(n);
    for (let i = 0; i < n; i++) {
        let v = 0;
        for (let f = 0; f < freqs.length; f++) {
            v += Math.sin(2 * Math.PI * freqs[f] * (i / sampleRate)) * amps[f];
        }
        samples[i] = Math.round(v * 32767);
    }
    return samples;
}

/** 频率扫描 (sweep) — 200Hz → 4kHz */
function genSweep(sampleRate, durationSec, amplitude) {
    const n = Math.floor(sampleRate * durationSec);
    const freqStart = 200;
    const freqEnd = 4000;
    const samples = new Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const instantFreq = freqStart + (freqEnd - freqStart) * (t / durationSec);
        const phase = 2 * Math.PI * (freqStart * t + (freqEnd - freqStart) * t * t / (2 * durationSec));
        samples[i] = Math.round(Math.sin(phase) * amplitude * 32767);
    }
    return samples;
}

/** 白噪声 (noise) */
function genNoise(sampleRate, durationSec, amplitude) {
    const n = Math.floor(sampleRate * durationSec);
    const samples = new Array(n);
    for (let i = 0; i < n; i++) {
        samples[i] = Math.round((Math.random() * 2 - 1) * amplitude * 32767);
    }
    return samples;
}

/** 静音 (silence) */
function genSilence(sampleRate, durationSec) {
    return new Array(Math.floor(sampleRate * durationSec)).fill(0);
}

/**
 * 脉冲串 (burst) — 200ms 音频 + 300ms 静音交替
 * 用于测试 VAD 和流式场景
 */
function genBurst(sampleRate, durationSec, amplitude) {
    const burstLen = Math.floor(sampleRate * 0.2);
    const gapLen = Math.floor(sampleRate * 0.3);
    const cycleLen = burstLen + gapLen;
    const n = Math.floor(sampleRate * durationSec);
    const samples = new Array(n);

    for (let i = 0; i < n; i++) {
        const posInCycle = i % cycleLen;
        if (posInCycle < burstLen) {
            const envelope = Math.sin(Math.PI * posInCycle / burstLen); // 平滑起落
            samples[i] = Math.round(Math.sin(2 * Math.PI * 600 * (i / sampleRate)) * envelope * amplitude * 32767);
        } else {
            samples[i] = 0;
        }
    }
    return samples;
}

/** 根据类型生成测试音频文件 */
function generateAudioFile(filePath, type, durationSec) {
    ensureDirExists(path.dirname(filePath));

    let samples;
    const amplitude = 0.3;

    switch (type) {
        case 'sine':
            samples = genSine(SAMPLE_RATE, durationSec, 440, amplitude);
            break;
        case 'multi-tone':
            samples = genMultiTone(SAMPLE_RATE, durationSec, amplitude);
            break;
        case 'sweep':
            samples = genSweep(SAMPLE_RATE, durationSec, amplitude);
            break;
        case 'noise':
            samples = genNoise(SAMPLE_RATE, durationSec, amplitude);
            break;
        case 'silence':
            samples = genSilence(SAMPLE_RATE, durationSec);
            break;
        case 'burst':
            samples = genBurst(SAMPLE_RATE, durationSec, amplitude);
            break;
        default:
            samples = genSine(SAMPLE_RATE, durationSec, 440, amplitude);
    }

    const wav = encodeWav(samples, SAMPLE_RATE);
    fs.writeFileSync(filePath, wav);
    return filePath;
}

function describeAudioType(type) {
    const desc = {
        'sine': '纯音 440Hz',
        'multi-tone': '多频混合(200/400/800/1200/2000/3600Hz)',
        'sweep': '频率扫描 200Hz→4kHz',
        'noise': '白噪声',
        'silence': '静音',
        'burst': '200ms脉冲+300ms静音交替'
    };
    return desc[type] || type;
}

// ---------------------------------------------------------------------------
// 显示端 WebSocket 客户端 — 模拟真实 voice-display-node
// ---------------------------------------------------------------------------

class DisplayWSClient {
    constructor(serverUrl, displayId) {
        this.serverUrl = serverUrl;
        this.displayId = displayId;
        this.ws = null;
        this.connected = false;
        this._readyResolve = null;
        this._readyPromise = null;
    }

    /**
     * 连接到服务器并声明能力
     */
    async connect() {
        const parsedUrl = new URL(this.serverUrl);
        const wsProtocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${parsedUrl.host}/display?subDisplay=true&displayId=${encodeURIComponent(this.displayId)}`;

        this._readyPromise = new Promise((resolve) => {
            this._readyResolve = resolve;
        });

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.connected = true;
                this._declareCapabilities();
                resolve();
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'displayId' || msg.type === 'serverStartTime') {
                        // 连接就绪
                        if (this._readyResolve) {
                            this._readyResolve();
                            this._readyResolve = null;
                        }
                    }
                } catch { /* ignore parse errors */ }
            };

            this.ws.onerror = (err) => {
                if (!this.connected) reject(err);
            };

            this.ws.onclose = () => {
                this.connected = false;
            };
        });
    }

    _declareCapabilities() {
        this._send({
            type: 'capabilities',
            capabilities: {
                mediaRendering: false,
                voicePlayback: false,
                voiceRecording: true,
                voiceRecognition: false,
                displayText: false
            }
        });
    }

    /**
     * 发送 voiceInput 消息（包含识别结果）
     */
    sendVoiceInput(text) {
        this._send({
            type: 'voiceInput',
            text,
            isFinal: true,
            fullText: text
        });
    }

    /**
     * 等待 WebSocket 完全就绪（收到 displayId 确认）
     */
    async waitReady() {
        await this._readyPromise;
    }

    _send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    close() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }
}

// ---------------------------------------------------------------------------
// ASR 识别客户端 — 使用原生 fetch + FormData（同 real ServerASR）
// ---------------------------------------------------------------------------

async function recognize(baseUrl, audioBuffer, timeout, retry429) {
    let attempts = 0;

    while (true) {
        attempts++;
        const begin = Date.now();

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);

            const body = new FormData();
            body.set('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');

            const response = await fetch(`${baseUrl}/api/asr/recognize`, {
                method: 'POST',
                body,
                signal: controller.signal
            });

            clearTimeout(timer);
            const latency = Date.now() - begin;
            const raw = await response.text();
            let payload = null;
            try { payload = raw ? JSON.parse(raw) : null; } catch { /* ignore */ }

            if (response.status !== 429 || attempts > retry429 + 1) {
                return { statusCode: response.status, payload, raw, attempts, latency };
            }

            await sleep(200 * attempts);
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`请求超时 ${timeout}ms`);
            }
            throw error;
        }
    }
}

// ---------------------------------------------------------------------------
// 系统状态采集
// ---------------------------------------------------------------------------

async function requestSystemStats(baseUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${baseUrl}/api/system-stats`, { signal: controller.signal });
        if (!response.ok) throw new Error(`system-stats HTTP ${response.status}`);
        const data = await response.json();
        if (data.status !== 'ok') throw new Error(`system-stats 状态异常`);
        return data.stats;
    } finally {
        clearTimeout(timer);
    }
}

async function startSystemStatsPolling(baseUrl, intervalMs, tracker) {
    let timer = null;
    let stopped = false;

    const poll = async (label) => {
        if (stopped && label !== 'Final') return;
        try {
            const stats = await requestSystemStats(baseUrl);
            tracker.push(stats);
            console.log(`[ASR压测][Server][${label}] ${formatServerStats(stats)}`);
        } catch (error) {
            console.log(`[ASR压测][Server][${label}] 拉取 system-stats 失败: ${error.message}`);
        }
    };

    await poll('Init');

    timer = setInterval(() => { poll('Tick').catch(() => {}); }, intervalMs);

    return async () => {
        stopped = true;
        if (timer) clearInterval(timer);
        await poll('Final');
    };
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function getMemoryUsage() {
    const usage = process.memoryUsage();
    return { rss: usage.rss, heapUsed: usage.heapUsed, external: usage.external, arrayBuffers: usage.arrayBuffers || 0 };
}

function formatMB(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatServerStats(stats) {
    const mem = stats.memory || {};
    const processMem = mem.process || {};
    const cpu = stats.cpu || {};
    return [
        `CPU=${cpu.usage || 0}%`,
        `RSS=${formatMB(processMem.rss || 0)}`,
        `Heap=${formatMB(processMem.heapUsed || 0)}/${formatMB(processMem.heapTotal || 0)}`,
        `External=${formatMB(processMem.external || 0)}`,
        `ArrayBuffers=${formatMB(processMem.arrayBuffers || 0)}`
    ].join(' ');
}

function createCurveTracker() {
    return {
        points: [],
        peakRss: 0,
        peakHeapUsed: 0,
        peakExternal: 0,
        peakArrayBuffers: 0,
        push(stats) {
            const processMem = stats?.memory?.process || {};
            this.points.push({
                timestamp: stats?.timestamp || Date.now(),
                rss: processMem.rss || 0,
                heapUsed: processMem.heapUsed || 0,
                heapTotal: processMem.heapTotal || 0,
                external: processMem.external || 0,
                arrayBuffers: processMem.arrayBuffers || 0,
                cpu: Number(stats?.cpu?.usage || 0)
            });
            this.peakRss = Math.max(this.peakRss, processMem.rss || 0);
            this.peakHeapUsed = Math.max(this.peakHeapUsed, processMem.heapUsed || 0);
            this.peakExternal = Math.max(this.peakExternal, processMem.external || 0);
            this.peakArrayBuffers = Math.max(this.peakArrayBuffers, processMem.arrayBuffers || 0);
        }
    };
}

function buildAsciiChart(points, key, width) {
    if (!points.length) return '无数据';

    const values = points.map(item => item[key] || 0);
    const maxValue = Math.max(...values, 1);
    const minValue = Math.min(...values, 0);
    const span = Math.max(maxValue - minValue, 1);
    const step = Math.max(1, Math.ceil(values.length / width));
    const blocks = ' .:-=+*#%@';
    const samples = [];

    for (let i = 0; i < values.length; i += step) {
        const slice = values.slice(i, i + step);
        const avg = slice.reduce((sum, item) => sum + item, 0) / slice.length;
        const normalized = Math.min(blocks.length - 1, Math.max(0, Math.round(((avg - minValue) / span) * (blocks.length - 1))));
        samples.push(blocks[normalized]);
    }

    return `${formatMB(minValue)}|${samples.join('')}|${formatMB(maxValue)}`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const audioFile = resolveAudioFile(args.file);

    // 未指定 --file 时自动生成假音频
    if (!args.file || !fs.existsSync(args.file)) {
        generateAudioFile(audioFile, args.audioType, args.audioDuration);
    }

    const audioBuffer = fs.readFileSync(audioFile);
    const displayId = args.displayId || `asr-stress-${process.pid}-${Date.now().toString(36)}`;

    // ---- 不安全模式：跳过 HTTPS 证书校验（默认开启） ----
    if (args.insecure) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        console.log('[ASR压测] 不安全模式已启用，将跳过 TLS 证书校验（使用 --no-insecure 关闭）');
    }

    // ---- 连接显示端 WebSocket ----
    let displayClient = null;
    if (args.enableWS) {
        displayClient = new DisplayWSClient(args.url, displayId);
        console.log(`[ASR压测] 正在连接 WebSocket (displayId=${displayId})...`);
        await displayClient.connect();
        await displayClient.waitReady();
        console.log('[ASR压测] 显示端 WebSocket 已连接，能力已声明');
    } else {
        console.log('[ASR压测] WebSocket 模式已禁用 (--no-ws)');
    }

    // ---- 统计信息 ----
    const stats = {
        startedAt: Date.now(),
        success: 0,
        ignored: 0,
        busy429: 0,
        failed: 0,
        wsSentFailed: 0,
        totalLatencyMs: 0,
        maxLatencyMs: 0,
        attempts: 0
    };
    const serverCurve = createCurveTracker();

    let nextIndex = 0;
    let stopPolling = async () => {};

    console.log('[ASR压测] 启动');
    console.log(`[ASR压测] URL: ${args.url}`);
    console.log(`[ASR压测] 文件: ${audioFile} (${formatMB(audioBuffer.length)})`);
    console.log(`[ASR压测] 音频类型: ${describeAudioType(args.audioType)} (${args.audioDuration}s)`);
    console.log(`[ASR压测] 总请求: ${args.total}, 并发: ${args.concurrency}, 超时: ${args.timeout}ms`);
    console.log(`[ASR压测] 显示端模式: ${args.enableWS ? 'WebSocket + voiceInput' : '仅 HTTP'}`);
    console.log(`[ASR压测] 进程初始内存: RSS ${formatMB(getMemoryUsage().rss)}, Heap ${formatMB(getMemoryUsage().heapUsed)}`);

    if (args.pollSystemStats) {
        console.log(`[ASR压测] 已启用服务端 system-stats 采样，间隔 ${args.statsInterval}ms`);
        stopPolling = await startSystemStatsPolling(args.url, args.statsInterval, serverCurve);
    }

    async function worker(workerId) {
        while (true) {
            const current = nextIndex;
            nextIndex++;

            if (current >= args.total) return;

            try {
                const result = await recognize(args.url, audioBuffer, args.timeout, args.retry429);
                stats.totalLatencyMs += result.latency;
                stats.maxLatencyMs = Math.max(stats.maxLatencyMs, result.latency);
                stats.attempts += result.attempts;

                if (result.statusCode === 200 && result.payload) {
                    if (result.payload.status === 'success') {
                        stats.success++;

                        // 模拟真实显示端：通过 WebSocket 发送 voiceInput
                        if (displayClient && displayClient.connected && result.payload.text) {
                            try {
                                displayClient.sendVoiceInput(result.payload.text);
                            } catch (wsErr) {
                                stats.wsSentFailed++;
                            }
                        }
                    } else if (result.payload.status === 'ignored') {
                        stats.ignored++;
                    } else {
                        stats.failed++;
                        console.log(`[ASR压测][Worker ${workerId}] 请求 ${current + 1} 返回未知状态: ${result.raw}`);
                    }
                } else if (result.statusCode === 429) {
                    stats.busy429++;
                } else {
                    stats.failed++;
                    console.log(`[ASR压测][Worker ${workerId}] 请求 ${current + 1} 失败: HTTP ${result.statusCode} ${result.raw}`);
                }
            } catch (error) {
                stats.failed++;
                console.log(`[ASR压测][Worker ${workerId}] 请求 ${current + 1} 异常: ${error.message}`);
            }

            const done = stats.success + stats.ignored + stats.busy429 + stats.failed;
            if (done % args.outputEvery === 0 || done === args.total) {
                const mem = getMemoryUsage();
                console.log(
                    `[ASR压测] 进度 ${done}/${args.total} | ` +
                    `success=${stats.success} ignored=${stats.ignored} busy429=${stats.busy429} failed=${stats.failed} wsFail=${stats.wsSentFailed} | ` +
                    `RSS=${formatMB(mem.rss)} Heap=${formatMB(mem.heapUsed)}`
                );
            }
        }
    }

    const workers = [];
    for (let i = 0; i < args.concurrency; i++) {
        workers.push(worker(i + 1));
    }

    await Promise.all(workers);
    await stopPolling();

    if (displayClient) displayClient.close();

    const elapsed = Date.now() - stats.startedAt;
    const mem = getMemoryUsage();
    const avgLatency = stats.total > 0 ? (stats.totalLatencyMs / args.total).toFixed(1) : '0.0';

    console.log('[ASR压测] 完成');
    console.log(`[ASR压测] 耗时: ${elapsed}ms, 平均延迟: ${avgLatency}ms, 最大延迟: ${stats.maxLatencyMs}ms`);
    console.log(
        `[ASR压测] 结果: success=${stats.success} ignored=${stats.ignored} ` +
        `busy429=${stats.busy429} failed=${stats.failed} wsSentFailed=${stats.wsSentFailed} ` +
        `attempts=${stats.attempts}`
    );
    console.log(`[ASR压测] 进程结束内存: RSS ${formatMB(mem.rss)}, Heap ${formatMB(mem.heapUsed)}, External ${formatMB(mem.external)}, ArrayBuffers ${formatMB(mem.arrayBuffers)}`);

    if (args.pollSystemStats) {
        console.log(`[ASR压测] 服务端采样点数: ${serverCurve.points.length}`);
        console.log(
            `[ASR压测] 服务端峰值: RSS ${formatMB(serverCurve.peakRss)}, Heap ${formatMB(serverCurve.peakHeapUsed)}, ` +
            `External ${formatMB(serverCurve.peakExternal)}, ArrayBuffers ${formatMB(serverCurve.peakArrayBuffers)}`
        );
        console.log(`[ASR压测] 服务端RSS曲线: ${buildAsciiChart(serverCurve.points, 'rss', 48)}`);
        console.log(`[ASR压测] 服务端External曲线: ${buildAsciiChart(serverCurve.points, 'external', 48)}`);
        console.log(`[ASR压测] 服务端ArrayBuffers曲线: ${buildAsciiChart(serverCurve.points, 'arrayBuffers', 48)}`);
    }
}

main().catch((error) => {
    const msg = error.message || '';
    console.error('[ASR压测] 失败:', msg);
    process.exitCode = 1;
});
