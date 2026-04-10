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

let AudioRecorder;
try {
    AudioRecorder = require('./audio-recorder-pv');
    console.log('[初始化] 使用 PvRecorder 录音器 (无需 Python)');
} catch (e) {
    console.log('[初始化] PvRecorder 不可用，尝试 naudiodon...');
    try {
        AudioRecorder = require('./audio-recorder');
        console.log('[初始化] 使用 naudiodon 录音器');
    } catch (e2) {
        console.warn('[初始化] 警告: 没有可用的录音器，语音识别功能将不可用');
        console.warn('[初始化] 请安装 @picovoice/pvrecorder-node (推荐) 或 naudiodon');
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
    }

    /**
     * 连接到服务器
     * @returns {Promise<void>}
     */
    async connect() {
        const parsedUrl = URL.parse(this.config.serverUrl);
        const wsProtocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${parsedUrl.host}/display?subDisplay=true&displayId=${encodeURIComponent(this.config.displayId)}`;

        console.log(`[连接] 正在连接到 ${wsUrl}`);

        return new Promise((resolve, reject) => {
            const wsOptions = wsProtocol === 'wss:' ? {
                rejectUnauthorized: false
            } : undefined;
            
            this.ws = new WebSocket(wsUrl, wsOptions);

            this.ws.on('open', () => {
                this.connected = true;
                this.reconnectAttempts = 0;

                console.log(`[连接] 已连接，显示端ID: ${this.config.displayId}`);
                resolve();
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.handleMessage(msg.type, msg);
                } catch (error) {
                    console.error('[消息] 解析消息失败:', error.message);
                }
            });

            this.ws.on('close', () => {
                this.connected = false;
                console.log('[连接] 连接已关闭');
                this.reconnect();
            });

            this.ws.on('error', (error) => {
                console.error('[连接] WebSocket错误:', error.message);
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

    /**
     * 处理收到的消息
     * @param {string} msgType - 消息类型
     * @param {Object} data - 消息数据
     */
    handleMessage(msgType, data) {
        switch (msgType) {
            case 'displayId':
                console.log(`[消息] 收到显示端ID: ${data.id}, IP: ${data.ip}`);
                break;
            case 'serverStartTime':
                console.log(`[消息] 服务器启动时间: ${data.time}`);
                break;
            case 'restoreState':
                console.log(`[消息] 收到恢复状态`);
                break;
            case 'tts':
                this.handleTTS(data);
                break;
            case 'voiceInput':
                console.log('[消息] 收到语音输入确认');
                break;
            case 'control':
                console.log('[消息] 收到控制指令:', data);
                break;
            case 'media':
                console.log('[消息] 收到媒体指令（子显示端不支持媒体显示）:', data.type);
                break;
            default:
                console.log('[消息] 未知消息类型:', msgType);
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
                    console.log(`[TTS] 播报: ${text}`);
                }
                if (audioUrl) {
                    await this.playAudioFromURL(audioUrl);
                }
                break;
            case 'play':
                const playText = data.text;
                if (playText) {
                    console.log(`[TTS] 播报文本: ${playText}`);
                }
                break;
            case 'stop':
                if (this.audio) {
                    this.audio.stop();
                }
                console.log('[TTS] 停止播报');
                break;
        }
    }

    /**
     * 从 URL 播放音频
     * @param {string} audioUrl - 音频 URL
     */
    async playAudioFromURL(audioUrl) {
        if (!this.audio) {
            console.log('[TTS] 音频播放器未初始化');
            return;
        }

        const fullURL = `${this.config.serverUrl}${audioUrl}`;

        try {
            await this.audio.playFromURL(fullURL);
        } catch (error) {
            console.error('[TTS] 播放音频失败:', error.message);
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

        console.log(`[语音] 已发送: ${text}`);
    }

    /**
     * 启动语音识别
     * @returns {Promise<void>}
     */
    async startVoiceRecognition() {
        if (!AudioRecorder) {
            console.log('[语音] 录音器不可用，语音识别功能将不可用');
            return;
        }

        if (!this.asr || !this.asr.isReady()) {
            console.log('[语音] 服务器端 ASR 不可用，语音识别功能将不可用');
            return;
        }

        console.log('[语音] 开始语音识别（服务器端ASR）...');

        const onAudioData = async (wavData) => {
            try {
                const result = await this.asr.recognize(wavData);
                if (result.status === 'success' && result.text) {
                    console.log(`[语音] 识别结果: ${result.text}`);
                    this.sendVoiceInput(result.text);
                } else if (result.status === 'ignored') {
                    console.log('[语音] 服务器忽略该段音频');
                }
            } catch (error) {
                console.error('[语音] 服务器识别失败:', error.message);
            }
        };

        this.recorder.start(onAudioData, {
            stopSignal: this.stopController.signal
        }).catch(error => {
            console.error('[语音] 录音错误:', error.message);
        });
    }

    /**
     * 重连机制
     */
    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[重连] 达到最大重连次数，退出');
            this.stop();
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectAttempts * 2000;

        console.log(`[重连] 第${this.reconnectAttempts}次尝试重连，${delay/1000}秒后...`);

        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            await this.connect();
            console.log('[重连] 重连成功');
        } catch (error) {
            console.error('[重连] 重连失败:', error.message);
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
        if (!this.asr.isReady()) {
            console.log('[警告] 服务器端 ASR 不可用，语音识别功能将不可用');
        }

        if (AudioRecorder) {
            this.recorder = new AudioRecorder({
                sampleRate: 16000,
                vadThreshold: this.config.vadThreshold || 0.01,
                minSpeechDuration: 300
            });
        } else {
            console.log('[警告] 录音器不可用，语音识别功能将不可用');
        }

        await this.connect();

        if (this.recorder && this.asr && this.asr.isReady()) {
            await this.startVoiceRecognition();
        }

        console.log('[启动] 语音显示端已启动');
    }

    /**
     * 停止语音显示端
     */
    stop() {
        this.stopController.abort();

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

        console.log('[停止] 语音显示端已停止');
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
        console.warn(`[配置] 加载配置文件失败，使用默认配置: ${error.message}`);
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

    process.on('SIGINT', () => {
        console.log('\n收到退出信号，正在关闭...');
        voiceDisplay.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        voiceDisplay.stop();
        process.exit(0);
    });

    try {
        await voiceDisplay.start();
    } catch (error) {
        console.error('启动失败:', error.message);
        process.exit(1);
    }
}

main();
