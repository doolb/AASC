const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pipeline } = require('stream');
const multer = require('multer');
const config = require('../modules/config/config-app-service');
const LogFileWriter = require('../../../framework/observability/log-file-writer');

// 移除 Markdown 标记，用于 TTS 播报前的文本清洗
function stripMarkdown(text) {
    return text
        .replace(/```[\s\S]*?```/g, '')           // 代码块
        .replace(/`([^`]+)`/g, '$1')                // 行内代码
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')   // 图片 ![alt](url)
        .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')    // 链接 [text](url)
        .replace(/\[source_group_web_\d+\]/g, '')   // LLM 联网搜索引用标记
        .replace(/\[\([^)]*\)\]/g, '')              // 内部标记标签 [(video_note_list_1)]
        .replace(/#{1,6}\s+/g, '')                  // 标题标记
        .replace(/(\*{1,3}|_{1,3}|~~)(.*?)\1/g, '$2') // 粗体/斜体/删除线
        .replace(/^[>\s]*>/gm, '')                  // 引用标记
        .replace(/^[-*+]\s+/gm, '')                 // 无序列表标记
        .replace(/^\d+[.)]\s+/gm, '')               // 有序列表标记
        .replace(/^---+\s*$/gm, '')                 // 分隔线
        .replace(/^\|.+\|$/gm, (m) => m.replace(/\|/g, ' ').replace(/:\s*[-]+\s*/g, '')) // 表格行 → 纯文本
        .replace(/\n{3,}/g, '\n\n')                 // 过多空行压缩
        .trim();
}
const tts = require('../../../external/tts/tts-service');
const asr = require('../../../external/asr/asr-service');
const timeListener = require('../../web-mediacenter/modules/time/time-listener-app-service');
const chat = require('../../../external/llm/llm-service');
const reminder = require('../../web-mediacenter/modules/reminder/reminder-app-service');
const voiceCommand = require('../../web-mediacenter/modules/voice/voice-command-app-service');
const { MediaLibraryManager } = require('../../web-mediacenter/modules/media/media-library-app-service');
const { SubServerManager } = require('../../../framework/cluster/sub-server-manager');
const { WSViewBindServer } = require('../../../core/viewbind');
const LogBuffer = require('../../../framework/observability/log-buffer');
const SystemMonitor = require('../../../framework/observability/system-monitor');
const LogBrain = require('../../../framework/observability/log-brain');
const { registerLogBrainApi } = require('../api/log-brain-api');
const TaskManager = require('../modules/task-engine/task-manager');
const { registerTaskHandlers } = require('../modules/task-engine/web-socket-handler');
const ServerTUI = require('../../../framework/observability/server-tui');
const { installConsoleRedirect } = require('../../../framework/observability/console-redirect');

const useTUI = !process.argv.includes('--no-tui');
const tui = new ServerTUI({ enabled: useTUI });

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

config.loadConfig();

const logBuffer = new LogBuffer({ maxSize: 1000 });
const logFileWriter = new LogFileWriter(path.join(__dirname, '../../../../logs'));
let logBlocklist = config.get('logBlocklist', []);
logBuffer.onLogEntry(entry => {
    if (logBlocklist.includes(entry.category)) return;
    logFileWriter.add(entry);
});
const systemMonitor = new SystemMonitor({ intervalMs: 5000 });
const logBrain = new LogBrain({
    logSource: logBuffer,
    statsSource: systemMonitor,
    maxContextEntries: 500,
    errorThreshold: config.get('logBrain.errorThreshold', 1),
    warnThreshold: config.get('logBrain.warnThreshold', 20),
    memoryWarningThreshold: config.get('logBrain.memoryWarningThreshold', 85),
    defaultTimeRange: config.get('logBrain.defaultTimeRange', '10m')
});

// 日志上报配置存储
const logReportStore = {
    display: config.get('logReportDisplay', { enabled: false, level: 'error' }),
    displayOverrides: new Map(),
    control: config.get('logReportControl', { enabled: false, level: 'error' })
};
const LOG_LEVEL_WEIGHT = { error: 4, warn: 3, info: 2, debug: 1 };
function isLevelEnabled(configLevel, logLevel) {
    return (LOG_LEVEL_WEIGHT[logLevel] || 0) >= (LOG_LEVEL_WEIGHT[configLevel] || 0);
}
function generateCorrelationId(type) {
    return `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}
function sendLogReportConfigToDisplay(displayId, config) {
    const displayData = displayClients.get(displayId);
    if (displayData && displayData.ws.readyState === WebSocket.OPEN) {
        displayData.ws.send(JSON.stringify({ type: 'logReportConfig', enabled: config.enabled, level: config.level }));
    }
}
function getDisplayLogReportConfig(displayId) {
    return logReportStore.displayOverrides.get(displayId) || logReportStore.display;
}
function sendLogReportConfigToAllDisplays() {
    displayClients.forEach((_, displayId) => {
        sendLogReportConfigToDisplay(displayId, getDisplayLogReportConfig(displayId));
    });
}

function log(category, message, extra) {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const entry = logBuffer.add(category, message, extra);
    logBrain.ingest(entry);
    if (useTUI) {
        tui.addLog(category, message);
    } else {
        console.log(`${timestamp} [${category}] ${message}`);
    }
}

function logError(category, message, extra) {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const entry = logBuffer.add(category, message, extra);
    logBrain.ingest(entry);
    if (useTUI) {
        tui.addLog(category, message);
    } else {
        console.error(`${timestamp} [${category}] ${message}`);
    }
}

// TUI 模式下重定向 console.*，避免第三方库破坏 blessed 渲染
installConsoleRedirect({
    enabled: useTUI,
    writeLog: (level, message) => {
        const category = (level === 'error') ? '错误' : '系统';
        tui.addLog(category, message);
    }
});

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function getRssLayout() {
    try {
        const smaps = fs.readFileSync('/proc/self/smaps_rollup', 'utf8');
        const rss = smaps.match(/Rss:\s+(\d+)/);
        const pss = smaps.match(/Pss:\s+(\d+)/);
        const heap = process.memoryUsage();
        const mb = (v) => (v / 1024).toFixed(0);
        let parts = [];
        if (rss) parts.push(`RSS:${mb(rss[1])}MB`);
        if (pss) parts.push(`PSS:${mb(pss[1])}MB`);
        parts.push(`Heap:${(heap.heapUsed/1024/1024).toFixed(1)}MB`);
        parts.push(`Ext:${(heap.external/1024/1024).toFixed(1)}MB`);
        return parts.join(' ');
    } catch (e) {
        const heap = process.memoryUsage();
        return `Heap:${(heap.heapUsed/1024/1024).toFixed(1)}MB Ext:${(heap.external/1024/1024).toFixed(1)}MB`;
    }
}

function getTopSmapsRss(topN = 8) {
    try {
        const smaps = fs.readFileSync('/proc/self/smaps', 'utf8');
        const regions = [];
        let current = null;
        const lines = smaps.split('\n');
        for (const line of lines) {
            const addrMatch = line.match(/^([0-9a-f]+)-([0-9a-f]+)\s+(.{4})\s+.+?\s+.+?\s+(\d+)\s+(.*)$/);
            if (addrMatch) {
                if (current && current.rss > 1024) regions.push(current);
                const path = addrMatch[5] || '';
                const perms = addrMatch[3];
                current = { name: path ? `${path}(${perms})` : `[anon](${perms})`, rss: 0 };
            } else if (current && line.startsWith('Rss:')) {
                const v = parseInt(line.match(/\d+/)?.[0] || '0', 10);
                if (!isNaN(v)) current.rss = v;
            }
        }
        if (current && current.rss > 1024) regions.push(current);
        regions.sort((a, b) => b.rss - a.rss);
        const mb = (v) => (v / 1024).toFixed(1);
        return regions.slice(0, topN).map(r => `${r.name}:${mb(r.rss)}MB`).join(' ');
    } catch (e) {
        return `[smaps解析失败: ${e.message}]`;
    }
}

const app = express();

const PORT = config.get('server.port', 8081);
const RES_DIR = path.join(PROJECT_ROOT, 'res');
const UPLOADS_DIR = path.join(RES_DIR, 'uploads');
const ASR_TEMP_DIR = path.join(RES_DIR, 'temp', 'asr');
const HTTP_UPLOAD_TEMP_DIR = path.join(RES_DIR, 'temp', 'uploads');

const sslKeyPath = path.join(RES_DIR, 'certs', 'key.pem');
const sslCertPath = path.join(RES_DIR, 'certs', 'cert.pem');

let server;
let useHttps = false;

if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
    const sslOptions = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
    };
    server = https.createServer(sslOptions, app);
    useHttps = true;
} else {
    server = http.createServer(app);
    useHttps = false;
}

const wss = new WebSocket.Server({ server, maxPayload: 500 * 1024 * 1024 });

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

if (!fs.existsSync(ASR_TEMP_DIR)) {
    fs.mkdirSync(ASR_TEMP_DIR, { recursive: true });
}

let displayClients = new Map();
let controlClients = new Set();
let serverStartTime = Date.now();
let muteState = {
    isMuted: false,
    previousVolumes: new Map()
};

let wsServer = null;
const runtimeBridgeClients = new Map();

const pendingDisplayAsrRequests = new Map();
let pendingAsrRequestId = 0;

tts.init(config.getTtsConfig());
asr.init(config.get('asr', {}));
chat.init(config.get('chat', {}));
reminder.init();
voiceCommand.init(config.get('voiceCommand', {}));
// 加载指令分级路由配置
const savedRouting = config.get('voiceCommand.routing');
if (savedRouting) {
    voiceCommand.setCommandRouting(savedRouting);
}

const IGNORED_PATTERNS = [
    /^(the|a|an|is|are|was|were|it|this|that|so|um|uh|oh|ah|yeah|yes|no|ok|okay|hey|hi|hello)[.!?]?$/i,
    /^[a-z]{1,3}[.!?]?$/i,
    /^[\s\p{P}]+$/u,
    /^[\s.!?，。！？、]+$/
];

function hasValidContent(text) {
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    const hasEnglish = /[a-zA-Z]/.test(text);
    const hasNumber = /[0-9]/.test(text);

    if (!hasChinese && !hasEnglish && !hasNumber) {
        return false;
    }

    if (config.get('asr.requireChinese', false) && !hasChinese) {
        log('\u8bed\u97f3', `\u5ffd\u7565\u975e\u4e2d\u6587\u8f93\u5165: "${text}"`);
        return false;
    }
    
    const trimmed = text.trim().toLowerCase();
    
    for (const pattern of IGNORED_PATTERNS) {
        if (pattern.test(trimmed)) {
            log('语音', `屏蔽无效输入: "${text}" 匹配规则: ${pattern}`);
            return false;
        }
    }
    
    const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;
    if (hasEnglish && !hasChinese && wordCount < 2) {
        const cleanWord = trimmed.replace(/[.!?，。！？]/g, '');
        if (cleanWord.length < 4) {
            log('语音', `屏蔽短输入: "${text}"`);
            return false;
        }
    }
    
    if (hasChinese) {
        const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
        if (chineseChars.length < 2) {
            log('语音', `屏蔽短中文输入: "${text}"`);
            return false;
        }
    }
    
    return true;
}

const mediaLibraryManager = new MediaLibraryManager({
    configPath: path.join(PROJECT_ROOT, 'config', 'media-libraries.json'),
    getPort: () => PORT,
    getLocalIP: getLocalIP,
    isHttps: () => useHttps
});

const subServerManager = new SubServerManager();

const subServerConfig = config.get('subServers');
if (subServerConfig) {
    subServerManager.loadFromConfig(subServerConfig);
    subServerManager.startHealthCheck();
}

mediaLibraryManager.init().then(() => {
    log('媒体库', '媒体库初始化完成');
    
    const localRoutes = mediaLibraryManager.getLocalLibraryRoutes();
    localRoutes.forEach(route => {
        app.use(route.routePrefix, express.static(route.basePath));
        log('媒体库', `静态路由: ${route.routePrefix} -> ${route.basePath}`);
    });
    
    startServer();
}).catch(err => {
    logError('媒体库', `初始化失败: ${err.message}`);
    startServer();
});

function startServer() {
    const localIP = getLocalIP();
    const protocol = useHttps ? 'https' : 'http';

    updateVoiceDisplayConfig(localIP, PORT, protocol);

    server.listen(PORT, '0.0.0.0', async () => {
        log('系统', '媒体中心服务器已启动');
        log('系统', `上传端地址: ${protocol}://${localIP}:${PORT}/upload`);
        log('系统', `显示端地址: ${protocol}://${localIP}:${PORT}/display`);
        if (useHttps) {
            log('系统', 'HTTPS 已启用，支持麦克风等安全特性');
        } else {
            log('系统', 'HTTP 模式，麦克风功能需要 HTTPS 或 localhost');
        }

        tui.setHeader(protocol, localIP, PORT);

        timeListener.start();
        reminder.start(displayClients, sendToDisplay);
        voiceCommand.setClients(displayClients, sendToDisplay, broadcastToControls);
        voiceCommand.setMediaLibrary(mediaLibraryManager);
        voiceCommand.setMuteFunctions(muteAllDisplays, unmuteAllDisplays);

        // 初始化指令模式状态
        const initialCommandMode = config.get('voiceCommand.commandMode', true);
        const session = chat.getSession();
        if (session.commandMode !== initialCommandMode) {
            session.commandMode = initialCommandMode;
            chat.setSession(session);
        }

        try {
            wsServer = new WSViewBindServer();
            wsServer.setCallbacks({
                onDisplayConnect: (displayId, clientIP, ws) => {
                    log('WS', `显示端连接: ${displayId} (${clientIP})`);
                },
                onDisplayDisconnect: (displayId) => {
                    log('WS', `显示端断开: ${displayId}`);
                },
                onControlConnect: (ws) => {
                    log('WS', '控制端连接');
                },
                onControlDisconnect: (ws) => {
                    log('WS', '控制端断开');
                }
            });

            // 注册显示端消息 handler // 委托给现有的 handleDisplayMessageFallback
            const displayTypes = ['canvasSize', 'browserInfo', 'voiceInput', 'voiceStatus', 'capabilities', 'commandAck'];
            for (const type of displayTypes) {
                wsServer.registerHandler(type, (data, ctx) => {
                    handleDisplayMessageFallback(ctx.displayId, data, ctx.ws);
                });
            }

            // audioChunk handler：显示端→服务端的音频流识别 // 分片累积后调 asr.recognize
            const audioChunkSessions = new Map();
            wsServer.registerHandler('audioChunk', (data, ctx) => {
                const { requestId, chunk, isLast, sampleRate } = data;
                if (!requestId || !chunk) return;

                let session = audioChunkSessions.get(requestId);
                if (!session) {
                    const timer = setTimeout(() => {
                        audioChunkSessions.delete(requestId);
                        log('语音', `显示端音频流超时: ${requestId}`);
                    }, 30000);
                    session = { chunks: [], timer, lastSeen: Date.now() };
                    audioChunkSessions.set(requestId, session);
                }
                session.lastSeen = Date.now();
                session.chunks.push(Buffer.from(chunk, 'base64'));

                if (isLast) {
                    clearTimeout(session.timer);
                    audioChunkSessions.delete(requestId);
                    const fullBuffer = Buffer.concat(session.chunks);
                    try {
                        const text = asr.recognize(fullBuffer);
                        if (text) {
                            broadcastToControls({
                                type: 'voiceInput',
                                text,
                                displayId: ctx.displayId,
                                isFinal: true
                            });
                            handleControlMessageFallback({
                                type: 'voiceCommand',
                                text,
                                displayId: ctx.displayId
                            }, ctx.ws);
                        }
                    } catch (err) {
                        logError('语音', `显示端音频识别失败: ${err.message}`);
                    }
                }
            });

            // 注册控制端消息 handler // 委托给现有的 handleControlMessageFallback
            const controlTypes = [
                'voiceCommand', 'confirmVoiceCommand', 'getSearchHistory', 'clearSearchHistory',
                'deleteSearchHistory', 'getAssistantConfig', 'setAssistantConfig', 'timeAnnounce',
                'getReminders', 'chatHistory', 'clearChatHistory', 'getChatSession', 'setChatSession',
                'getChatCommands', 'setChatCommands', 'mute', 'unmute', 'todayReminders',
                'tomorrowReminders', 'mediaBatch', 'tts', 'getState', 'media', 'control', 'chat',
                'chatMessage', 'executeCommands', 'switchProfile',
                'getCommandRouting', 'updateCommandRouting'
            ];
            for (const type of controlTypes) {
                wsServer.registerHandler(type, async (data, ctx) => {
                    await handleControlMessageFallback(data, ctx.ws);
                });
            }

            // 聊天式日志系统：ViewBind 绑定 // 节流推送日志到控制端
            const logViewBind = new (require('../../../core/viewbind/ViewBind'))({
                entries: logBuffer.buffer,
                filter: { levels: [], devices: [] },
                sessions: []
            });
            let logThrottleTimer = null;
            logViewBind.bind(() => {
                if (logThrottleTimer) return;
                logThrottleTimer = setTimeout(() => {
                    logThrottleTimer = null;
                    const tail = logViewBind.data.entries.slice(-50);
                    broadcastToControls({ type: 'logUpdate', entries: tail });
                }, 200);
            });
            logBuffer.onLogEntry((entry) => {
                const filter = logViewBind.data.filter;
                if (filter.levels.length > 0 && !filter.levels.includes(entry.level)) return;
                if (filter.devices.length > 0 && !filter.devices.includes(entry.device)) return;
                logViewBind.data = {
                    ...logViewBind.data,
                    entries: [...logViewBind.data.entries, entry]
                };
            });

            // 日志订阅 handler // 单聊/群聊/级别过滤
            wsServer.registerHandler('subscribeLog', (data, ctx) => {
                const { targetId, scope } = data;
                if (!targetId) return;
                const sessions = logViewBind.data.sessions;
                sessions.push({ sessionId: `${targetId}-${Date.now()}`, targetId, scope: scope || 'single' });
                logViewBind.data = { ...logViewBind.data, sessions };
            });
            wsServer.registerHandler('unsubscribeLog', (data, ctx) => {
                const { targetId } = data;
                if (!targetId) return;
                logViewBind.data = {
                    ...logViewBind.data,
                    sessions: logViewBind.data.sessions.filter(s => s.targetId !== targetId)
                };
            });
            wsServer.registerHandler('setLogLevel', (data, ctx) => {
                const { levels } = data;
                if (!Array.isArray(levels)) return;
                logViewBind.data = { ...logViewBind.data, filter: { ...logViewBind.data.filter, levels } };
            });

            // 日志上报控制 handler
            wsServer.registerHandler('setLogReport', (data, ctx) => {
                const { targetType, targetId, config: reportConfig } = data;
                if (!targetType || !reportConfig || typeof reportConfig.enabled !== 'boolean') return;
                const level = ['error', 'warn', 'info', 'debug'].includes(reportConfig.level) ? reportConfig.level : 'error';
                if (targetType === 'display') {
                    if (targetId === 'all') {
                        logReportStore.display = { enabled: reportConfig.enabled, level };
                        config.set('logReportDisplay', logReportStore.display);
                        sendLogReportConfigToAllDisplays();
                    } else {
                        logReportStore.displayOverrides.set(targetId, { enabled: reportConfig.enabled, level });
                        sendLogReportConfigToDisplay(targetId, { enabled: reportConfig.enabled, level });
                    }
                    // 广播给所有控制端更新UI
                    broadcastToControls({ type: 'logReportConfig', target: 'display', enabled: reportConfig.enabled, level });
                } else if (targetType === 'control') {
                    logReportStore.control = { enabled: reportConfig.enabled, level };
                    config.set('logReportControl', logReportStore.control);
                }
                ctx.ws.send(JSON.stringify({
                    type: 'logReportConfigApplied',
                    targetType,
                    targetId: targetId || 'all',
                    config: { enabled: reportConfig.enabled, level }
                }));
            });
            wsServer.registerHandler('setLogBlocklist', (data, ctx) => {
                const list = Array.isArray(data.categories) ? data.categories : [];
                logBlocklist = list;
                config.set('logBlocklist', list);
                ctx.ws.send(JSON.stringify({
                    type: 'logBlocklistApplied',
                    categories: list
                }));
            });
            wsServer.registerHandler('clientLog', (data, ctx) => {
                const { level, category, message, deviceType, deviceId, timestamp } = data;
                if (!level || !message) return;
                const device = deviceType === 'display' ? (deviceId || 'unknown-display') : 'control';
                logBuffer.add(category || '系统', message, {
                    level: level,
                    device: device,
                    source: deviceType || 'unknown',
                    targetId: deviceId || null
                });
            });

            log('WS', 'ViewBind WS 系统初始化完成');
            bindRuntimeBridgeTransports();

            // 初始化远程任务引擎
            const taskManager = new TaskManager({ maxInstances: 50 });
            registerTaskHandlers(wsServer, taskManager,
                (msg) => broadcastToControls(msg),
                (displayId, msg) => sendToDisplay(displayId, msg)
            );
            taskManager.setSendToDisplay((displayId, msg) => sendToDisplay(displayId, msg));
            taskManager.setBroadcastToDisplays((msg) => {
              for (const [id] of displayClients) sendToDisplay(id, msg);
            });
            log('任务引擎', '远程任务系统已初始化');
            await taskManager.restoreAutoStartServices();
        } catch (error) {
            logError('WS', `系统初始化失败: ${error.message}`);
        }

        systemMonitor.start();
        systemMonitor.onStats((stats) => {
            tui.updateSystemStats(stats);
            if (controlClients.size > 0) {
                broadcastToControls({
                    type: 'systemStats',
                    stats: stats
                });
            }
        });

        tui.startRefresh(
            () => {
                const chatCfg = chat.getConfig();
                return {
                    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
                    memoryRSS: process.memoryUsage().rss,
                    memoryHeapUsed: process.memoryUsage().heapUsed,
                    memoryHeapTotal: process.memoryUsage().heapTotal,
                    protocol: useHttps ? 'https' : 'http',
                    isMuted: muteState.isMuted,
                    displayCount: displayClients.size,
                    controlCount: controlClients.size,
                    llmProfile: chat.getActiveProfile(),
                    llmApiUrl: chatCfg.apiUrl,
                    llmModel: chatCfg.model
                };
            },
            () => getDisplayList()
        );

        // serverLog 已废弃，日志推送由 logViewBind + logUpdate 节流处理
    });
}

function generateId() {
    return Math.random().toString(36).substring(2, 10);
}

const DEFAULT_CAPABILITIES = {
    mediaRendering: true,
    voicePlayback: true,
    voiceRecording: true,
    voiceRecognition: false,
    displayText: true
};

const SUB_DISPLAY_CAPABILITIES = {
    mediaRendering: false,
    voicePlayback: true,
    voiceRecording: true,
    voiceRecognition: true,
    displayText: false
};

function createDisplayState() {
    return {
        currentMedia: null,
        rotation: 0,
        fit: 'contain',
        crop: { x: 0, y: 0, width: 100, height: 100 },
        volume: 100,
        isPlaying: false,
        canvasSize: { width: 1920, height: 1080 },
        browserInfo: null,
        capabilities: null
    };
}

app.use(express.static(path.join(PROJECT_ROOT, 'src', 'apps', 'web-mediacenter', 'ui', 'public'), {
  maxAge: 0, etag: true,
  setHeaders: function(res, path) {
    if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
app.use('/aasc', express.static(path.join(PROJECT_ROOT, 'src', 'framework', 'aasc')));
app.use('/auto-brain', express.static(path.join(PROJECT_ROOT, 'src', 'framework', 'auto-brain')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/res/tasks', express.static(path.join(PROJECT_ROOT, 'res', 'tasks')));
app.use('/models', express.static(path.join(PROJECT_ROOT, 'res', 'models')));
app.use('/js/lib', express.static(path.join(PROJECT_ROOT, 'node_modules', 'onnxruntime-web', 'dist')));
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
    res.redirect('/upload');
});

app.get('/upload', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'src', 'apps', 'web-mediacenter', 'ui', 'public', 'upload.html'));
});

app.get('/display', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'src', 'apps', 'web-mediacenter', 'ui', 'public', 'display.html'));
});

function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.startsWith('multipart/form-data')) {
            return reject(new Error('不是 multipart/form-data'));
        }
        
        const boundary = contentType.split('boundary=')[1];
        if (!boundary) {
            return reject(new Error('找不到 boundary'));
        }
        
        const MAX_UPLOAD_SIZE = 200 * 1024 * 1024;
        let totalSize = 0;
        const chunks = [];
        req.on('data', chunk => {
            totalSize += chunk.length;
            if (totalSize > MAX_UPLOAD_SIZE) {
                reject(new Error('上传文件大小超过限制(200MB)'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            chunks.length = 0;
            const boundaryBuffer = Buffer.from('--' + boundary);
            const result = { fields: {}, files: {} };
            
            let start = 0;
            while (start < buffer.length) {
                const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
                if (boundaryIndex === -1) break;
                
                const nextBoundary = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
                if (nextBoundary === -1) break;
                
                const part = buffer.slice(boundaryIndex + boundaryBuffer.length + 2, nextBoundary - 2);
                const headerEnd = part.indexOf('\r\n\r\n');
                
                if (headerEnd !== -1) {
                    const headers = part.slice(0, headerEnd).toString();
                    const body = part.slice(headerEnd + 4);
                    
                    const nameMatch = headers.match(/name="([^"]+)"/);
                    const filenameMatch = headers.match(/filename="([^"]+)"/);
                    
                    if (nameMatch) {
                        const name = nameMatch[1];
                        if (filenameMatch) {
                            const filename = filenameMatch[1];
                            result.files[name] = {
                                filename: filename,
                                data: body,
                                contentType: headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream'
                            };
                        } else {
                            result.fields[name] = body.toString().replace(/\r\n$/, '');
                        }
                    }
                }
                
                start = nextBoundary;
            }
            
            resolve(result);
        });
        req.on('error', reject);
    });
}

const uploadMiddleware = multer({ 
    dest: HTTP_UPLOAD_TEMP_DIR,
    limits: { fileSize: 200 * 1024 * 1024 }
});

if (!fs.existsSync(HTTP_UPLOAD_TEMP_DIR)) {
    fs.mkdirSync(HTTP_UPLOAD_TEMP_DIR, { recursive: true });
}

app.post('/upload-file', uploadMiddleware.single('file'), async (req, res) => {
    try {
        const file = req.file;
        const displayId = req.body.displayId;
        
        if (!file) {
            return res.status(400).json({ status: 'error', message: '没有上传文件' });
        }
        
        if (!displayId) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ status: 'error', message: '没有选择显示端' });
        }
        
        const detectedType = detectMediaType(file.originalname);
        const uniqueName = `${Date.now()}_${file.originalname}`;
        const filePath = path.join(UPLOADS_DIR, uniqueName);
        
        fs.renameSync(file.path, filePath);
        
        const localIP = getLocalIP();
        const protocol = useHttps ? 'https' : 'http';
        const fileUrl = `${protocol}://${localIP}:${PORT}/uploads/${encodeURIComponent(uniqueName)}`;
        
        const mediaData = {
            type: 'url',
            url: fileUrl,
            fileName: file.originalname,
            mediaType: detectedType,
            timestamp: Date.now()
        };
        
        currentMedia = mediaData;
        const displayData = displayClients.get(displayId);
        if (displayData) {
            displayData.state.currentMedia = mediaData;
            sendToDisplay(displayId, mediaData);
        }
        res.json({ status: 'success', message: '媒体已发送到显示端' });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        logError('错误', `文件上传失败: ${err.message}`);
        res.status(500).json({ status: 'error', message: '文件上传失败: ' + err.message });
    }
});

app.get('/media-list', (req, res) => {
    try {
        const files = fs.readdirSync(UPLOADS_DIR);
        const localIP = getLocalIP();
        const protocol = useHttps ? 'https' : 'http';
        
        const mediaList = files
            .filter(f => !f.startsWith('.'))
            .map(f => {
                const stat = fs.statSync(path.join(UPLOADS_DIR, f));
                return {
                    name: f,
                    url: `${protocol}://${localIP}:${PORT}/uploads/${encodeURIComponent(f)}`,
                    mediaType: detectMediaType(f),
                    size: stat.size,
                    time: stat.mtime
                };
            })
            .sort((a, b) => b.time - a.time);
        
        res.json({ status: 'success', list: mediaList });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '获取列表失败' });
    }
});

app.delete('/media/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = path.join(UPLOADS_DIR, filename);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            res.json({ status: 'success', message: '文件已删除' });
        } else {
            res.status(404).json({ status: 'error', message: '文件不存在' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: '删除失败' });
    }
});

app.post('/api/tts/generate', async (req, res) => {
    try {
        const { text, voice, speed } = req.body;
        
        if (!text) {
            return res.status(400).json({ status: 'error', message: 'text 不能为空' });
        }
        
        const audioPath = await tts.generateTTS(text, voice, speed);
        const fileName = path.basename(audioPath);
        res.json({ 
            status: 'success', 
            audioUrl: `/uploads/tts/${fileName}`,
            message: 'TTS生成成功'
        });
    } catch (err) {
        logError('TTS', `生成失败: ${err.message}`);
        res.status(500).json({ status: 'error', message: 'TTS生成失败: ' + err.message });
    }
});

app.get('/api/tts/config', (req, res) => {
    const ttsConfig = config.getTtsConfig();
    res.json({ 
        status: 'success', 
        serviceUrl: ttsConfig.serviceUrl,
        defaultVoice: ttsConfig.defaultVoice,
        defaultSpeed: ttsConfig.defaultSpeed,
        requestTimeoutMs: ttsConfig.requestTimeoutMs,
        extraTimeoutPerPending: ttsConfig.extraTimeoutPerPending,
        pendingRequests: ttsConfig.pendingRequests,
        maxErrorBytes: ttsConfig.maxErrorBytes
    });
});

app.post('/api/tts/config', (req, res) => {
    try {
        const { serviceUrl, defaultVoice, defaultSpeed, requestTimeoutMs, extraTimeoutPerPending, maxErrorBytes } = req.body;

        const ttsConfig = {};
        if (serviceUrl !== undefined) ttsConfig.serviceUrl = serviceUrl;
        if (defaultVoice !== undefined) ttsConfig.defaultVoice = defaultVoice;
        if (defaultSpeed !== undefined) ttsConfig.defaultSpeed = defaultSpeed;
        if (requestTimeoutMs !== undefined) ttsConfig.requestTimeoutMs = requestTimeoutMs;
        if (extraTimeoutPerPending !== undefined) ttsConfig.extraTimeoutPerPending = extraTimeoutPerPending;
        if (maxErrorBytes !== undefined) ttsConfig.maxErrorBytes = maxErrorBytes;
        
        config.setTtsConfig(ttsConfig);
        tts.init(config.getTtsConfig());
        
        res.json({ status: 'success', message: 'TTS配置已更新' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

app.get('/api/config/localAsr', (req, res) => {
    const localAsrConfig = config.get('localAsr') || { enabled: false };
    res.json({ status: 'success', enabled: localAsrConfig.enabled });
});

app.post('/api/config/localAsr', (req, res) => {
    try {
        const { enabled } = req.body;
        config.set('localAsr', { enabled: !!enabled });
        res.json({ status: 'success', enabled: !!enabled });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

app.get('/api/config/asrDevice', (req, res) => {
    const device = config.get('asr.device', 'server');
    res.json({ status: 'success', device });
});

app.post('/api/config/asrDevice', (req, res) => {
    try {
        const { device } = req.body;
        if (device !== 'server' && device !== 'display') {
            return res.status(400).json({ status: 'error', message: 'device 必须是 server 或 display' });
        }
        config.set('asr.device', device);

        broadcastToControls({
            type: 'asrDeviceChanged',
            device: device
        });

        res.json({ status: 'success', device });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

app.get('/api/config/asrMode', (req, res) => {
    const mode = config.get('asr.mode', 'embedded');
    res.json({ status: 'success', mode });
});

app.post('/api/config/asrMode', (req, res) => {
    try {
        const { mode } = req.body;
        if (mode !== 'embedded' && mode !== 'isolated') {
            return res.status(400).json({ status: 'error', message: 'mode 必须是 embedded 或 isolated' });
        }
        config.set('asr.mode', mode);

        const asrConfig = config.get('asr', {});
        asrConfig.mode = mode;
        asr.reset(asrConfig);

        const modeLabel = mode === 'isolated' ? '独立进程' : '内嵌';
        log('语音', `ASR 模式切换为: ${modeLabel}`);

        broadcastToControls({
            type: 'asrModeChanged',
            mode
        });

        res.json({ status: 'success', mode });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '模式切换失败: ' + err.message });
    }
});

app.get('/api/subservers', (req, res) => {
    const servers = subServerManager.getAllServers().map(s => s.toJSON());
    res.json({ status: 'success', servers });
});

app.post('/api/subservers', (req, res) => {
    try {
        const { id, url, name, maxDisplays, priority, enabled } = req.body;
        if (!id || !url) {
            return res.status(400).json({ status: 'error', message: 'id和url必填' });
        }
        const server = subServerManager.addServer(id, url, { name, maxDisplays, priority, enabled });
        config.set('subServers', subServerManager.saveToConfig());
        res.json({ status: 'success', server: server.toJSON() });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '添加子服务器失败' });
    }
});

app.delete('/api/subservers/:id', (req, res) => {
    const removed = subServerManager.removeServer(req.params.id);
    config.set('subServers', subServerManager.saveToConfig());
    res.json({ status: removed ? 'success' : 'error', message: removed ? '已删除' : '服务器不存在' });
});

app.get('/api/subservers/health', async (req, res) => {
    const summary = await subServerManager.checkAllHealth();
    res.json({ status: 'success', ...summary });
});

const asrUpload = multer({ dest: ASR_TEMP_DIR });

function cleanupTempFile(filePath) {
    if (!filePath) {
        return;
    }

    try {
        if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const size = stat.size;
            log('语音', `清理ASR临时文件: ${path.basename(filePath)} (${formatFileSize(size)})`);
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        logError('语音', `清理ASR临时文件失败: ${error.message}`);
    }
}

app.get('/api/asr/status', (req, res) => {
    res.json({
        status: 'success',
        ready: asr.isReady(),
        mode: asr.getMode(),
        isolatedProcessEnabled: config.get('asr.isolateProcess.enabled', false)
    });
});

app.post('/api/asr/recognize', asrUpload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: '未收到音频文件' });
        }
        const asrDevice = config.get('asr.device', 'server');
        
        if (asrDevice === 'display') {
            const displayWithAsr = findDisplayWithAsr();
            if (!displayWithAsr) {
                cleanupTempFile(req.file.path);
                return res.status(503).json({ status: 'error', message: '没有支持 ASR 的显示端在线' });
            }
        
            try {
                const audioBase64 = fs.readFileSync(req.file.path, { encoding: 'base64' });
                const requestId = 'asr-' + Date.now() + '-' + (++pendingAsrRequestId);
        
                const text = await sendAudioToDisplayAsr(displayWithAsr, audioBase64, requestId);
                cleanupTempFile(req.file.path);
        
                if (!text || !text.trim()) {
                    return res.json({ 
                        status: 'ignored', 
                        message: '显示端未识别到有效语音',
                        text: ''
                    });
                }
        
                if (!hasValidContent(text)) {
                    log('语音', `忽略无效语音输入: ${text}`);
                    return res.json({ 
                        status: 'ignored', 
                        message: '未检测到有效内容',
                        text: text
                    });
                }
        
                return res.json({ status: 'success', text: text.trim() });
            } catch (err) {
                cleanupTempFile(req.file.path);
                logError('语音', `显示端 ASR 失败: ${err.message}`);
                return res.status(500).json({ status: 'error', message: '显示端 ASR 失败: ' + err.message });
            }
        }
        

        
        if (!asr.isReady()) {
            cleanupTempFile(req.file.path);
            return res.status(503).json({ status: 'error', message: 'ASR 服务未初始化' });
        }
        
        const recognizedText = await asr.recognize(req.file.path);
        cleanupTempFile(req.file.path);
        
        if (!recognizedText || !recognizedText.trim()) {
            return res.json({ 
                status: 'ignored', 
                message: '未识别到有效语音',
                text: ''
            });
        }
        
        if (!hasValidContent(recognizedText)) {
            log('语音', `忽略无效语音输入: ${recognizedText}`);
            return res.json({ 
                status: 'ignored', 
                message: '未检测到有效内容',
                text: recognizedText
            });
        }
        
        res.json({ 
            status: 'success', 
            text: recognizedText
         });
    } catch (err) {
        logError('语音', `ASR识别失败: ${err.message}`);
        if (req.file) {
            cleanupTempFile(req.file.path);
        }

        const isQueueBusy = err.message.includes('ASR 忙');
        const statusCode = isQueueBusy ? 429 : 500;
        res.status(statusCode).json({ status: 'error', message: '语音识别失败: ' + err.message });
    }
});

app.get('/api/config', (req, res) => {
    res.json({ 
        status: 'success', 
        config: config.getConfig()
    });
});

app.get('/api/chat/config', (req, res) => {
    res.json({ 
        status: 'success', 
        config: chat.getConfig()
    });
});

app.post('/api/chat/config', (req, res) => {
    try {
        const newConfig = chat.setConfig(req.body);
        config.set('chat', newConfig);
        res.json({
            status: 'success',
            message: '聊天配置已更新',
            config: newConfig
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

app.get('/api/chat/profiles', (req, res) => {
    res.json({
        status: 'success',
        profiles: chat.getProfiles(),
        activeProfile: chat.getActiveProfile()
    });
});

app.post('/api/chat/profiles', (req, res) => {
    try {
        const profiles = chat.setProfiles(req.body.profiles);
        const chatCfg = chat.getConfig();
        config.set('chat', {
            ...chatCfg,
            llmProfiles: profiles,
            activeProfile: chat.getActiveProfile()
        });
        res.json({
            status: 'success',
            profiles: profiles,
            activeProfile: chat.getActiveProfile()
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

app.post('/api/chat/profiles/switch', (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ status: 'error', message: '请指定配置名称' });
        }
        const success = chat.switchProfile(name);
        if (!success) {
            return res.status(404).json({ status: 'error', message: `未找到配置: ${name}` });
        }
        const chatCfg = chat.getConfig();
        config.set('chat', {
            ...chatCfg,
            activeProfile: chat.getActiveProfile(),
            llmProfiles: chat.getProfiles()
        });
        // 广播配置切换
        broadcastToControls({
            type: 'profileSwitched',
            activeProfile: chat.getActiveProfile(),
            config: {
                apiUrl: chatCfg.apiUrl,
                model: chatCfg.model
            }
        });
        res.json({
            status: 'success',
            activeProfile: chat.getActiveProfile(),
            config: {
                apiUrl: chatCfg.apiUrl,
                model: chatCfg.model
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '切换配置失败' });
    }
});

app.get('/api/chat/history', (req, res) => {
    res.json({ 
        status: 'success', 
        history: chat.getHistory()
    });
});

app.post('/api/chat/clear', (req, res) => {
    const history = chat.clearHistory(req.body);
    res.json({ 
        status: 'success', 
        message: '聊天记录已清空',
        history: history
    });
});

app.get('/api/chat/sessions', (req, res) => {
    const target = req.query.target;
    if (!target) {
        return res.json({ status: 'error', message: '缺少 target 参数' });
    }
    res.json({ status: 'success', sessions: chat.listSessions(target) });
});

app.post('/api/chat/sessions/create', (req, res) => {
    const { target, name } = req.body;
    if (!target) {
        return res.json({ status: 'error', message: '缺少 target 参数' });
    }
    const session = chat.createSession(target, name || '新会话');
    res.json({ status: 'success', session });
});

app.post('/api/chat/sessions/delete', (req, res) => {
    const { target, sessionId } = req.body;
    const success = chat.deleteSession(target, sessionId);
    if (success) {
        res.json({ status: 'success' });
    } else {
        res.json({ status: 'error', message: '删除失败（默认会话不可删除或目标不存在）' });
    }
});

app.post('/api/chat/sessions/switch', (req, res) => {
    const { target, sessionId } = req.body;
    const success = chat.switchSession(target, sessionId);
    if (success) {
        res.json({ status: 'success', sessionId });
    } else {
        res.json({ status: 'error', message: '切换失败（会话不存在）' });
    }
});

app.get('/api/chat/templates', (req, res) => {
    res.json({ 
        status: 'success', 
        templates: chat.getTemplates()
    });
});

app.post('/api/chat/templates', (req, res) => {
    try {
        const templates = chat.setTemplates(req.body.templates);
        res.json({ 
            status: 'success', 
            templates: templates
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '模板更新失败' });
    }
});

app.post('/api/chat/templates/add', (req, res) => {
    try {
        const templates = chat.addTemplate(req.body);
        res.json({ 
            status: 'success', 
            templates: templates
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '模板添加失败' });
    }
});

app.delete('/api/chat/templates/:id', (req, res) => {
    try {
        const templates = chat.removeTemplate(req.params.id);
        res.json({ 
            status: 'success', 
            templates: templates
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '模板删除失败' });
    }
});

app.get('/api/reminders', (req, res) => {
    res.json({ 
        status: 'success', 
        reminders: reminder.getAllReminders()
    });
});

app.post('/api/reminders', (req, res) => {
    try {
        const { content, time, type, methods, repeat } = req.body;
        
        if (!content || !time) {
            return res.status(400).json({ status: 'error', message: '内容和时间不能为空' });
        }
        
        const newReminder = reminder.addReminder({ content, time, type, methods, repeat });
        res.json({ 
            status: 'success', 
            message: '提醒已创建',
            reminder: newReminder
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '创建提醒失败: ' + err.message });
    }
});

app.put('/api/reminders/:id', (req, res) => {
    try {
        const updated = reminder.updateReminder(req.params.id, req.body);
        if (!updated) {
            return res.status(404).json({ status: 'error', message: '提醒不存在' });
        }
        res.json({ 
            status: 'success', 
            message: '提醒已更新',
            reminder: updated
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '更新提醒失败: ' + err.message });
    }
});

app.delete('/api/reminders/:id', (req, res) => {
    try {
        const deleted = reminder.deleteReminder(req.params.id);
        if (!deleted) {
            return res.status(404).json({ status: 'error', message: '提醒不存在' });
        }
        res.json({ 
            status: 'success', 
            message: '提醒已删除'
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '删除提醒失败: ' + err.message });
    }
});

app.post('/api/reminders/:id/toggle', (req, res) => {
    try {
        const { enabled } = req.body;
        const updated = reminder.toggleReminder(req.params.id, enabled);
        if (!updated) {
            return res.status(404).json({ status: 'error', message: '提醒不存在' });
        }
        res.json({ 
            status: 'success', 
            message: enabled ? '提醒已启用' : '提醒已禁用',
            reminder: updated
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '操作失败: ' + err.message });
    }
});

app.post('/api/reminders/test', async (req, res) => {
    try {
        await reminder.testReminder(req.body);
        res.json({ 
            status: 'success', 
            message: '测试提醒已发送'
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '测试提醒失败: ' + err.message });
    }
});

app.post('/api/reminders/:id/test', async (req, res) => {
    try {
        const reminderData = reminder.getReminder(req.params.id);
        if (!reminderData) {
            return res.status(404).json({ status: 'error', message: '提醒不存在' });
        }
        
        const { displayId } = req.body;
        
        if (displayId) {
            const displayData = displayClients.get(displayId);
            if (!displayData) {
                return res.status(404).json({ status: 'error', message: '显示端不存在' });
            }
            await reminder.testReminder(reminderData, displayId, sendToDisplay);
        } else {
            await reminder.testReminder(reminderData);
        }
        
        res.json({ 
            status: 'success', 
            message: '测试提醒已发送'
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '测试提醒失败: ' + err.message });
    }
});

app.get('/api/media-libraries', (req, res) => {
    res.json({
        status: 'success',
        libraries: mediaLibraryManager.listLibraries(),
        defaultLibraryId: mediaLibraryManager.getDefaultLibraryId()
    });
});

app.post('/api/media-libraries', async (req, res) => {
    try {
        const { name, type, path: libPath, url, server, share, domain, username, password, readonly } = req.body;
        
        if (!name) {
            return res.status(400).json({ status: 'error', message: '名称不能为空' });
        }
        
        const config = await mediaLibraryManager.addLibraryFromConfig({
            name,
            type: type || 'local',
            path: libPath,
            url,
            server,
            share,
            domain,
            username,
            password,
            readonly: readonly || false
        });
        
        if (type === 'local' || !type) {
            const library = mediaLibraryManager.getLibrary(config.id);
            if (library && library.provider && library.provider.getRoutePrefix && library.provider.getBasePath) {
                const routePrefix = library.provider.getRoutePrefix();
                const basePath = library.provider.getBasePath();
                const isUploadsDir = library.provider.isUploadsDir;
                
                if (!isUploadsDir) {
                    app.use(routePrefix, express.static(basePath));
                    log('媒体库', `动态添加静态路由: ${routePrefix} -> ${basePath}`);
                }
            }
        }
        
        res.json({ status: 'success', library: config });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.put('/api/media-libraries/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, readonly, isDefault } = req.body;
        
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (readonly !== undefined) updates.readonly = readonly;
        
        const config = mediaLibraryManager.updateLibraryConfig(id, updates);
        
        if (isDefault) {
            mediaLibraryManager.setDefault(id);
        }
        
        res.json({ status: 'success', library: config });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.delete('/api/media-libraries/:id', async (req, res) => {
    try {
        await mediaLibraryManager.removeLibrary(req.params.id);
        mediaLibraryManager.saveConfig();
        res.json({ status: 'success', message: '媒体库已删除' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/media-libraries/:id/list', async (req, res) => {
    try {
        const { path: dirPath = '/' } = req.query;
        const items = await mediaLibraryManager.list(req.params.id, dirPath);
        res.json({ status: 'success', items });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/media-libraries/:id/upload', uploadMiddleware.single('file'), async (req, res) => {
    try {
        const file = req.file;
        const dirPath = req.body.path || '/';
        
        if (!file) {
            return res.status(400).json({ status: 'error', message: '没有上传文件' });
        }
        
        const fileObj = {
            filename: file.originalname,
            data: fs.readFileSync(file.path),
            contentType: file.mimetype
        };
        fs.unlinkSync(file.path);
        
        const result = await mediaLibraryManager.upload(req.params.id, dirPath, fileObj);
        fileObj.data = null;
        res.json({ status: 'success', file: result });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.delete('/api/media-libraries/:id/file', async (req, res) => {
    try {
        const { path: filePath } = req.query;
        
        if (!filePath) {
            return res.status(400).json({ status: 'error', message: '路径不能为空' });
        }
        
        await mediaLibraryManager.delete(req.params.id, filePath);
        res.json({ status: 'success', message: '文件已删除' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/media-libraries/:id/folder', async (req, res) => {
    try {
        const { path: dirPath, name } = req.body;
        
        if (!name) {
            return res.status(400).json({ status: 'error', message: '文件夹名称不能为空' });
        }
        
        const result = await mediaLibraryManager.createFolder(req.params.id, dirPath || '/', name);
        res.json({ status: 'success', folder: result });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.delete('/api/media-libraries/:id/folder', async (req, res) => {
    try {
        const { path: folderPath } = req.query;
        
        if (!folderPath) {
            return res.status(400).json({ status: 'error', message: '路径不能为空' });
        }
        
        await mediaLibraryManager.deleteFolder(req.params.id, folderPath);
        res.json({ status: 'success', message: '文件夹已删除' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/media-libraries/:id/set-default', (req, res) => {
    try {
        mediaLibraryManager.setDefault(req.params.id);
        res.json({ status: 'success', message: '已设为默认媒体库' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/media-libraries/:id/proxy/*', async (req, res) => {
    try {
        const filePath = decodeURIComponent(req.params[0]);
        
        if (!filePath) {
            return res.status(400).json({ status: 'error', message: '文件路径不能为空' });
        }
        
        const ext = filePath.toLowerCase().split('.').pop();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'mov': 'video/quicktime',
            'avi': 'video/x-msvideo',
            'mkv': 'video/x-matroska'
        };
        
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        
        try {
            const fileInfo = await mediaLibraryManager.getFile(req.params.id, filePath);
            if (fileInfo && fileInfo.size) {
                res.setHeader('Content-Length', fileInfo.size);
            }
        } catch (e) {
        }
        
        const stream = await mediaLibraryManager.getFileStream(req.params.id, filePath);
        
        stream.pipe(res);
        
        req.on('close', () => {
            if (stream && typeof stream.destroy === 'function') {
                stream.destroy();
            }
        });
        
        stream.on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ status: 'error', message: err.message });
            } else {
                res.end();
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
        displayCount: displayClients.size,
        controlCount: controlClients.size,
        serverStartTime: serverStartTime
    });
});

app.get('/api/logs', (req, res) => {
    const filters = {
        search: req.query.search || '',
        levels: req.query.levels ? req.query.levels.split(',') : [],
        devices: req.query.devices ? req.query.devices.split(',') : [],
        categories: req.query.categories ? req.query.categories.split(',') : [],
        timeRange: req.query.timeRange || 'all',
        limit: req.query.limit ? parseInt(req.query.limit) : 200
    };
    const entries = logBuffer.getEntries(filters);
    res.json({
        status: 'ok',
        total: logBuffer.size,
        filtered: entries.length,
        entries: entries,
        categories: logBuffer.getCategories()
    });
});

registerLogBrainApi(app, {
    logBrain,
    llmService: chat
});

app.get('/api/system-stats', (req, res) => {
    res.json({
        status: 'ok',
        stats: systemMonitor.getStats()
    });
});

app.get('/api/map-data', (req, res) => {
    try {
        const localIP = getLocalIP();
        const actors = [];
        
        actors.push({
            address: { ip: localIP, role: 'server', name: 'main' },
            status: 'ready',
            capabilities: [
                { id: 'routing', name: '消息路由', category: 'special', level: 5 },
                { id: 'media-library', name: '媒体库管理', category: 'special', level: 3 },
                { id: 'chat', name: 'AI对话', category: 'professional', level: 4 }
            ],
            lastHeartbeat: Date.now(),
            metadata: {
                resources: {
                    hasSpeaker: true
                }
            }
        });
        
        displayClients.forEach((state, displayId) => {
            const caps = state.state?.capabilities || DEFAULT_CAPABILITIES;
            const capabilities = [];
            if (caps.mediaRendering) {
                capabilities.push({ id: 'display', name: '显示', category: 'basic', level: 2 });
            }
            if (caps.voicePlayback) {
                capabilities.push({ id: 'voice-broadcast', name: '语音播报', category: 'professional', level: 3 });
            }
            if (caps.voiceRecording) {
                capabilities.push({ id: 'voice-recording', name: '语音录音', category: 'professional', level: 2 });
            }
            if (caps.voiceRecognition) {
                capabilities.push({ id: 'voice-recognition', name: '语音识别', category: 'professional', level: 3 });
            }
            if (caps.displayText) {
                capabilities.push({ id: 'display-text', name: '文本显示', category: 'basic', level: 2 });
            }
            actors.push({
                address: { ip: state.state?.browserInfo?.ip || state.ip || 'unknown', role: 'display', name: displayId },
                status: state.state?.isPlaying ? 'busy' : 'ready',
                capabilities: capabilities,
                lastHeartbeat: Date.now(),
                metadata: {
                    browserInfo: state.state?.browserInfo,
                    canvasSize: state.state?.canvasSize
                }
            });
        });
        
        controlClients.forEach((clientData, clientId) => {
            actors.push({
                address: { ip: clientData?.ip || 'unknown', role: 'control', name: clientId },
                status: 'ready',
                capabilities: [
                    { id: 'control', name: '控制', category: 'basic', level: 1 }
                ],
                lastHeartbeat: Date.now()
            });
        });
        
        res.json({
            status: 'success',
            data: {
                actors: actors,
                exportedAt: Date.now()
            }
        });
    } catch (err) {
        logError('错误', `获取地图数据失败: ${err.message}`);
        res.status(500).json({ status: 'error', message: '获取地图数据失败: ' + err.message });
    }
});

app.get('/api/actors', (req, res) => {
    try {
        const localIP = getLocalIP();
        const actors = [];
        
        actors.push({
            address: { ip: localIP, role: 'server', name: 'main' },
            status: 'ready',
            capabilities: [
                { id: 'routing', name: '消息路由', category: 'special', level: 5 },
                { id: 'media-library', name: '媒体库管理', category: 'special', level: 3 },
                { id: 'chat', name: 'AI对话', category: 'professional', level: 4 }
            ],
            lastHeartbeat: Date.now()
        });
        
        displayClients.forEach((state, displayId) => {
            const caps = state.state?.capabilities || DEFAULT_CAPABILITIES;
            const capabilities = [];
            if (caps.mediaRendering) {
                capabilities.push({ id: 'display', name: '显示', category: 'basic', level: 2 });
            }
            if (caps.voicePlayback) {
                capabilities.push({ id: 'voice-broadcast', name: '语音播报', category: 'professional', level: 3 });
            }
            actors.push({
                address: { ip: state.state?.browserInfo?.ip || state.ip || 'unknown', role: 'display', name: displayId },
                status: state.state?.isPlaying ? 'busy' : 'ready',
                capabilities: capabilities,
                lastHeartbeat: Date.now()
            });
        });
        
        res.json({
            status: 'success',
            actors: actors
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '获取执行者数据失败' });
    }
});

app.post('/api/time/parse', (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ status: 'error', message: '缺少文本参数' });
        }
        
        const timeParser = require('./src/core/utils/time-parser');
        const result = timeParser.parseTime(text);
        
        res.json({
            status: 'success',
            result: result
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

const mapPositionsPath = path.join(PROJECT_ROOT, 'config', 'map-positions.json');

function loadMapPositions() {
    try {
        if (fs.existsSync(mapPositionsPath)) {
            const data = fs.readFileSync(mapPositionsPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        logError('错误', `加载地图位置失败: ${error.message}`);
    }
    return {};
}

function saveMapPositions(positions) {
    try {
        fs.writeFileSync(mapPositionsPath, JSON.stringify(positions, null, 2), 'utf8');
        return true;
    } catch (error) {
        logError('错误', `保存地图位置失败: ${error.message}`);
        return false;
    }
}

app.get('/api/map-positions', (req, res) => {
    const positions = loadMapPositions();
    res.json({
        status: 'success',
        positions: positions
    });
});

app.put('/api/map-positions/:id', (req, res) => {
    const { id } = req.params;
    const { position } = req.body;
    
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
        return res.status(400).json({
            status: 'error',
            message: '无效的位置数据'
        });
    }
    
    const positions = loadMapPositions();
    positions[id] = { position, updatedAt: Date.now() };
    
    if (saveMapPositions(positions)) {
        res.json({
            status: 'success',
            message: '位置保存成功'
        });
    } else {
        res.status(500).json({
            status: 'error',
            message: '保存位置失败'
        });
    }
});

app.get('/api/mute', (req, res) => {
    res.json({
        status: 'success',
        isMuted: muteState.isMuted
    });
});

app.get('/api/device-events', (req, res) => {
    res.json({
        status: 'success',
        events: config.getDeviceEvents()
    });
});

app.put('/api/device-events/:ip', (req, res) => {
    try {
        const { ip } = req.params;
        const { onConnect, onDisconnect } = req.body;
        
        if (!ip) {
            return res.status(400).json({ status: 'error', message: 'IP 参数不能为空' });
        }
        
        const eventConfig = config.setDeviceEvent(ip, { onConnect, onDisconnect });
        res.json({
            status: 'success',
            event: eventConfig,
            message: '设备事件配置已更新'
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败: ' + err.message });
    }
});

app.delete('/api/device-events/:ip', (req, res) => {
    try {
        const { ip } = req.params;
        config.removeDeviceEvent(ip);
        res.json({
            status: 'success',
            message: '设备事件配置已删除'
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '删除失败: ' + err.message });
    }
});

app.get('/api/device-settings/:displayId', (req, res) => {
    try {
        const { displayId } = req.params;
        const displayData = displayClients.get(displayId);
        
        if (displayData) {
            res.json({
                status: 'success',
                settings: displayData.state,
                online: true
            });
        } else {
            let savedIp = null;
            const states = config.getAllDisplayStates();
            for (const [ip, state] of Object.entries(states)) {
                if (state.displayId === displayId) {
                    savedIp = ip;
                    break;
                }
            }
            
            if (savedIp) {
                res.json({
                    status: 'success',
                    settings: config.getDisplayState(savedIp),
                    online: false
                });
            } else {
                res.status(404).json({ status: 'error', message: '设备不存在' });
            }
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: '获取设置失败: ' + err.message });
    }
});

app.put('/api/device-settings/:displayId', (req, res) => {
    try {
        const { displayId } = req.params;
        const displayData = displayClients.get(displayId);
        
        if (displayData) {
            const updates = req.body;
            const validActions = ['rotation', 'fit', 'volume', 'crop', 'isPlaying'];
            
            for (const [key, value] of Object.entries(updates)) {
                if (validActions.includes(key)) {
                    displayData.state[key] = value;
                    config.updateDisplayState(displayData.ip, { [key]: value });
                    
                    sendToDisplay(displayId, {
                        type: 'control',
                        action: key,
                        value: value
                    });
                }
            }
            
            res.json({
                status: 'success',
                settings: displayData.state,
                online: true
            });
        } else {
            res.status(404).json({ status: 'error', message: '设备不在线，无法修改设置' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: '更新设置失败: ' + err.message });
    }
});

app.post('/api/mute', (req, res) => {
    const result = muteAllDisplays();
    res.json({
        status: result ? 'success' : 'error',
        message: result ? '已静音所有显示端' : '已经是静音状态',
        isMuted: muteState.isMuted
    });
});

app.post('/api/unmute', (req, res) => {
    const result = unmuteAllDisplays();
    res.json({
        status: result ? 'success' : 'error',
        message: result ? '已取消静音所有显示端' : '当前不是静音状态',
        isMuted: muteState.isMuted
    });
});

app.post('/api/restart', (req, res) => {
    res.json({ status: 'success', message: '服务器正在重启...' });
    
    log('系统', '收到重启请求，正在关闭服务器...');
    
    setTimeout(() => {
        wss.clients.forEach(client => {
            client.close();
        });
        
        server.close(() => {
            log('系统', '服务器已关闭，正在重启...');
            
            const { spawn } = require('child_process');
            const args = process.argv.slice(1);
            
            spawn(process.execPath, args, {
                detached: true,
                stdio: 'inherit',
                cwd: process.cwd()
            });
            
            process.exit(0);
        });
        
        setTimeout(() => {
            process.exit(0);
        }, 3000);
    }, 100);
});

function detectMediaType(name) {
    const ext = name.toLowerCase().split('.').pop().split('?')[0];
    if (['gif'].includes(ext)) return 'gif';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
    return 'image';
}

function getDisplayList() {
    const list = [];
    displayClients.forEach((data, id) => {
        const caps = data.state.capabilities || DEFAULT_CAPABILITIES;
        list.push({
            id: id,
            ip: data.ip,
            isSubDisplay: data.isSubDisplay || data.state.isSubDisplay || false,
            canvasSize: data.state.canvasSize,
            rotation: data.state.rotation || 0,
            browserInfo: data.state.browserInfo,
            voiceSupported: data.state.voiceSupported,
            voiceListening: data.state.voiceListening,
            capabilities: caps
        });
    });
    return list;
}

function getDisplayCapabilities(displayId) {
    const displayData = displayClients.get(displayId);
    if (!displayData) return null;
    return displayData.state.capabilities || DEFAULT_CAPABILITIES;
}

function getDisplaysWithCapability(capabilityName) {
    const result = [];
    displayClients.forEach((data, id) => {
        const caps = data.state.capabilities || DEFAULT_CAPABILITIES;
        if (caps[capabilityName] === true) {
            result.push({ id, data });
        }
    });
    return result;
}

function sendToDisplaysWithCapability(capabilityName, message) {
    const displays = getDisplaysWithCapability(capabilityName);
    for (const display of displays) {
        sendToDisplay(display.id, message);
    }
    return displays.length;
}

let displayListDebounceTimer = null;

const SILENT_BROADCAST_TYPES = new Set(['logUpdate', 'systemStats']);
function broadcastToControls(data) {
    const message = JSON.stringify(data);
    if (!SILENT_BROADCAST_TYPES.has(data.type)) {
        const extra = { targetId: 'all-control', source: 'server', scope: 'group' };
        if (data.correlationId) extra.correlationId = data.correlationId;
        log('WS', `>> ${data.type}${data.text ? ' "'+data.text+'"' : ''}${data.mode ? ' mode='+data.mode : ''}`, extra);
    }
    controlClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function broadcastDisplayList() {
    if (displayListDebounceTimer) return;
    displayListDebounceTimer = setImmediate(() => {
        displayListDebounceTimer = null;
        const list = getDisplayList();
        // 调试：打印每个显示端的 webgpu 能力
        for (const d of list) {
            if (d.capabilities.webgpu !== undefined) log('能力', `广播 displayList: ${d.id} webgpu=${d.capabilities.webgpu ? '可用' : '不可用'}`);
        }
        broadcastToControls({ type: 'displayList', list });
    });
}

function findDisplayWithAsr() {
    for (const [displayId, displayData] of displayClients) {
        const caps = displayData.state?.capabilities;
        if (caps && caps.voiceRecognition) {
            return { id: displayId, ws: displayData.ws };
        }
    }
    return null;
}

function sendAudioToDisplayAsr(display, audioBase64, requestId) {
    return new Promise((resolve, reject) => {
        const timeoutMs = 30000;
        const timer = setTimeout(() => {
            pendingDisplayAsrRequests.delete(requestId);
            reject(new Error('显示端 ASR 响应超时'));
        }, timeoutMs);

        pendingDisplayAsrRequests.set(requestId, { resolve, reject, timer });

        try {
            sendToDisplay(display.id, {
                type: 'asrAudio',
                audioData: audioBase64,
                requestId: requestId
            });
        } catch (err) {
            clearTimeout(timer);
            pendingDisplayAsrRequests.delete(requestId);
            reject(new Error('发送音频到显示端失败: ' + err.message));
        }
    });
}

// 裁剪调试日志开关
let _cropDebugLog = false;

function sendToDisplay(displayId, data) {
    const displayData = displayClients.get(displayId);
    if (displayData && displayData.ws.readyState === WebSocket.OPEN) {
        if (!data.correlationId) {
            data.correlationId = generateCorrelationId(data.type || 'msg');
        }
        const shouldLogCrop = data.type !== 'control' || data.action !== 'crop' || _cropDebugLog;
        if (shouldLogCrop) {
            log('WS', `>> ${data.type}${data.action ? ' action='+data.action : ''}${data.url ? ' url='+data.url.substring(0,80) : ''}${data.text ? ' "'+data.text+'"' : ''}`, { displayId, source: 'server', scope: 'single', targetId: displayId, correlationId: data.correlationId });
        }
        displayData.ws.send(JSON.stringify(data));
        return true;
    }
    return false;
}

function muteAllDisplays() {
    if (muteState.isMuted) return false;
    
    displayClients.forEach((displayData, displayId) => {
        muteState.previousVolumes.set(displayId, displayData.state.volume);
        displayData.state.volume = 0;
        sendToDisplay(displayId, {
            type: 'control',
            action: 'volume',
            value: 0
        });
    });
    
    muteState.isMuted = true;
    broadcastToControls({ type: 'muteState', isMuted: true });
    log('静音', '所有显示端已静音');
    return true;
}

function unmuteAllDisplays() {
    if (!muteState.isMuted) return false;
    
    displayClients.forEach((displayData, displayId) => {
        const previousVolume = muteState.previousVolumes.get(displayId) || 100;
        displayData.state.volume = previousVolume;
        sendToDisplay(displayId, {
            type: 'control',
            action: 'volume',
            value: previousVolume
        });
    });
    
    muteState.isMuted = false;
    muteState.previousVolumes.clear();
    broadcastToControls({ type: 'muteState', isMuted: false });
    log('静音', '所有显示端已取消静音');
    return true;
}

function getMuteState() {
    return {
        isMuted: muteState.isMuted
    };
}

function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
}

function getRuntimeBridgeDeviceId(url) {
    const urlParams = new URL(url, 'http://localhost');
    return urlParams.searchParams.get('deviceId') || `device-${generateId()}`;
}

function registerRuntimeBridgeTransport(deviceId, ws) {
    if (!wsServer || !wsServer.bus || typeof wsServer.bus.registerDeviceTransport !== 'function') {
        return;
    }

    wsServer.bus.registerDeviceTransport(deviceId, {
        publishRuntimeMessage: (envelope) => {
            if (ws.readyState !== WebSocket.OPEN) {
                return false;
            }
            ws.send(JSON.stringify({
                type: 'runtimeEnvelope',
                envelope
            }));
            return true;
        }
    });
}

function unregisterRuntimeBridgeTransport(deviceId) {
    if (!wsServer || !wsServer.bus || typeof wsServer.bus.unregisterDeviceTransport !== 'function') {
        return;
    }
    wsServer.bus.unregisterDeviceTransport(deviceId);
}

function bindRuntimeBridgeTransports() {
    runtimeBridgeClients.forEach((clientWs, deviceId) => {
        registerRuntimeBridgeTransport(deviceId, clientWs);
    });
}

wss.on('connection', (ws, req) => {
    const url = req.url || '/';

    if (url === '/runtime-bridge' || url.startsWith('/runtime-bridge')) {
        let runtimeBridgeDeviceId = getRuntimeBridgeDeviceId(url);
        runtimeBridgeClients.set(runtimeBridgeDeviceId, ws);
        registerRuntimeBridgeTransport(runtimeBridgeDeviceId, ws);

        log('WS', `运行时桥接设备已连接: ${runtimeBridgeDeviceId}`);
        ws.send(JSON.stringify({
            type: 'runtimeBridge.connected',
            deviceId: runtimeBridgeDeviceId,
            serverTime: Date.now()
        }));

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                if (data.type === 'runtimeBridge.register' && data.deviceId) {
                    if (data.deviceId !== runtimeBridgeDeviceId) {
                        runtimeBridgeClients.delete(runtimeBridgeDeviceId);
                        unregisterRuntimeBridgeTransport(runtimeBridgeDeviceId);
                        runtimeBridgeDeviceId = data.deviceId;
                        runtimeBridgeClients.set(runtimeBridgeDeviceId, ws);
                        registerRuntimeBridgeTransport(runtimeBridgeDeviceId, ws);
                        log('WS', `运行时桥接设备重新注册: ${runtimeBridgeDeviceId}`);
                    }
                    return;
                }

                if (data.type === 'runtimeEnvelope' && data.envelope) {
                    if (wsServer && wsServer.bus && typeof wsServer.bus.receiveRemoteRuntimeMessage === 'function') {
                        wsServer.bus.receiveRemoteRuntimeMessage(data.envelope);
                    }
                    return;
                }

                if (data.type === 'runtimeBridge.heartbeat') {
                    ws.send(JSON.stringify({
                        type: 'runtimeBridge.heartbeatAck',
                        time: Date.now(),
                        deviceId: runtimeBridgeDeviceId
                    }));
                }
            } catch (e) {
                logError('WS', `运行时桥接消息解析失败: ${e.message}`);
            }
        });

        ws.on('close', () => {
            runtimeBridgeClients.delete(runtimeBridgeDeviceId);
            unregisterRuntimeBridgeTransport(runtimeBridgeDeviceId);
            ws.removeAllListeners();
            log('WS', `运行时桥接设备已断开: ${runtimeBridgeDeviceId}`);
        });

        ws.on('error', (error) => {
            logError('WS', `运行时桥接设备错误(${runtimeBridgeDeviceId}): ${error.message}`);
            runtimeBridgeClients.delete(runtimeBridgeDeviceId);
            unregisterRuntimeBridgeTransport(runtimeBridgeDeviceId);
            ws.removeAllListeners();
        });

        return;
    }
    
    if (url === '/display' || url.startsWith('/display')) {
        const urlParams = new URL(url, 'http://localhost');
        const isSubDisplay = urlParams.searchParams.get('subDisplay') === 'true';
        const customDisplayId = urlParams.searchParams.get('displayId');
        const displayId = customDisplayId || generateId();
        const clientIP = getClientIP(req);
        const savedState = config.getDisplayState(clientIP);
        displayClients.set(displayId, {
            ws: ws,
            ip: clientIP,
            isSubDisplay: isSubDisplay,
            lastSeen: Date.now(),
            state: {
                ...createDisplayState(),
                ...savedState,
                isSubDisplay: isSubDisplay,
                capabilities: isSubDisplay ? { ...SUB_DISPLAY_CAPABILITIES } : null
            }
        });
        // 非子显示端：从持久化恢复用户覆盖值，等显示端声明能力后自动合并
        if (!isSubDisplay && savedState?.userCapabilities) {
            const entry = displayClients.get(displayId);
            if (entry) {
                entry.state.userCapabilities = { ...savedState.userCapabilities };
            }
        }
        log('连接', `显示端 ${displayId} (${clientIP})${isSubDisplay ? ' [子显示端]' : ''} 已连接，当前连接数: ${displayClients.size}`);
        
        if (wsServer) {
            wsServer.handleDisplayConnect(displayId, clientIP, ws, savedState);
        }
        
        ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));
        ws.send(JSON.stringify({ type: 'displayId', id: displayId, ip: clientIP }));

        // 发送日志上报配置
        const reportCfg = getDisplayLogReportConfig(displayId);
        ws.send(JSON.stringify({ type: 'logReportConfig', enabled: reportCfg.enabled, level: reportCfg.level }));

        if (isSubDisplay) {
            const protocol = useHttps ? 'https' : 'http';
            const localIP = getLocalIP();
            ws.send(JSON.stringify({
                type: 'configUpdate',
                config: {
                    serverUrl: `${protocol}://${localIP}:${PORT}`,
                    displayId: displayId,
                    vadThreshold: 0.01
                }
            }));
        }

        const asrDevice = config.get('asr.device', 'server');
        ws.send(JSON.stringify({
            type: 'asrConfig',
            device: asrDevice,
            localAsrEnabled: asrDevice === 'display'
        }));

        // 连接时发送服务器端保存的用户能力覆盖（如果有），让显示端启动时就知道限制
        if (!isSubDisplay && savedState?.userCapabilities) {
            const initialCaps = {
                ...DEFAULT_CAPABILITIES,
                ...savedState.userCapabilities
            };
            ws.send(JSON.stringify({
                type: 'capabilitiesUpdated',
                capabilities: initialCaps
            }));
        }

        if (savedState && savedState.currentMedia) {
            ws.send(JSON.stringify({ 
                type: 'restoreState',
                state: savedState
            }));
        }
        
        broadcastDisplayList();
        
        executeDeviceEvent(clientIP, 'onConnect', displayId);
        
        ws.on('message', async (message) => {
            try {
                const displayData = displayClients.get(displayId);
                if (displayData) {
                    displayData.lastSeen = Date.now();
                }
                
                const data = JSON.parse(message);
                data.displayId = displayId;

                if (data.type !== 'clientLog') {
                    log('WS', `<< ${data.type}${data.chunk ? ' chunk='+data.chunk.length : ''}${data.isLast ? ' isLast' : ''}${data.text ? ' "'+data.text+'"' : ''}`, { displayId, source: `display:${displayId}`, scope: 'single' });
                }

                if (data.type === 'asrResult') {
                    const pending = pendingDisplayAsrRequests.get(data.requestId);
                    if (pending) {
                        pendingDisplayAsrRequests.delete(data.requestId);
                        clearTimeout(pending.timer);
                        if (data.text) {
                            pending.resolve(data.text);
                        } else {
                            pending.reject(new Error(data.error || '显示端 ASR 识别失败'));
                        }
                    }
                    return;
                }

                if (wsServer) {
                    const result = await wsServer.handleDisplayMessage(displayId, data, ws);
                    if (!result.success && result.reason) {
                        log('WS', `消息处理失败: ${result.reason}`);
                    }
                } else {
                    handleDisplayMessageFallback(displayId, data, ws);
                }
            } catch (e) {
                logError('错误', `解析显示端消息失败: ${e.message}`);
            }
        });

        ws.on('close', () => {
            const disconnectedIP = clientIP;
            muteState.previousVolumes.delete(displayId);
            displayClients.delete(displayId);
            ws.removeAllListeners();
            if (wsServer) {
                wsServer.handleDisplayDisconnect(displayId);
            }
            log('断开', `显示端 ${displayId} 已断开，当前连接数: ${displayClients.size}`);
            broadcastDisplayList();
            executeDeviceEvent(disconnectedIP, 'onDisconnect', displayId);
        });
    } else if (url === '/control' || url.startsWith('/control')) {
        controlClients.add(ws);
        if (wsServer) {
            wsServer.handleControlConnect(ws);
        }
        log('连接', `控制端已连接，当前连接数: ${controlClients.size}`);
        
        ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));
        ws.send(JSON.stringify({ type: 'displayList', list: getDisplayList() }));
        ws.send(JSON.stringify({
            type: 'logHistory',
            entries: logBuffer.getEntries({ limit: 200 }),
            categories: logBuffer.getCategories()
        }));
        ws.send(JSON.stringify({
            type: 'systemStats',
            stats: systemMonitor.getStats()
        }));
        ws.send(JSON.stringify({ type: 'commandRouting', routing: voiceCommand.getCommandRouting() }));
        // 发送日志上报配置（控制端需要显示端默认配置和控制端自身配置）
        ws.send(JSON.stringify({ type: 'logReportConfig', target: 'display', enabled: logReportStore.display.enabled, level: logReportStore.display.level }));
        ws.send(JSON.stringify({ type: 'logReportConfig', target: 'control', enabled: logReportStore.control.enabled, level: logReportStore.control.level }));
        // 发送日志分类屏蔽配置
        const allCats = new Set([
            ...logBuffer.getCategories(),
            ...Object.keys(LogBuffer.CATEGORY_DEVICE_MAP),
            '控制端'
        ]);
        ws.send(JSON.stringify({
            type: 'logBlocklist',
            categories: logBlocklist,
            allCategories: [...allCats].sort()
        }));

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);

                if (data.type !== 'clientLog' && data.type !== 'setLogReport' && data.type !== 'setLogBlocklist') {
                    if (!data.correlationId && (data.displayId || data.type === 'mediaBatch' || data.type === 'tts')) {
                        data.correlationId = generateCorrelationId(data.type);
                    }
                    const extra = { source: 'control', scope: 'single', targetId: data.displayId || null };
                    if (data.correlationId) extra.correlationId = data.correlationId;
                    const shouldLogCrop = data.type !== 'control' || data.action !== 'crop' || _cropDebugLog;
                    if (shouldLogCrop) {
                        log('WS', `<< ${data.type}${data.displayId ? ' displayId='+data.displayId : ''}${data.text ? ' "'+data.text+'"' : ''}`, extra);
                    }
                }

                if (data.type === 'updateCapabilities') {
                    const targetDisplayId = data.displayId;
                    const targetDisplayData = displayClients.get(targetDisplayId);
                    if (targetDisplayData) {
                        targetDisplayData.state.capabilities = {
                            ...DEFAULT_CAPABILITIES,
                            ...data.capabilities
                        };
                        // 保存用户覆盖值，重连后恢复
                        targetDisplayData.state.userCapabilities = { ...data.capabilities };
                        sendToDisplay(targetDisplayId, {
                            type: 'capabilitiesUpdated',
                            capabilities: targetDisplayData.state.capabilities
                        });
                        if (config) {
                            config.updateDisplayState(targetDisplayData.ip, {
                                capabilities: targetDisplayData.state.capabilities,
                                userCapabilities: { ...data.capabilities }
                            });
                        }
                        broadcastDisplayList();
                        log('能力', `控制端更新显示端 ${targetDisplayId} 能力`);
                    }
                } else if (wsServer) {
                    const result = await wsServer.handleControlMessage(data, ws);
                    if (!result.success && result.reason) {
                        log('WS', `消息处理失败: ${result.reason}`);
                    }
                } else {
                    await handleControlMessageFallback(data, ws);
                }
            } catch (e) {
                logError('错误', `解析控制端消息失败: ${e.message}`);
            }
        });
        
        ws.on('close', () => {
            controlClients.delete(ws);
            ws.removeAllListeners();
            if (wsServer) {
                wsServer.handleControlDisconnect(ws);
            }
            log('断开', `控制端已断开，当前连接数: ${controlClients.size}`);
        });
    }
    
    ws.on('error', (error) => {
        logError('错误', `WebSocket错误: ${error.message}`);
    });
});

function handleDisplayMessageFallback(displayId, data, ws) {
    const displayData = displayClients.get(displayId);
    
    if (data.type === 'heartbeat') {
        return;
    } else if (data.type === 'canvasSize' && displayData) {
        displayData.state.canvasSize = { width: data.width, height: data.height };
        broadcastDisplayList();
    } else if (data.type === 'browserInfo' && displayData) {
        displayData.state.browserInfo = {
            userAgent: data.userAgent,
            browserName: data.browserName,
            browserVersion: data.browserVersion,
            os: data.os,
            deviceType: data.deviceType,
            screenWidth: data.screenWidth,
            screenHeight: data.screenHeight,
            devicePixelRatio: data.devicePixelRatio,
            featureSupport: data.featureSupport
        };
        broadcastDisplayList();
    } else if (data.type === 'voiceInput' && displayData) {
        broadcastToControls({
            type: 'voiceInput',
            displayId: displayId,
            text: data.text,
            isFinal: data.isFinal,
            fullText: data.fullText
        });

        // 构造 voiceCommand 消息转发到控制端处理链路，复用 LLM/命令解析/执行逻辑
        if (data.isFinal && data.text && data.text.trim()) {
            handleControlMessageFallback({
                type: 'voiceCommand',
                text: data.text.trim(),
                displayId
            }, ws);
        }
    } else if (data.type === 'voiceStatus' && displayData) {
        displayData.state.voiceSupported = data.supported;
        displayData.state.voiceListening = data.listening;
        broadcastDisplayList();
    } else if (data.type === 'capabilities' && displayData) {
        displayData.state.capabilities = {
            ...DEFAULT_CAPABILITIES,
            ...data.capabilities
        };
        // 重连后恢复用户手动覆盖的能力值
        if (displayData.state.userCapabilities) {
            Object.assign(displayData.state.capabilities, displayData.state.userCapabilities);
        }
        // 将合并后的能力通知显示端，让显示端根据限制调整行为
        sendToDisplay(displayId, {
            type: 'capabilitiesUpdated',
            capabilities: displayData.state.capabilities
        });
        var diag = data.capabilities._webgpuDiag ? ' [' + data.capabilities._webgpuDiag + ']' : '';
        log('能力', '显示端 ' + displayId + ' webgpu=' + (data.capabilities.webgpu ? '可用' : '不可用') + ', webgl=' + (data.capabilities.webgl ? '可用' : '不可用') + diag);
        broadcastDisplayList();
    } else if (data.type === 'commandAck' && displayData) {
        const ackCorrelationId = data.correlationId || generateCorrelationId('ack');
        log('WS', `<< ${displayId} ACK: ${data.commandType} ${data.success ? '✓' : '✗'} ${data.details || ''}`, {
            displayId, source: displayId, targetId: 'server', scope: 'single',
            correlationId: ackCorrelationId
        });
        const ackMsg = {
            type: 'commandAck',
            displayId: displayId,
            commandType: data.commandType,
            success: data.success,
            details: data.details,
            timestamp: data.timestamp,
            correlationId: ackCorrelationId
        };
        if (data.extraData) {
            ackMsg.extraData = data.extraData;
        }
        broadcastToControls(ackMsg);
    }
}

async function handleControlMessageFallback(data, ws) {
    const displayId = data.displayId;
    const displayData = displayClients.get(displayId);
    
    if (data.type === 'voiceCommand') {
                    (async () => {
                        try {
                            const playOnControl = data.playOnControl || false;
                            const targetDisplayId = data.displayId || displayId;
                            
                            const sendToControl = (msg) => {
                                ws.send(JSON.stringify(msg));
                            };
                            
                            const callbacks = playOnControl ? {
                                onResult: async (text) => {
                                    try {
                                        const audioPath = await tts.generateTTS(text);
                                        const fileName = path.basename(audioPath);
                                        sendToControl({
                                            type: 'playOnControl',
                                            audioUrl: `/uploads/tts/${fileName}`,
                                            text: text
                                        });
                                    } catch (err) {
                                        logError('VoiceCommand', `TTS生成失败: ${err.message}`);
                                    }
                                },
                                onError: async (text) => {
                                    try {
                                        const audioPath = await tts.generateTTS(text);
                                        const fileName = path.basename(audioPath);
                                        sendToControl({
                                            type: 'playOnControl',
                                            audioUrl: `/uploads/tts/${fileName}`,
                                            text: text
                                        });
                                    } catch (err) {
                                        logError('VoiceCommand', `TTS生成失败: ${err.message}`);
                                    }
                                }
                            } : null;
                            
                            const result = await voiceCommand.processVoiceCommand(data.text, targetDisplayId, callbacks);
                            
                            if (!result) return;
                            
                            if (result.type === 'showHelp') {
                                // showHelp 仅发给控制端网页，显示端只播报 TTS
                                if (controlClients.has(ws)) {
                                    sendToControl({ type: 'showHelp' });
                                }
                                if (targetDisplayId && sendToDisplay) {
                                    const helpTTS = '系统指令帮助：说系统显示此帮助。说私聊加助手名字进入私聊模式。说退出私聊退出私聊模式。说提醒加时间和内容设置提醒。说今日提醒或今天提醒查看今日提醒。说明日提醒或明天提醒查看明日提醒。说报时或现在几点播报当前时间。说开启报时或关闭报时控制报时功能。说静音或全部静音静音所有显示端。说取消静音或恢复音量取消静音。说天气加城市查询天气。说播放加文件名搜索并播放媒体。说搜索加关键词搜索信息。说拒绝或取消取消待确认操作。';
                                    (async () => {
                                        try {
                                            const audioPath = await tts.generateTTS(helpTTS);
                                            const fileName = path.basename(audioPath);
                                            sendToDisplay(targetDisplayId, {
                                                type: 'voiceCommand',
                                                action: 'response',
                                                text: helpTTS,
                                                audioUrl: `/uploads/tts/${fileName}`
                                            });
                                        } catch (err) {
                                            logError('VoiceCommand', `帮助TTS生成失败: ${err.message}`);
                                        }
                                    })();
                                }
                            } else if (result.type === 'commandMode') {
                                const modeText = result.enabled ? '已开启指令模式' : '已关闭指令模式';
                                // 更新会话状态
                                const s = chat.getSession();
                                s.commandMode = result.enabled;
                                chat.setSession(s);
                                // 持久化到配置
                                config.set('voiceCommand.commandMode', result.enabled);
                                // 广播到所有控制端
                                broadcastToControls({ type: 'commandMode', enabled: result.enabled });
                                // 显示端 TTS 播报
                                if (targetDisplayId && sendToDisplay) {
                                    (async () => {
                                        try {
                                            const audioPath = await tts.generateTTS(modeText);
                                            const fileName = path.basename(audioPath);
                                            sendToDisplay(targetDisplayId, {
                                                type: 'voiceCommand',
                                                action: 'response',
                                                text: modeText,
                                                audioUrl: `/uploads/tts/${fileName}`
                                            });
                                        } catch (err) {
                                            logError('VoiceCommand', `指令模式TTS失败: ${err.message}`);
                                        }
                                    })();
                                }
                            } else if (result.type === 'commands') {
                                await voiceCommand.executeCommands(result.actions, targetDisplayId, {
                                    onChat: async (message, systemPrompt) => {
                                        await handleChatMessage({
                                            content: message,
                                            displayId: targetDisplayId,
                                            playOnControl: playOnControl,
                                            systemPrompt: systemPrompt,
                                            sendToControl: sendToControl
                                        });
                                    },
                                    onShowHelp: () => {
                                        sendToControl({ type: 'showHelp' });
                                    },
                                    onModeChange: (mode, target) => {
                                        sendToControl({ type: mode, target: target });
                                    },
                                    onSystemMessage: (content) => {
                                        sendToControl({ type: 'systemMessage', content: content });
                                    }
                                });
                            } else if (result.type === 'chat') {
                                await handleChatMessage({
                                    content: result.message,
                                    displayId: targetDisplayId,
                                    playOnControl: playOnControl,
                                    systemPrompt: result.systemPrompt,
                                    skipHistory: result.skipHistory || false,
                                    sendToControl: sendToControl
                                });
                            } else if (result.type === 'privateMode' || result.type === 'groupMode') {
                                sendToControl({ type: result.type, target: result.target });
                            } else if (result.type === 'systemMessage') {
                                sendToControl({ type: 'systemMessage', content: result.content });
                            }
                        } catch (err) {
                            logError('VoiceCommand', `处理失败: ${err.message}`);
                        }
                    })();
                    return;
                } else if (data.type === 'confirmVoiceCommand') {
                    await voiceCommand.executeReminderConfirmation(data.confirmationId, data.confirmed);
                    return;
                } else if (data.type === 'getSearchHistory') {
                    ws.send(JSON.stringify({
                        type: 'searchHistory',
                        history: voiceCommand.getSearchHistory()
                    }));
                    return;
                } else if (data.type === 'clearSearchHistory') {
                    voiceCommand.clearSearchHistory();
                    ws.send(JSON.stringify({
                        type: 'searchHistory',
                        history: []
                    }));
                    return;
                } else if (data.type === 'deleteSearchHistory') {
                    voiceCommand.deleteSearchHistoryItem(data.id);
                    ws.send(JSON.stringify({
                        type: 'searchHistory',
                        history: voiceCommand.getSearchHistory()
                    }));
                    return;
                } else if (data.type === 'getCommandRouting') {
                    ws.send(JSON.stringify({ type: 'commandRouting', routing: voiceCommand.getCommandRouting() }));
                    return;
                } else if (data.type === 'updateCommandRouting') {
                    const changed = voiceCommand.setCommandRouting(data.routing);
                    if (changed) {
                        config.set('voiceCommand.routing', voiceCommand.getCommandRouting());
                        broadcastToControls({ type: 'commandRouting', routing: voiceCommand.getCommandRouting() });
                    }
                    ws.send(JSON.stringify({ type: 'commandRouting', routing: voiceCommand.getCommandRouting() }));
                    return;
                } else if (data.type === 'getAssistantConfig') {
                    ws.send(JSON.stringify({
                        type: 'assistantConfig',
                        config: voiceCommand.getAssistantConfig()
                    }));
                    return;
                } else if (data.type === 'setAssistantConfig') {
                    voiceCommand.setAssistantConfig(data.config);
                    ws.send(JSON.stringify({
                        type: 'assistantConfig',
                        config: voiceCommand.getAssistantConfig()
                    }));
                    return;
                } else if (data.type === 'getReminders') {
                    (async () => {
                        const reminders = reminder.getReminders();
                        const today = new Date();
                        const todayReminders = reminders.filter(r => {
                            const reminderTime = new Date(r.timestamp);
                            return reminderTime.toDateString() === today.toDateString();
                        });
                        
                        if (todayReminders.length > 0 && displayId) {
                            const text = todayReminders.map(r => `${r.time} ${r.content}`).join('，');
                            try {
                                const audioPath = await tts.generateTTS(`今日提醒：${text}`);
                                const fileName = path.basename(audioPath);
                                sendToDisplay(displayId, {
                                    type: 'tts',
                                    action: 'playAudio',
                                    audioUrl: `/uploads/tts/${fileName}`,
                                    text: `今日提醒：${text}`
                                });
                            } catch (err) {
                                logError('语音命令', `今日提醒语音生成失败: ${err.message}`);
                            }
                        } else if (displayId) {
                            try {
                                const audioPath = await tts.generateTTS('今天没有提醒');
                                const fileName = path.basename(audioPath);
                                sendToDisplay(displayId, {
                                    type: 'tts',
                                    action: 'playAudio',
                                    audioUrl: `/uploads/tts/${fileName}`,
                                    text: '今天没有提醒'
                                });
                            } catch (err) {
                                logError('语音命令', `今日提醒语音生成失败: ${err.message}`);
                            }
                        }
                    })();
                    return;
                } else if (data.type === 'chatHistory') {
                    ws.send(JSON.stringify({
                        type: 'chatHistory',
                        history: chat.getHistory()
                    }));
                    return;
                } else if (data.type === 'clearChatHistory') {
                    chat.clearHistory();
                    ws.send(JSON.stringify({
                        type: 'chatHistory',
                        history: []
                    }));
                    return;
                } else if (data.type === 'getChatSession') {
                    ws.send(JSON.stringify({
                        type: 'chatSession',
                        session: chat.getSession()
                    }));
                    return;
                } else if (data.type === 'setChatSession') {
                    chat.setSession(data.session);
                    broadcastToControls({
                        type: 'chatSession',
                        session: chat.getSession()
                    });
                    return;
                } else if (data.type === 'listPrivateSessions') {
                    ws.send(JSON.stringify({
                        type: 'privateSessions',
                        target: data.target,
                        sessions: chat.listSessions(data.target)
                    }));
                    return;
                } else if (data.type === 'createPrivateSession') {
                    const session = chat.createSession(data.target, data.name);
                    ws.send(JSON.stringify({
                        type: 'privateSessionCreated',
                        target: data.target,
                        session: session
                    }));
                    broadcastToControls({
                        type: 'privateSessionCreated',
                        target: data.target,
                        session: session
                    });
                    return;
                } else if (data.type === 'deletePrivateSession') {
                    const success = chat.deleteSession(data.target, data.sessionId);
                    ws.send(JSON.stringify({
                        type: 'privateSessionDeleted',
                        target: data.target,
                        sessionId: data.sessionId,
                        success: success
                    }));
                    if (success) {
                        broadcastToControls({
                            type: 'privateSessionDeleted',
                            target: data.target,
                            sessionId: data.sessionId
                        });
                    }
                    return;
                } else if (data.type === 'switchPrivateSession') {
                    const success = chat.switchSession(data.target, data.sessionId);
                    if (success) {
                        ws.send(JSON.stringify({
                            type: 'privateSessionSwitched',
                            target: data.target,
                            sessionId: data.sessionId
                        }));
                        broadcastToControls({
                            type: 'privateSessionSwitched',
                            target: data.target,
                            sessionId: data.sessionId
                        });
                    }
                    return;
                } else if (data.type === 'getChatCommands') {
                    ws.send(JSON.stringify({
                        type: 'chatCommands',
                        commands: chat.getCommands()
                    }));
                    return;
                } else if (data.type === 'setChatCommands') {
                    chat.setCommands(data.commands);
                    broadcastToControls({
                        type: 'chatCommands',
                        commands: chat.getCommands()
                    });
                    return;
                } else if (data.type === 'mute') {
                    const result = muteAllDisplays();
                    ws.send(JSON.stringify({
                        type: 'muteResult',
                        success: result,
                        message: result ? '已静音所有显示端' : '已经是静音状态',
                        isMuted: muteState.isMuted
                    }));
                    return;
                } else if (data.type === 'unmute') {
                    const result = unmuteAllDisplays();
                    ws.send(JSON.stringify({
                        type: 'muteResult',
                        success: result,
                        message: result ? '已取消静音' : '当前不是静音状态',
                        isMuted: muteState.isMuted
                    }));
                    return;
                } else if (data.type === 'todayReminders') {
                    (async () => {
                        try {
                            await voiceCommand.handleTodayReminders(data.displayId || displayId);
                        } catch (err) {
                            logError('今日提醒', `处理失败: ${err.message}`);
                        }
                    })();
                    return;
                } else if (data.type === 'tomorrowReminders') {
                    (async () => {
                        try {
                            await voiceCommand.handleTomorrowReminders(data.displayId || displayId);
                        } catch (err) {
                            logError('明日提醒', `处理失败: ${err.message}`);
                        }
                    })();
                    return;
                } else if (data.type === 'mediaBatch') {
                    log('系统', `收到 mediaBatch, displayIds: ${data.displayIds}`);
                    const displayIds = data.displayIds || [];
                    displayIds.forEach(id => {
                        const dd = displayClients.get(id);
                        if (dd) {
                            if (!data.media.temp) {
                                dd.state.currentMedia = data.media;
                                config.updateDisplayState(dd.ip, { currentMedia: data.media });
                            }
                            log('系统', `${data.media.temp ? '临时媒体' : '媒体'}发送到显示端: ${id}`);
                            sendToDisplay(id, data.media);
                        }
                    });
                    return;
                }

                if (!displayData) return;

                if (data.type === 'getState') {
                    const stateToSend = { ...displayData.state };
                    if (stateToSend.currentMedia) {
                        stateToSend.currentMediaUrl = stateToSend.currentMedia.url;
                        stateToSend.currentMediaType = stateToSend.currentMedia.mediaType;
                    }
                    ws.send(JSON.stringify({
                        type: 'displayState',
                        displayId: displayId,
                        state: stateToSend
                    }));
                } else if (data.type === 'media') {
                    if (!data.media.temp) {
                        displayData.state.currentMedia = data.media;
                        config.updateDisplayState(displayData.ip, { currentMedia: data.media });
                    }
                    sendToDisplay(displayId, data.media);
                } else if (data.type === 'control') {
                    if (data.action === 'rotate') {
                        displayData.state.rotation = data.value;
                        config.updateDisplayState(displayData.ip, { rotation: data.value });
                    } else if (data.action === 'fit') {
                        displayData.state.fit = data.value;
                        config.updateDisplayState(displayData.ip, { fit: data.value });
                    } else if (data.action === 'crop') {
                        displayData.state.crop = data.value;
                        config.updateDisplayState(displayData.ip, { crop: data.value });
                    } else if (data.action === 'volume') {
                        displayData.state.volume = data.value;
                        config.updateDisplayState(displayData.ip, { volume: data.value });
                    } else if (data.action === 'play') {
                        displayData.state.isPlaying = data.value;
                        config.updateDisplayState(displayData.ip, { isPlaying: data.value });
                    } else if (data.action === 'cropDebug') {
                        _cropDebugLog = !!data.value;
                    }
                    sendToDisplay(displayId, data);
                } else if (data.type === 'tts') {
                    if (data.action === 'stop') {
                        sendToDisplaysWithCapability('voicePlayback', data);
                    } else if (data.action === 'play' && data.text) {
                        (async () => {
                            try {
                                const cleanText = stripMarkdown(data.text);
                                const sentences = chat.splitIntoSentences(cleanText);
                                const targetDisplayIds = data.displayIds || (displayId ? [displayId] : []);
                                
                                for (const sentence of sentences) {
                                    const audioPath = await tts.generateTTS(sentence);
                                    const fileName = path.basename(audioPath);
                                    const audioUrl = `/uploads/tts/${fileName}`;
                                    
                                    if (data.playOnControl) {
                                        ws.send(JSON.stringify({
                                            type: 'playOnControl',
                                            audioUrl: audioUrl,
                                            text: sentence
                                        }));
                                    } else if (data.broadcastAll) {
                                        sendToDisplaysWithCapability('voicePlayback', {
                                            type: 'tts',
                                            action: 'playAudio',
                                            audioUrl: audioUrl,
                                            text: sentence
                                        });
                                    } else if (targetDisplayIds.length > 0) {
                                        for (const targetId of targetDisplayIds) {
                                            const caps = getDisplayCapabilities(targetId);
                                            if (caps && caps.voicePlayback) {
                                                sendToDisplay(targetId, {
                                                    type: 'tts',
                                                    action: 'playAudio',
                                                    audioUrl: audioUrl,
                                                    text: sentence
                                                });
                                            }
                                        }
                                    } else if (displayId) {
                                        sendToDisplay(displayId, {
                                            type: 'tts',
                                            action: 'playAudio',
                                            audioUrl: audioUrl,
                                            text: sentence
                                        });
                                    }
                                }
                            } catch (err) {
                                logError('TTS', `播放失败: ${err.message}`);
                            }
                        })();
                    } else {
                        sendToDisplay(displayId, data);
                    }
                } else if (data.type === 'chat') {
                    (async () => {
                        try {
                            let ttsQueue = Promise.resolve(); // 串行化 TTS 保证播放顺序
                            await chat.chatStream(data.message, {
                                useTemplate: data.useTemplate,
                                displayId: displayId
                            }, {
                                onChunk: (chunk, fullMessage) => {
                                    ws.send(JSON.stringify({
                                        type: 'chatChunk',
                                        chunk: chunk,
                                        message: fullMessage
                                    }));
                                },
                                onSentence: async (sentence, fullMessage) => {
                                    ttsQueue = ttsQueue.then(async () => {
                                        const cleanText = stripMarkdown(sentence);
                                        const audioPath = await tts.generateTTS(cleanText);
                                        const fileName = path.basename(audioPath);
                                        sendToDisplay(displayId, {
                                            type: 'tts',
                                            action: 'playAudio',
                                            audioUrl: `/uploads/tts/${fileName}`,
                                            text: sentence
                                        });
                                    }).catch(err => {
                                        logError('Chat', `TTS生成失败: ${err.message}`);
                                    });
                                    await ttsQueue;
                                },
                                onComplete: (fullMessage, history) => {
                                    ws.send(JSON.stringify({
                                        type: 'chatResponse',
                                        success: true,
                                        message: fullMessage,
                                        history: history
                                    }));
                                },
                                onError: (error) => {
                                    ws.send(JSON.stringify({
                                        type: 'chatResponse',
                                        success: false,
                                        error: error
                                    }));
                                }
                            });
                        } catch (err) {
                            logError('Chat', `处理失败: ${err.message}`);
                            ws.send(JSON.stringify({
                                type: 'chatResponse',
                                success: false,
                                error: err.message
                            }));
                        }
                    })();
                } else if (data.type === 'chatMessage') {
                    (async () => {
                        try {
                            const session = chat.getSession();
                            const targetDisplayId = data.displayId || displayId;
                            const targetDisplayIds = data.displayIds || [];
                            
                            await handleChatMessage({
                                content: data.content,
                                displayContent: data.displayContent || data.content,
                                displayId: targetDisplayId,
                                displayIds: targetDisplayIds,
                                playOnControl: data.playOnControl || session.playOnControl,
                                templateTarget: data.templateTarget || data.target,
                                mode: data.mode || session.mode,
                                target: data.mode === 'private' ? (data.target || session.privateTarget) : null,
                                sessionId: data.sessionId || session.privateSessionId || 'default',
                                sendToControl: (msg) => {
                                    ws.send(JSON.stringify(msg));
                                }
                            });
                        } catch (err) {
                            logError('Chat', `处理失败: ${err.message}`);
                            ws.send(JSON.stringify({
                                type: 'chatResponse',
                                success: false,
                                error: err.message
                            }));
                        }
                    })();
                } else if (data.type === 'executeCommands') {
                    (async () => {
                        try {
                            await voiceCommand.executeCommands(data.actions, data.displayId, {
                                onChat: async (message, systemPrompt) => {
                                    await handleChatMessage({
                                        content: message,
                                        displayId: data.displayId,
                                        playOnControl: data.playOnControl,
                                        systemPrompt: systemPrompt,
                                        sendToControl: (msg) => {
                                            ws.send(JSON.stringify(msg));
                                        }
                                    });
                                },
                                onShowHelp: () => {
                                    ws.send(JSON.stringify({ type: 'showHelp' }));
                                },
                                onModeChange: (mode, target) => {
                                    ws.send(JSON.stringify({ type: mode, target: target }));
                                },
                                onSystemMessage: (content) => {
                                    ws.send(JSON.stringify({ type: 'systemMessage', content: content }));
                                }
                            });
                        } catch (err) {
                            logError('Commands', `执行失败: ${err.message}`);
                        }
                    })();
                } else if (data.type === 'switchProfile') {
                    try {
                        const { name } = data;
                        if (name && chat.switchProfile(name)) {
                            const chatCfg = chat.getConfig();
                            config.set('chat', {
                                ...chatCfg,
                                activeProfile: chat.getActiveProfile()
                            });
                            ws.send(JSON.stringify({
                                type: 'profileSwitched',
                                activeProfile: chat.getActiveProfile(),
                                config: { apiUrl: chatCfg.apiUrl, model: chatCfg.model }
                            }));
                            broadcastToControls({
                                type: 'profileSwitched',
                                activeProfile: chat.getActiveProfile(),
                                config: { apiUrl: chatCfg.apiUrl, model: chatCfg.model }
                            });
                        } else {
                            ws.send(JSON.stringify({
                                type: 'profileSwitched',
                                error: `未找到配置: ${name}`
                            }));
                        }
                    } catch (err) {
                        logError('Profile', `切换失败: ${err.message}`);
                    }
                }
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.address.startsWith('10.')) {
                continue;
            }
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

async function handleChatMessage(options) {
    const {
        content,
        displayContent,
        displayId,
        displayIds = [],
        playOnControl = false,
        systemPrompt: customSystemPrompt,
        templateTarget,
        mode = 'group',
        target,
        sessionId,
        skipHistory = false,
        sendToControl
    } = options;
    
    const messageMode = mode;
    const messageTarget = messageMode === 'private' ? target : null;
    
    chat.addMessage({
        role: 'control',
        name: '控制端',
        content: displayContent || content,
        mode: messageMode,
        target: messageTarget,
        sessionId: sessionId
    });
    
    let systemPrompt = null;
    let includeHistory = false;
    let contextCount = 0;
    if (templateTarget) {
        const template = chat.getTemplateByName(templateTarget);
        if (template) {
            systemPrompt = template.content;
            if (messageMode === 'private') {
                includeHistory = true;
                contextCount = 100;
            } else {
                contextCount = chat.getConfig().contextCount || 0;
                if (contextCount > 0) includeHistory = true;
            }
        }
    } else {
        contextCount = chat.getConfig().contextCount || 0;
        if (contextCount > 0) includeHistory = true;
    }
    if (customSystemPrompt && !templateTarget) {
        systemPrompt = customSystemPrompt;
    }
    if (skipHistory) {
        includeHistory = false;
        contextCount = 0;
    }

    let ttsQueue = Promise.resolve(); // 串行化 TTS 保证播放顺序
    await chat.chatStream(content, {
        useTemplate: null,
        displayId: displayId,
        systemPrompt: systemPrompt,
        includeHistory: includeHistory,
        contextCount: contextCount,
        mode: messageMode,
        target: messageTarget
    }, {
        onChunk: (chunk, fullMessage) => {
            sendToControl({ type: 'chatChunk', chunk, message: fullMessage });
        },
        onSentence: async (sentence, fullMessage) => {
            if (!tts) return;
            ttsQueue = ttsQueue.then(async () => {
                const cleanText = stripMarkdown(sentence);
                const audioPath = await tts.generateTTS(cleanText);
                const fileName = path.basename(audioPath);
                const audioUrl = `/uploads/tts/${fileName}`;

                if (playOnControl) {
                    sendToControl({ type: 'playOnControl', audioUrl, text: sentence });
                } else if (displayIds.length > 0) {
                    for (const tid of displayIds) {
                        sendToDisplay(tid, {
                            type: 'tts',
                            action: 'playAudio',
                            audioUrl: audioUrl,
                            text: sentence
                        });
                    }
                } else if (displayId) {
                    sendToDisplay(displayId, {
                        type: 'tts',
                        action: 'playAudio',
                        audioUrl: audioUrl,
                        text: sentence
                    });
                }
            }).catch(err => {
                logError('Chat', `TTS生成失败: ${err.message}`);
            });
            await ttsQueue;
        },
        onComplete: (fullMessage, history) => {
            chat.addMessage({
                role: 'assistant',
                name: templateTarget || '助手',
                content: fullMessage,
                mode: messageMode,
                target: messageTarget
            });
            
            sendToControl({ type: 'chatResponse', success: true, message: fullMessage, history: chat.getHistory() });
        },
        onError: (error) => {
            sendToControl({ type: 'chatResponse', success: false, error });
        }
    });
}

const deviceEventDebounce = new Map();
const DEVICE_EVENT_DEBOUNCE_MS = 30000;

setInterval(() => {
    const now = Date.now();
    for (const [key, time] of deviceEventDebounce) {
        if (now - time > DEVICE_EVENT_DEBOUNCE_MS) {
            deviceEventDebounce.delete(key);
        }
    }
}, 1 * 60 * 1000);

async function executeDeviceEvent(ip, eventType, displayId) {
    try {
        const debounceKey = `${ip}_${eventType}`;
        const lastTime = deviceEventDebounce.get(debounceKey) || 0;
        if (Date.now() - lastTime < DEVICE_EVENT_DEBOUNCE_MS) {
            log('设备', `防抖跳过: ${ip} ${eventType}，距上次 ${Math.round((Date.now() - lastTime) / 1000)}s`);
            return;
        }
        deviceEventDebounce.set(debounceKey, Date.now());
        
        const eventConfig = config.getDeviceEvent(ip);
        let command = eventConfig[eventType];
        
        if (!command) {
            const defaultConfig = config.getDeviceEvent('default');
            command = defaultConfig[eventType];
        }
        
        if (!command) return;
        
        log('设备', `${ip} ${eventType}: ${command}`);
        
        let targetDisplayId = displayId;
        if (eventType === 'onDisconnect') {
            const disconnectedDisplay = displayClients.get(displayId);
            if (disconnectedDisplay) {
                // 显示端还在 displayClients 中，正常发送
            } else {
                // 显示端已断开，找其他在线显示端
                let found = false;
                for (const [id, data] of displayClients) {
                    if (data.ws.readyState === WebSocket.OPEN) {
                        targetDisplayId = id;
                        found = true;
                        log('设备', `原显示端已断开，转发到显示端 ${id}`);
                        break;
                    }
                }
                if (!found) {
                    log('设备', '没有在线显示端，跳过语音播报');
                    broadcastToControls({
                        type: 'deviceEventExecuted',
                        ip: ip,
                        eventType: eventType,
                        command: command,
                        result: null,
                        timestamp: Date.now()
                    });
                    return;
                }
            }
        }
        
        const sendToControl = (msg) => {
            broadcastToControls(msg);
        };
        
        const result = await voiceCommand.processVoiceCommand(command, targetDisplayId, null);
        
        if (!result) return;
        
        if (result.type === 'showHelp') {
            sendToControl({ type: 'showHelp' });
        } else if (result.type === 'commands') {
            await voiceCommand.executeCommands(result.actions, targetDisplayId, {
                onChat: async (message, systemPrompt) => {
                    await handleChatMessage({
                        content: message,
                        displayId: targetDisplayId,
                        systemPrompt: systemPrompt,
                        sendToControl: sendToControl
                    });
                },
                onShowHelp: () => {
                    sendToControl({ type: 'showHelp' });
                },
                onModeChange: (mode, target) => {
                    sendToControl({ type: mode, target: target });
                },
                onSystemMessage: (content) => {
                    sendToControl({ type: 'systemMessage', content: content });
                }
            });
        } else if (result.type === 'chat') {
            await handleChatMessage({
                content: result.message,
                displayId: targetDisplayId,
                systemPrompt: result.systemPrompt,
                sendToControl: sendToControl
            });
        }
        
        broadcastToControls({
            type: 'deviceEventExecuted',
            ip: ip,
            eventType: eventType,
            command: command,
            result: result,
            timestamp: Date.now()
        });
    } catch (err) {
        logError('设备', `执行失败 ${ip} ${eventType}: ${err.message}`);
    }
}

function updateVoiceDisplayConfig(localIP, port, protocol) {
    const configPath = path.join(PROJECT_ROOT, 'src', 'apps', 'voice-display-node', 'config.json');
    try {
        const config = {
            serverUrl: `${protocol}://${localIP}:${port}`,
            displayId: 'voice-display-node-1',
            vadThreshold: 0.01
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        log('子显示端', `配置已更新: ${protocol}://${localIP}:${port}`);
    } catch (err) {
        logError('子显示端', `配置更新失败: ${err.message}`);
    }
}

setInterval(() => {
    tts.cleanupOldTtsFiles();
}, 5 * 60 * 1000);

const SUB_DISPLAY_TIMEOUT_MS = 3 * 60 * 1000;
const SUB_DISPLAY_CHECK_INTERVAL_MS = 30 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [displayId, displayData] of displayClients) {
        if (displayData.isSubDisplay && displayData.lastSeen) {
            const elapsed = now - displayData.lastSeen;
            if (elapsed > SUB_DISPLAY_TIMEOUT_MS) {
                log('子显示端', `${displayId} 超过3分钟未响应，执行离线指令`);
                
                const disconnectedIP = displayData.ip;
                executeDeviceEvent(disconnectedIP, 'onDisconnect', displayId);
                
                displayClients.delete(displayId);
                if (wsServer) {
                    wsServer.handleDisplayDisconnect(displayId);
                }
                log('子显示端', `${displayId} 已强制断开，当前连接数: ${displayClients.size}`);
                broadcastDisplayList();
            }
        }
    }
}, SUB_DISPLAY_CHECK_INTERVAL_MS);

setInterval(() => {
    const deadDisplays = [];
    displayClients.forEach((data, id) => {
        if (data.ws.readyState !== WebSocket.OPEN && data.ws.readyState !== WebSocket.CONNECTING) {
            deadDisplays.push(id);
        }
    });
    deadDisplays.forEach(id => {
        displayClients.delete(id);
        if (wsServer) {
            wsServer.handleDisplayDisconnect(id);
        }
    });
    if (deadDisplays.length > 0) {
        log('内存', `清理了 ${deadDisplays.length} 个已断开但未清理的显示端连接`);
        broadcastDisplayList();
    }

    const deadControls = [];
    controlClients.forEach(ws => {
        if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
            deadControls.push(ws);
        }
    });
    deadControls.forEach(ws => {
        controlClients.delete(ws);
        if (wsServer) {
            wsServer.handleControlDisconnect(ws);
        }
    });
    if (deadControls.length > 0) {
        log('内存', `清理了 ${deadControls.length} 个已断开但未清理的控制端连接`);
    }
}, 1 * 60 * 1000);

let heavyMemoryCheckCount = 0;
setInterval(() => {
    const usage = process.memoryUsage();
    const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + 'MB';
    log('内存', `RSS: ${mb(usage.rss)} | Heap: ${mb(usage.heapUsed)}/${mb(usage.heapTotal)} | External: ${mb(usage.external)} | ArrayBuffers: ${mb(usage.arrayBuffers || 0)}`);

    const rssMB = usage.rss / 1024 / 1024;
    if (rssMB > 500) {
        heavyMemoryCheckCount++;
        logError('内存', `RSS超过500MB (${rssMB.toFixed(1)}MB)`);
        log('内存', `连接状态 - 显示端: ${displayClients.size} | 控制端: ${controlClients.size} | 设备事件防抖: ${deviceEventDebounce.size}`);
        log('内存', `RSS分布: ${getRssLayout()}`);
        // smaps 解析和 GC 每 5 分钟执行一次，避免频繁 CPU 尖峰
        if (heavyMemoryCheckCount % 5 === 1) {
            log('内存', `Top RSS区段: ${getTopSmapsRss()}`);
            if (global.gc) {
                global.gc();
                const afterGc = process.memoryUsage();
                log('内存', `GC后 RSS: ${mb(afterGc.rss)} | Heap: ${mb(afterGc.heapUsed)}/${mb(afterGc.heapTotal)}`);
            }
        }
    } else {
        heavyMemoryCheckCount = 0;
    }

    if (wsServer && wsServer.bus && typeof wsServer.bus.trimStats === 'function') {
        wsServer.bus.trimStats();
    }
}, 1 * 60 * 1000);

setInterval(() => {
    try {
        const tempDirs = [ASR_TEMP_DIR, HTTP_UPLOAD_TEMP_DIR];
        const now = Date.now();
        const maxAge = 30 * 60 * 1000;
        let totalCleaned = 0;
        
        tempDirs.forEach(dir => {
            if (!fs.existsSync(dir)) return;
            const files = fs.readdirSync(dir);
            files.forEach(f => {
                const filePath = path.join(dir, f);
                try {
                    const stat = fs.statSync(filePath);
                    if (now - stat.mtimeMs > maxAge) {
                        const size = stat.size;
                        fs.unlinkSync(filePath);
                        totalCleaned++;
                        log('系统', `清理临时文件: ${f} (${formatFileSize(size)})`);
                    }
                } catch (e) {}
            });
        });

        if (totalCleaned > 0) {
            log('系统', `清理临时文件完毕: 共${totalCleaned}个`);
        }
    } catch (err) {
    }
}, 10 * 60 * 1000);
