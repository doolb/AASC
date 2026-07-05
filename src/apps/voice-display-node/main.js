/**
 * 纯语音输入输出显示端 - Node.js 实现
 * 
 * 功能:
 * - WebSocket 连接到主服务器
 * - 接收 TTS 音频播放
 * - 通过服务器端 ASR 发送语音输入
 * - 本地录音和 VAD 检测
 * 
 * 录音方式:
 * - 优先使用 @picovoice/pvrecorder-node (预编译，无需 Python)
 * - 回退到 naudiodon (需要 Python 编译)
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const URL = require('url');
const os = require('os');
const { exec } = require('child_process');
const AudioPlayer = require('./audio-player');
const ServerASR = require('./asr-client');
const SubDisplayTUI = require('./tui');
const SystemMonitor = require('../../framework/observability/system-monitor');
const { installConsoleRedirect } = require('../../framework/observability/console-redirect');

const useTUI = !process.argv.includes('--no-tui');
const tui = new SubDisplayTUI({ enabled: useTUI });

// 日志上报模块级状态
const LOG_LEVEL_WEIGHT = { error: 4, warn: 3, info: 2, debug: 1 };
let activeDisplayInstance = null;

function isClientLogEnabled(level) {
    const inst = activeDisplayInstance;
    if (!inst || !inst.logReportConfig || !inst.logReportConfig.enabled) return false;
    const cfgLevel = inst.logReportConfig.level || 'error';
    return (LOG_LEVEL_WEIGHT[level] || 0) >= (LOG_LEVEL_WEIGHT[cfgLevel] || 0);
}

function sendClientLog(level, category, message) {
    const inst = activeDisplayInstance;
    if (!inst || !inst.sendJSON) return;
    inst.sendJSON({
        type: 'clientLog',
        level: level,
        category: category || '系统',
        message: message,
        deviceType: 'display',
        deviceId: inst.config.displayId,
        timestamp: Date.now()
    });
}

function log(category, message) {
    if (useTUI) {
        tui.addLog(category, message);
    } else {
        const timestamp = new Date().toTimeString().split(' ')[0];
        console.log(`${timestamp} [${category}] ${message}`);
    }
    try {
        if (isClientLogEnabled('info')) {
            sendClientLog('info', category, message);
        }
    } catch (e) { /* 日志上报失败不影响主流程 */ }
}

function logError(category, message) {
    if (useTUI) {
        tui.addLog(category, message);
    }
    if (!useTUI) {
        console.error(`[${category}] ${message}`);
    }
    try {
        if (isClientLogEnabled('error')) {
            sendClientLog('error', category, message);
        }
    } catch (e) { /* 日志上报失败不影响主流程 */ }
}

let AudioRecorder;
try {
    AudioRecorder = require('./audio-recorder-pv');
    log('启动', '使用 PvRecorder 录音器 (无需 Python)');
} catch (e) {
    log('启动', 'PvRecorder 不可用，尝试 naudiodon...');
    try {
        AudioRecorder = require('./audio-recorder');
        log('启动', '使用 naudiodon 录音器');
    } catch (e2) {
        logError('启动', '警告: 没有可用的录音器，语音识别功能将不可用');
        logError('启动', '请安装 @picovoice/pvrecorder-node (推荐) 或 naudiodon');
        AudioRecorder = null;
    }
}

let AECProcessor;
try {
    AECProcessor = require('./aec-processor');
} catch (e) {
    // AEC 处理器可选，soft 模式需要
    AECProcessor = null;
}

class VoiceDisplay {
    /**
     * @param {Object} config - 配置对象
     */
    constructor(config) {
        this.config = config;
        this.ws = null;
        this.asr = null;
        this.audio = null;
        this.recorder = null;
        this.connected = false;
        this.stopController = new AbortController();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
        this.heartbeatInterval = null;
        this.heartbeatIntervalMs = 60 * 1000;
        this.asrPollTimer = null;
        this.recordingEnabled = true;
        this.lastRecognition = '';

        this.recordingMode = config.recordingMode || 'mute';
        this.aecProcessor = null;
        this.bargeInTriggered = false;
        this.logReportConfig = null; // { enabled, level } 由服务器推送
        this._volume = 100;
        this._serviceTasks = {}; // 长期运行的服务任务 { instanceId: { taskName, stop } }
    }

    updateTUIConnectionState() {
        if (!useTUI) return;
        tui.updateConnectionState({
            connected: this.connected,
            serverUrl: this.config.serverUrl,
            displayId: this.config.displayId,
            heartbeatStatus: this.heartbeatInterval ? '运行中' : '未启动',
            reconnectAttempts: this.reconnectAttempts,
            maxReconnectAttempts: this.maxReconnectAttempts
        });
    }

    updateTUIRecordingState() {
        if (!useTUI) return;
        tui.updateRecordingState({
            recordingEnabled: this.recordingEnabled,
            asrReady: this.asr ? this.asr.isReady() : false,
            vadStatus: this.recorder ? '运行中' : '未启动',
            playQueueSize: this.audio ? this.audio.queueLength || 0 : 0,
            lastRecognition: this.lastRecognition || '-',
            recordingMode: this.recordingMode
        });
    }

    /**
     * 连接到服务器
     * @returns {Promise<void>}
     */
    async connect() {
        const parsedUrl = URL.parse(this.config.serverUrl);
        const wsProtocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${parsedUrl.host}/display?subDisplay=true&displayId=${encodeURIComponent(this.config.displayId)}`;

        log('连接', `正在连接到 ${wsUrl}`);

        return new Promise((resolve, reject) => {
            const wsOptions = wsProtocol === 'wss:' ? {
                rejectUnauthorized: false
            } : undefined;
            
            this.ws = new WebSocket(wsUrl, wsOptions);

            this.ws.on('open', () => {
                this.connected = true;
                this.reconnectAttempts = 0;

                log('连接', `已连接，显示端ID: ${this.config.displayId}`);
                this.startHeartbeat();
                this.declareCapabilities();
                this.updateTUIConnectionState();
                resolve();
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.handleMessage(msg.type, msg);
                } catch (error) {
                    logError('错误', `解析消息失败: ${error.message}`);
                }
            });

            this.ws.on('close', () => {
                this.connected = false;
                log('断开', '连接已关闭');
                this.updateTUIConnectionState();
                this.reconnect();
            });

            this.ws.on('error', (error) => {
                logError('连接', `WebSocket错误: ${error.message}`);
                if (!this.connected) {
                    reject(error);
                }
            });
        });
    }

    /**
     * 发送 JSON 消息
     * @param {Object} data - 消息数据
     */
    sendJSON(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    declareCapabilities() {
        this.sendJSON({
            type: 'capabilities',
            capabilities: {
                mediaRendering: false,
                voicePlayback: true,
                voiceRecording: true,
                voiceRecognition: true,
                displayText: false
            }
        });
        log('能力', '已声明子显示端能力');
    }

    /**
     * 处理收到的消息
     * @param {string} msgType - 消息类型
     * @param {Object} data - 消息数据
     */
    handleMessage(msgType, data) {
        switch (msgType) {
            case 'displayId':
                log('连接', `收到显示端ID: ${data.id}, IP: ${data.ip}`);
                break;
            case 'serverStartTime':
                log('系统', `服务器启动时间: ${data.time}`);
                break;
            case 'logReportConfig':
                this.logReportConfig = { enabled: data.enabled, level: data.level || 'error' };
                log('系统', `日志上报配置已更新: ${this.logReportConfig.enabled ? '开启' : '关闭'} 级别=${this.logReportConfig.level}`);
                break;
            case 'configUpdate':
                this.handleConfigUpdate(data);
                break;
            case 'restoreState':
                log('系统', '收到恢复状态');
                break;
            case 'tts':
                this.handleTTS(data);
                break;
            case 'voiceInput':
                log('语音', '收到语音输入确认');
                break;
            case 'control':
                this.handleControl(data);
                break;
            case 'media':
                log('系统', `收到媒体指令（子显示端不支持媒体显示）: ${data.type}`);
                break;
            case 'reminder':
                this.handleReminder(data);
                break;
            case 'voiceCommand':
                this.handleVoiceCommand(data);
                break;
            case 'task:execute':
                this.handleTaskExecute(data.payload);
                break;
            case 'task:renderUpdate':
                // 子显示端无需处理渲染更新，静默忽略
                break;
            case 'task:stop':
                this.handleTaskStop(data);
                break;
            case 'capabilitiesUpdated':
                this.handleCapabilitiesUpdated(data);
                break;
            case 'asrConfig':
                this.handleAsrConfig(data);
                break;
            default:
                log('系统', `未知消息类型: ${msgType}`);
        }
    }

    handleControl(data) {
        log('系统', `收到控制指令: ${JSON.stringify(data)}`);

        if (data.action === 'setRecording') {
            if (data.enabled) {
                this.enableRecording();
            } else {
                this.disableRecording();
            }
        } else if (data.action === 'volume') {
            var vol = parseInt(data.value, 10);
            this._volume = isNaN(vol) ? 100 : vol;
            log('系统', '音量已设置为: ' + this._volume);
        }
    }

    handleCapabilitiesUpdated(data) {
        if (!data.capabilities) return;
        this._capabilities = data.capabilities;
        log('能力', '能力已更新: ' + JSON.stringify(data.capabilities));

        if (!data.capabilities.voicePlayback) {
            if (this.audio) {
                this.audio.stop();
                this.audio.clearQueue();
            }
            log('TTS', '语音播放能力已关闭，停止播报');
        }
        if (!data.capabilities.voiceRecording) {
            this.disableRecording();
        }
    }

    handleAsrConfig(data) {
        this._asrConfig = data;
        log('ASR', 'ASR 配置: device=' + data.device + ' localEnabled=' + data.localAsrEnabled);
    }

    handleConfigUpdate(data) {
        if (!data.config) return;
        try {
            const configPath = path.join(__dirname, 'config.json');
            const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const newConfig = { ...currentConfig, ...data.config };
            fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
            log('配置', `配置已更新: serverUrl=${newConfig.serverUrl}, displayId=${newConfig.displayId}`);
        } catch (err) {
            logError('配置', `配置更新失败: ${err.message}`);
        }
    }

    /**
     * 处理 TTS 消息
     * @param {Object} data - TTS 数据
     */
    async handleTTS(data) {
        const action = data.action;

        switch (action) {
            case 'playAudio':
                const audioUrl = data.audioUrl;
                const text = data.text;
                if (text) {
                    log('TTS', `播报: ${text}`);
                }
                if (audioUrl) {
                    await this.playAudioFromURL(audioUrl);
                }
                break;
            case 'play':
                const playText = data.text;
                if (playText) {
                    log('TTS', `播报文本: ${playText}`);
                }
                break;
            case 'stop':
                if (this.audio) {
                    this.audio.stop();
                    this.audio.clearQueue();
                }
                log('TTS', '停止播报并清空队列');
                break;
        }
    }

    /**
     * 处理提醒消息
     * @param {Object} data - 提醒数据
     */
    async handleReminder(data) {
        const action = data.action;

        switch (action) {
            case 'voice':
                if (data.audioUrl) {
                    log('提醒', `播报: ${data.text || ''}`);
                    await this.playAudioFromURL(data.audioUrl);
                }
                break;
            case 'popup':
                log('提醒', `弹窗: ${data.content || ''}`);
                break;
            default:
                log('提醒', `未知动作: ${action}`);
        }
    }

    /**
     * 处理语音命令消息
     * @param {Object} data - 语音命令数据
     */
    async handleVoiceCommand(data) {
        const action = data.action;

        switch (action) {
            case 'confirm':
                if (data.audioUrl) {
                    log('语音', `确认: ${data.text || ''}`);
                    await this.playAudioFromURL(data.audioUrl);
                }
                break;
            case 'response':
                if (data.audioUrl) {
                    log('语音', `响应: ${data.text || ''}`);
                    await this.playAudioFromURL(data.audioUrl);
                }
                break;
            case 'searchResult':
                if (data.audioUrl) {
                    log('语音', `搜索结果: ${data.text || ''}`);
                    await this.playAudioFromURL(data.audioUrl);
                }
                break;
            case 'weatherResult':
                if (data.audioUrl) {
                    log('语音', `天气结果: ${data.text || ''}`);
                    await this.playAudioFromURL(data.audioUrl);
                }
                break;
            case 'playChoices':
                if (data.audioUrl) {
                    log('语音', `播放选项: ${data.text || ''}`);
                    await this.playAudioFromURL(data.audioUrl);
                }
                break;
            default:
                if (data.audioUrl) {
                    log('语音', `${action}: ${data.text || ''}`);
                    await this.playAudioFromURL(data.audioUrl);
                }
        }
    }

    async handleTaskExecute(payload) {
        var taskName = payload.taskName;
        var instanceId = payload.instanceId;
        var entryFile = payload.entryFile;
        var files = payload.files || [];
        var params = payload.params || {};

        // 若已有同 instanceId 的服务在运行，先停止
        if (this._serviceTasks[instanceId]) {
            log('任务', '发现已有服务运行，先停止旧服务: ' + instanceId);
            try {
                if (typeof this._serviceTasks[instanceId].stop === 'function') {
                    this._serviceTasks[instanceId].stop();
                }
            } catch (_) {}
            if (this._serviceTasks[instanceId].tmpDir) {
                try { fs.rmSync(this._serviceTasks[instanceId].tmpDir, { recursive: true, force: true }); } catch (_) {}
            }
            delete this._serviceTasks[instanceId];
        }

        log('任务', '收到任务: ' + taskName + '/' + instanceId + ' 入口: ' + entryFile);

        var tmpDir = path.join(__dirname, 'run-task', 'task-' + instanceId);
        fs.mkdirSync(tmpDir, { recursive: true });

        var fileStore = {};
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f.data) {
                var filePath = path.join(tmpDir, f.name);
                var dir = path.dirname(filePath);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(filePath, Buffer.from(f.data, 'base64'));
                fileStore[f.name] = filePath;
            }
        }

        var entryPath = path.join(tmpDir, entryFile);
        if (!fs.existsSync(entryPath)) {
            this.sendJSON({
                type: 'task:result',
                payload: { taskName: taskName, instanceId: instanceId, success: false, error: '入口文件不存在: ' + entryFile }
            });
            return;
        }

        try {
            var context = {
                files: fileStore,
                params: params,
                workDir: tmpDir,
                // 持续推送函数：子显示端任务可调用 sendProgress(data) 发送实时数据
                sendProgress: function(data) {
                    this.sendJSON({
                        type: 'task:progress',
                        payload: { taskName: taskName, instanceId: instanceId, data: data }
                    });
                }.bind(this)
            };

            delete require.cache[require.resolve(entryPath)];
            var entry = require(entryPath);
            log('任务', 'DEBUG entry=' + (typeof entry) + ' keys=' + (entry ? Object.keys(entry).join(',') : 'N/A') + ' runFn=' + (entry && typeof entry.run));
            var run = typeof entry === 'function' ? entry : entry.run;

            if (typeof run !== 'function') {
                throw new Error('入口文件未导出 run 函数');
            }

            var result = await run(context);
            log('任务', 'DEBUG result=' + (typeof result) + ' stop=' + (result ? typeof result.stop : 'N/A') + ' isSvc=' + (result && typeof result.stop === 'function'));

            // 服务任务：run() 返回 { stop: fn }，保持运行直到被停止
            if (result && typeof result.stop === 'function') {
                this._serviceTasks[instanceId] = {
                    taskName: taskName,
                    stop: result.stop,
                    tmpDir: tmpDir
                };
                // 发送启动成功通知，使服务器将任务保持为 running 状态
                this.sendJSON({
                    type: 'task:result',
                    payload: { taskName: taskName, instanceId: instanceId, success: true, data: { serviceStarted: true } }
                });
                log('任务', '服务已启动: ' + taskName + '/' + instanceId);
                return; // 跳过 cleanup，保持资源直到 stop
            }

            this.sendJSON({
                type: 'task:result',
                payload: { taskName: taskName, instanceId: instanceId, success: true, data: result || {} }
            });
            log('任务', '任务完成: ' + taskName + '/' + instanceId);
        } catch (err) {
            logError('任务', '执行失败: ' + err.message);
            this.sendJSON({
                type: 'task:result',
                payload: { taskName: taskName, instanceId: instanceId, success: false, error: err.message, stack: err.stack }
            });
        } finally {
            // 服务任务的 cleanup 在 handleTaskStop 中处理
            if (!this._serviceTasks[instanceId]) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        }
    }

    handleTaskStop(msg) {
        var instanceId = msg.instanceId;
        var svc = this._serviceTasks[instanceId];
        if (!svc) {
            log('任务', '未找到运行中的服务: ' + instanceId);
            return;
        }

        try {
            if (typeof svc.stop === 'function') {
                svc.stop();
            }
            log('任务', '服务已停止: ' + svc.taskName + '/' + instanceId);
            this.sendJSON({
                type: 'task:result',
                payload: { taskName: svc.taskName, instanceId: instanceId, success: true }
            });
        } catch (err) {
            logError('任务', '服务停止失败: ' + err.message);
            this.sendJSON({
                type: 'task:result',
                payload: { taskName: svc.taskName, instanceId: instanceId, success: false, error: err.message }
            });
        }

        // 清理临时文件
        if (svc.tmpDir) {
            try { fs.rmSync(svc.tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
        delete this._serviceTasks[instanceId];
    }

    /**
     * 从 URL 播放音频
     * @param {string} audioUrl - 音频 URL
     */
    async playAudioFromURL(audioUrl) {
        if (!this.audio) {
            log('TTS', '音频播放器未初始化');
            return;
        }

        if (this._volume === 0) {
            log('TTS', '已静音，跳过播放');
            return;
        }

        const fullURL = `${this.config.serverUrl}${audioUrl}`;

        try {
            this.audio.queueURL(fullURL);
        } catch (error) {
            logError('TTS', `加入播放队列失败: ${error.message}`);
        }
    }

    /**
     * 发送语音输入
     * @param {string} text - 识别文本
     */
    sendVoiceInput(text) {
        if (!text) return;

        this.sendJSON({
            type: 'voiceInput',
            text: text,
            isFinal: true,
            fullText: text
        });

        log('语音', `已发送: ${text}`);
    }

    /**
     * 启动语音识别
     * @returns {Promise<void>}
     */
    async startVoiceRecognition() {
        if (!AudioRecorder) {
            logError('语音', '录音器不可用，语音识别功能将不可用');
            return;
        }

        if (!this.asr || !this.asr.isReady()) {
            logError('语音', '服务器端 ASR 不可用，语音识别功能将不可用');
            return;
        }

        log('语音', '开始语音识别（服务器端ASR）...');

        const onAudioData = async (wavData) => {
            try {
                let dataToSend = wavData;

                // SpeexDSP 模式：将 WAV 音频经过 AEC 后再送 ASR
                if (this.recordingMode === 'soft' && this.aecProcessor) {
                    const pcm = AudioRecorder.prototype.decodeWav
                        ? AudioRecorder.prototype.decodeWav(wavData)
                        : this._decodeWavSimple(wavData);
                    if (pcm) {
                        const processed = this.aecProcessor.processSamples(pcm);
                        dataToSend = this._encodeWavFromSamples(processed, 16000);
                    }
                }

                const result = await this.asr.recognize(dataToSend);
                if (result.status === 'success' && result.text) {
                    log('语音', `识别结果: ${result.text}`);
                    this.lastRecognition = result.text;
                    this.updateTUIRecordingState();
                    this.sendVoiceInput(result.text);
                } else if (result.status === 'ignored') {
                    log('语音', '服务器忽略该段音频');
                }
            } catch (error) {
                logError('语音', `服务器识别失败: ${error.message}`);
            }
        };

        this.recorder.start(onAudioData, {
            stopSignal: this.stopController.signal
        }).catch(error => {
            logError('语音', `录音错误: ${error.message}`);
        });
    }

    /**
     * 简单 WAV 解码（提取 PCM int16 采样）
     * @param {Buffer} wavData
     * @returns {Int16Array|null}
     */
    _decodeWavSimple(wavData) {
        try {
            if (wavData.toString('ascii', 0, 4) !== 'RIFF') return null;
            const dataSize = wavData.readUInt32LE(40);
            const sampleCount = Math.floor(dataSize / 2);
            if (44 + dataSize > wavData.length) return null;
            const samples = new Int16Array(sampleCount);
            for (let i = 0; i < sampleCount; i++) {
                samples[i] = wavData.readInt16LE(44 + i * 2);
            }
            return samples;
        } catch (e) {
            return null;
        }
    }

    /**
     * 从 int16 采样编码 WAV
     * @param {Int16Array} samples
     * @param {number} sampleRate
     * @returns {Buffer}
     */
    _encodeWavFromSamples(samples, sampleRate) {
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

    enableRecording() {
        this.recordingEnabled = true;
        if (this.recorder) {
            this.recorder.resume();
        }
        log('录音', '已通过远程指令开启录音');
        this.recordingEnabled = true;
        this.updateTUIRecordingState();
    }

    disableRecording() {
        this.recordingEnabled = false;
        if (this.recorder) {
            this.recorder.pause();
        }
        log('录音', '已通过远程指令关闭录音');
        this.recordingEnabled = false;
        this.updateTUIRecordingState();
    }

    /**
     * 重连机制
     */
    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            log('重连', '达到最大重连次数，退出');
            this.stop();
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectAttempts * 5000;

        log('重连', `第${this.reconnectAttempts}次尝试重连，${delay/1000}秒后...`);

        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            await this.connect();
            log('重连', '重连成功');
            this.updateTUIConnectionState();
        } catch (error) {
            logError('重连', `重连失败: ${error.message}`);
            this.reconnect();
        }
    }

    /**
     * 启动语音显示端
     * @returns {Promise<void>}
     */
    async start() {
        activeDisplayInstance = this;
        this.audio = new AudioPlayer();

        this.asr = new ServerASR(this.config.serverUrl);
        await this.asr.checkReady();
        if (!this.asr.isReady()) {
            log('ASR', '服务器端 ASR 不可用，语音识别功能将不可用');
        }

        if (AudioRecorder) {
            this.recorder = new AudioRecorder({
                sampleRate: 16000,
                vadThreshold: this.config.vadThreshold || 0.01,
                minSpeechDuration: 300
            });
        } else {
            log('录音', '录音器不可用，语音识别功能将不可用');
        }

        this.recordingMode = this.config.recordingMode || 'mute';
        log('录音', `录音模式: ${this.recordingMode}`);

        switch (this.recordingMode) {
            case 'mute':
                this.setupPlaybackPause();
                break;
            case 'cut':
                this.setupBargeIn();
                break;
            case 'hard':
                await this.setupSystemAEC();
                break;
            case 'soft':
                this.setupSpeexDSP();
                break;
            default:
                log('录音', `未知录音模式 ${this.recordingMode}，使用 mute`);
                this.setupPlaybackPause();
        }

        await this.connect();

        if (this.recorder && this.asr && this.asr.isReady()) {
            await this.startVoiceRecognition();
        } else if (this.recorder && this.asr && !this.asr.isReady()) {
            log('ASR', '等待ASR就绪...');
            this.waitForASRReady();
        }

        log('启动', '语音显示端已启动');
    }

    /**
     * 设置播放时暂停录音的回调（模式1: mute）
     */
    setupPlaybackPause() {
        if (!this.audio || !this.recorder) {
            return;
        }

        this.audio.onPlayStart = () => {
            log('录音', '播放开始，暂停录音');
            this.recorder.pause();
        };

        this.audio.onPlayEnd = () => {
            log('录音', '播放结束，恢复录音');
            if (this.recordingEnabled) {
                this.recorder.resume();
            }
        };
    }

    /**
     * 设置语音打断（模式2: cut）
     * 播放时继续录音，检测到人声即停止 TTS
     */
    setupBargeIn() {
        if (!this.audio || !this.recorder) {
            return;
        }

        this.bargeInTriggered = false;

        this.audio.onPlayStart = () => {
            this.bargeInTriggered = false;
            log('打断', '播放开始，进入打断待命');
        };

        this.audio.onPlayEnd = () => {
            log('打断', '播放结束');
            if (this.recordingEnabled && this.recorder.isPaused()) {
                this.recorder.resume();
            }
        };

        this.recorder.onSpeechStart = () => {
            if (this.audio.isCurrentlyPlaying() && !this.bargeInTriggered) {
                this.bargeInTriggered = true;
                log('打断', '检测到人声，停止播放');
                this.audio.stop();
                this.audio.clearQueue();
            }
        };
    }

    /**
     * 设置系统 AEC（模式3: hard）
     */
    async setupSystemAEC() {
        const platform = os.platform();

        if (platform === 'win32') {
            log('AEC', 'Windows: 尝试检测 WASAPI AEC 支持...');
            const available = await this.detectWASAPI_AEC();
            if (available) {
                log('AEC', 'WASAPI AEC 可用，播放时不暂停录音');
            } else {
                log('AEC', 'WASAPI AEC 不可用，降级到 mute');
                this.setupPlaybackPause();
            }
        } else if (platform === 'linux') {
            log('AEC', 'Linux: 尝试检测 PulseAudio echo-cancel...');
            const available = await this.detectPulseAudioAEC();
            if (available) {
                log('AEC', 'PulseAudio echo-cancel 可用，播放时不暂停录音');
            } else {
                log('AEC', 'PulseAudio echo-cancel 不可用，降级到 mute');
                this.setupPlaybackPause();
            }
        } else {
            log('AEC', `${platform} 不支持系统 AEC，降级到 mute`);
            this.setupPlaybackPause();
        }
    }

    /**
     * 设置 软 AEC (NLMS)（模式4: soft）
     */
    setupSpeexDSP() {
        if (!this.audio || !this.recorder) {
            log('AEC', '音频播放器或录音器不可用，降级到 mute');
            this.setupPlaybackPause();
            return;
        }

        if (!AECProcessor) {
            log('AEC', 'AEC 处理器不可用（缺少 aec-processor.js），降级到 mute');
            this.setupPlaybackPause();
            return;
        }

        this.aecProcessor = new AECProcessor({
            sampleRate: 16000,
            frameSize: 160
        });

        this.audio.onPlayStart = () => {
            log('AEC', '播放开始，AEC 处理中');
            if (this.aecProcessor) {
                this.aecProcessor.reset();
            }
        };

        this.audio.onPlayData = (samples, sampleRate) => {
            if (this.aecProcessor) {
                this.aecProcessor.setPlaybackReference(samples, sampleRate);
            }
        };

        this.audio.onPlayEnd = () => {
            log('AEC', '播放结束');
        };

        log('AEC', '软 AEC (NLMS) 已初始化，播放时不暂停录音');
    }

    /**
     * 动态切换录音模式
     * @param {string} mode - 录音模式: mute|cut|hard|soft
     */
    async setRecordingMode(mode) {
        const validModes = ['mute', 'cut', 'hard', 'soft'];
        if (!validModes.includes(mode)) {
            log('录音', `未知录音模式: ${mode}`);
            return;
        }

        // 清理当前模式的事件回调
        if (this.aecProcessor) {
            this.aecProcessor.destroy();
            this.aecProcessor = null;
        }
        this.recorder.onSpeechStart = null;

        this.recordingMode = mode;

        switch (mode) {
            case 'mute':
                this.setupPlaybackPause();
                break;
            case 'cut':
                this.setupBargeIn();
                // 从 mute 切到 cut 时，如果录音被暂停则恢复
                if (this.recorder && typeof this.recorder.isPaused === 'function' && this.recorder.isPaused()) {
                    this.recorder.resume();
                }
                break;
            case 'hard':
                await this.setupSystemAEC();
                break;
            case 'soft':
                this.setupSpeexDSP();
                break;
        }

        log('录音', `已切换录音模式: ${mode}`);
        this.updateTUIRecordingState();
    }

    /**
     * 检测 Windows WASAPI AEC 支持
     * @returns {Promise<boolean>}
     */
    detectWASAPI_AEC() {
        return new Promise((resolve) => {
            // 检查 Windows 版本（WASAPI AEC 需要 Windows 8+，即 6.2+）
            exec('powershell -c "$v=[Environment]::OSVersion.Version; Write-Output \\"$($v.Major).$($v.Minor)\\""', {
                timeout: 5000
            }, (error, stdout) => {
                if (error) {
                    log('AEC', '无法检测 Windows 版本，WASAPI AEC 不可用');
                    resolve(false);
                    return;
                }

                const ver = stdout.trim();
                const parts = ver.split('.').map(Number);
                const major = parts[0] || 0;
                const minor = parts[1] || 0;
                const isWin8Plus = (major > 6) || (major === 6 && minor >= 2);

                if (isWin8Plus) {
                    log('AEC', `Windows ${ver}: WASAPI AEC 可用（录音器需使用 AUDCLNT_STREAMFLAGS_ECHO_CANCELLATION 标志）`);
                    resolve(true);
                } else {
                    log('AEC', `Windows ${ver}: 版本过低，WASAPI AEC 需要 Windows 8+`);
                    resolve(false);
                }
            });
        });
    }

    /**
     * 检测 Linux PulseAudio echo-cancel 支持
     * @returns {Promise<boolean>}
     */
    detectPulseAudioAEC() {
        return new Promise((resolve) => {
            // 先检查是否已有 echo-cancel source
            exec('pactl list sources short 2>/dev/null | grep -i echo', {
                timeout: 3000
            }, (error, stdout) => {
                if (!error && stdout.trim()) {
                    log('AEC', '检测到 PulseAudio echo-cancel source');
                    resolve(true);
                    return;
                }

                // 没有现成的 echo-cancel source，尝试自动加载
                log('AEC', '未找到 echo-cancel source，尝试加载 module-echo-cancel...');
                exec('pactl load-module module-echo-cancel 2>/dev/null', {
                    timeout: 5000
                }, (loadError, loadStdout) => {
                    if (!loadError && loadStdout.trim()) {
                        const moduleId = loadStdout.trim();
                        log('AEC', `module-echo-cancel 已加载 (id=${moduleId})`);
                        resolve(true);
                    } else {
                        log('AEC', '无法加载 module-echo-cancel，系统 AEC 不可用');
                        resolve(false);
                    }
                });
            });
        });
    }

    /**
     * 等待ASR就绪后自动开始录音
     */
    waitForASRReady() {
        if (this.asrPollTimer) {
            clearInterval(this.asrPollTimer);
        }

        this.asrPollTimer = setInterval(async () => {
            try {
                const ready = await this.asr.checkReady();
                if (ready) {
                    clearInterval(this.asrPollTimer);
                    this.asrPollTimer = null;
                    log('ASR', '服务器端ASR已就绪，启动语音识别');
                    await this.startVoiceRecognition();
                }
            } catch (error) {
                logError('ASR', `检查ASR状态失败: ${error.message}`);
            }
        }, 5000);
    }

    /**
     * 停止语音显示端
     */
    stop() {
        this.stopController.abort();
        this.stopHeartbeat();

        if (this.asrPollTimer) {
            clearInterval(this.asrPollTimer);
            this.asrPollTimer = null;
        }

        if (this.recorder) {
            this.recorder.stop();
        }
        if (this.audio) {
            this.audio.stop();
        }
        if (this.aecProcessor) {
            this.aecProcessor.destroy();
            this.aecProcessor = null;
        }
        if (this.asr) {
            this.asr.close();
        }
        if (this.ws) {
            this.ws.close();
        }

        log('停止', '语音显示端已停止');
    }

    startHeartbeat() {
        this.stopHeartbeat();
        
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.sendJSON({ type: 'heartbeat' });
            }
        }, this.heartbeatIntervalMs);
        
        log('心跳', `已启动，间隔 ${this.heartbeatIntervalMs / 1000} 秒`);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
}

/**
 * 加载配置文件
 * @param {string} configPath - 配置文件路径
 * @returns {Object}
 */
function loadConfig(configPath) {
    const defaultConfig = {
        serverUrl: 'http://localhost:3000',
        displayId: 'voice-display-node-1',
        vadThreshold: 0.01,
        maxReconnectAttempts: 5,
        recordingMode: 'mute'
    };

    try {
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        return { ...defaultConfig, ...config };
    } catch (error) {
        logError('配置', `加载配置文件失败，使用默认配置: ${error.message}`);
        return defaultConfig;
    }
}

/**
 * 主函数
 */
async function main() {
    const configPath = process.argv[2] || path.join(__dirname, 'config.json');
    const config = loadConfig(configPath);

    const voiceDisplay = new VoiceDisplay(config);

    let systemMonitor = null;

    if (useTUI) {
        tui.displayId = config.displayId || 'unknown';
        tui.headerBox.setContent(` Voice Display Node - ${config.displayId || 'unknown'} `);
        tui.updateConnectionState({
            connected: false,
            serverUrl: config.serverUrl,
            displayId: config.displayId,
            heartbeatStatus: '未启动',
            reconnectAttempts: 0,
            maxReconnectAttempts: config.maxReconnectAttempts || 5
        });

        systemMonitor = new SystemMonitor({ intervalMs: 5000 });
        systemMonitor.onStats((stats) => {
            tui.updateSystemStats(stats);
        });
        systemMonitor.start();
        tui.updateSystemStats(systemMonitor.getStats());
    }

    process.on('SIGINT', () => {
        log('系统', '\n收到退出信号，正在关闭...');
        if (systemMonitor) systemMonitor.stop();
        voiceDisplay.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        if (systemMonitor) systemMonitor.stop();
        voiceDisplay.stop();
        process.exit(0);
    });

    try {
        await voiceDisplay.start();

        // 连接建立后才初始化文本输入栏，确保 sendVoiceInput 能成功发送
        if (useTUI) {
            tui.currentMode = voiceDisplay.recordingMode;
            tui.onModeChange = async (mode) => {
                await voiceDisplay.setRecordingMode(mode);
            };
            tui.initChatInputBar((text) => {
                voiceDisplay.sendVoiceInput(text);
            });
        }
    } catch (error) {
        logError('系统', `启动失败: ${error.message}`);
        if (systemMonitor) systemMonitor.stop();
        process.exit(1);
    }
}

main();
