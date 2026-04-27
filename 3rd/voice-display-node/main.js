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
const AudioPlayer = require('./audio-player');
const ServerASR = require('./asr-client');
const SubDisplayTUI = require('./tui');
const SystemMonitor = require('../../src/framework/observability/system-monitor');
const { installConsoleRedirect } = require('../../src/framework/observability/console-redirect');

const useTUI = !process.argv.includes('--no-tui');
const tui = new SubDisplayTUI({ enabled: useTUI });

installConsoleRedirect({
    enabled: useTUI,
    writeLog: (level, message) => {
        const category = level === 'error' ? '错误' : '系统';
        tui.addLog(category, message);
    }
});

function log(category, message) {
    if (useTUI) {
        tui.addLog(category, message);
    } else {
        const timestamp = new Date().toTimeString().split(' ')[0];
        console.log(`${timestamp} [${category}] ${message}`);
    }
}

function logError(category, message) {
    if (useTUI) {
        tui.addLog(category, message);
        return;
    }
    console.error(`[${category}] ${message}`);
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
        this.maxReconnectAttempts = 5;
        this.heartbeatInterval = null;
        this.heartbeatIntervalMs = 60 * 1000;
        this.asrPollTimer = null;
        this.recordingEnabled = true;
        this.lastRecognition = '';
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
            lastRecognition: this.lastRecognition || '-'
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
        }
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

    /**
     * 从 URL 播放音频
     * @param {string} audioUrl - 音频 URL
     */
    async playAudioFromURL(audioUrl) {
        if (!this.audio) {
            log('TTS', '音频播放器未初始化');
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
                const result = await this.asr.recognize(wavData);
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
        const delay = this.reconnectAttempts * 2000;

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

        this.setupPlaybackPause();

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
     * 设置播放时暂停录音的回调
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
        vadThreshold: 0.01
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
            maxReconnectAttempts: 5
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
    } catch (error) {
        logError('系统', `启动失败: ${error.message}`);
        if (systemMonitor) systemMonitor.stop();
        process.exit(1);
    }
}

main();
