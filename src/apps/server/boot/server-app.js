const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('node:child_process');
const { pipeline } = require('stream');
const multer = require('multer');
const config = require('../modules/config/config-app-service');
const { isControlTheme, normalizeControlTheme } = require('../modules/config/control-theme-config');
const { USER_CONFIG_DIR } = require('../modules/config/user-config-paths');
const LogFileWriter = require('../../../framework/observability/log-file-writer');
const voiceprintStore = require('../modules/voiceprint/voiceprint-store');
// 声纹权威库变更时广播：让所有显示端重拉权威库重建本地 SpeakerEmbeddingManager
voiceprintStore.onChange(() => broadcastVoiceprintDbUpdated());

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
const {
    CONVERSATION_TIMEOUT_MS,
    createConversationState,
    reduceConversationInput
} = require('../modules/voice/display-voice-conversation');
const {
    beginRepairModeEntry,
    verifyRepairModePassword,
    handleRepairModeInput
} = require('../modules/voice/repair-mode');
const {
    createPublicRepairModeConfig,
    updateRepairModeConfig
} = require('../modules/voice/repair-mode-config');
const {
    AUTO_CONFIRMATION_WINDOW_MS,
    MANUAL_CONFIRMATION_TIMEOUT_MS,
    createPendingConversationConfirmation,
    markConversationConfirmationTtsFinished,
    normalizeConversationConfirmationMode,
    parseConversationConfirmationAction,
    resolveConversationConfirmation
} = require('../modules/voice/conversation-confirmation');
const { MediaLibraryManager } = require('../../web-mediacenter/modules/media/media-library-app-service');
const { detectMediaType, createUploadedMediaData } = require('../modules/media/upload-media-metadata');
const { SubServerManager } = require('../../../framework/cluster/sub-server-manager');
const { AascServerRegistry } = require('../../../framework/aasc/server-registry');
const {
    AascMediaIndexService,
    normalizeRemoteMediaUrl
} = require('../../../framework/aasc/media-index-service');
const {
    buildRemoteMediaProxyPath,
    createRemoteMediaLibraryHandlers,
    requestRemoteMediaLibrary
} = require('../../../framework/aasc/remote-media-library');
const { AascTaskRouter } = require('../../../framework/aasc/task-router');
const { AascNodeSession } = require('../../../framework/aasc/node-session');
const { normalizeNodeRegistration } = require('../../../framework/aasc/node-protocol');
const { AascNodeConnector } = require('../../../framework/aasc/node-connector');
const { ServerReleaseService } = require('../modules/aasc/server-release-service');
const {
    createAndroidCapabilityUnavailableError,
    getAndroidNodePolicy
} = require('../modules/runtime/android-node-capability-policy');
const { WSViewBindServer } = require('../../../core/viewbind');
const LogBuffer = require('../../../framework/observability/log-buffer');
const SystemMonitor = require('../../../framework/observability/system-monitor');
const LogBrain = require('../../../framework/observability/log-brain');
const { registerLogBrainApi } = require('../api/log-brain-api');
const TaskManager = require('../modules/task-engine/task-manager');
const { createChat2ApiGateway } = require('../modules/chat2api/chat2api-gateway');
const { registerTaskHandlers } = require('../modules/task-engine/web-socket-handler');
const AiRolesService = require('../modules/ai-roles/ai-roles-service');
const AgentBackendClient = require('../modules/ai-roles/agent-backend-client');
const { CodexRuntimeManager } = require('../modules/chat/codex-runtime-manager');
const { PiRuntimeManager } = require('../modules/chat/pi-runtime-manager');
const { createAgentTtsStream } = require('../modules/chat/agent-chat-tts');
const { createTextMediaTtsService } = require('../modules/media/text-media-tts-service');
const { normalizeTtsPauseText } = require('../modules/media/tts-text-normalizer');
const { normalizeDisplayCpuStatus, getDisplayTtsConcurrency } = require('../modules/media/display-cpu-status');
const { createOrderedTaskScheduler } = require('../modules/media/ordered-task-scheduler');
const {
    ModelManifestService,
    YOLO_MODEL_IDS
} = require('../modules/model-distribution/model-manifest-service');
const { isPunctuationOnly } = require('../../../core/utils/sentence-splitter');
const {
    registerTextMediaDisplayHandlers,
    handleTextMediaDisplayMessage,
    handleTextMediaControlMessage
} = require('../modules/media/text-media-ws-integration');
const { shouldSkipDisplayTts } = require('../modules/tts/display-tts-policy');
const registerAiRoleHandlers = require('../modules/ai-roles/ai-roles-ws-handler');
const ServerTUI = require('../../../framework/observability/server-tui');
const { installConsoleRedirect } = require('../../../framework/observability/console-redirect');

// 默认使用普通日志输出；只有显式 --tui 才启用控制台界面，--no-tui 始终优先关闭。
const useTUI = process.argv.includes('--tui') && !process.argv.includes('--no-tui');
const tui = new ServerTUI({ enabled: useTUI });

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

config.loadConfig();
const ANDROID_NODE_POLICY = getAndroidNodePolicy();

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

function sendCpuConfigToDisplay(displayId, cpuConfigMessage = null) {
    const displayData = displayClients.get(displayId);
    if (displayData && displayData.ws.readyState === WebSocket.OPEN) {
        const message = cpuConfigMessage || config.createCpuConfigMessage(config.getCpuAffinityConfig());
        displayData.ws.send(JSON.stringify(message));
    }
}

function sendCpuConfigToAllDisplays(cpuConfigMessage = null) {
    displayClients.forEach((_, displayId) => {
        sendCpuConfigToDisplay(displayId, cpuConfigMessage);
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
const serverReleaseService = new ServerReleaseService({
    projectRoot: PROJECT_ROOT,
    version: process.env.AASC_SERVER_VERSION || null
});
const RES_DIR = path.join(PROJECT_ROOT, 'res');
const modelManifestService = new ModelManifestService({
    modelRoot: path.join(RES_DIR, 'models')
});
const UPLOADS_DIR = path.join(RES_DIR, 'uploads');
const ASR_TEMP_DIR = path.join(RES_DIR, 'temp', 'asr');
const HTTP_UPLOAD_TEMP_DIR = path.join(RES_DIR, 'temp', 'uploads');
const VOICEPRINT_TEMP_DIR = path.join(RES_DIR, 'temp', 'voiceprint');

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

if (!fs.existsSync(VOICEPRINT_TEMP_DIR)) {
    fs.mkdirSync(VOICEPRINT_TEMP_DIR, { recursive: true });
}

let displayClients = new Map();
// 跨显示端 TTS 播报状态：按“播放目标 + 播放 ID”维护会话和超时，避免录音端因旧客户端不回报而永久暂停。
const voiceTtsPlaybackTimers = new Map();
const VOICE_TTS_PLAYBACK_TIMEOUT_MS = 120000;
let controlClients = new Set();
const PLAYBACK_PROGRESS_PERSIST_INTERVAL_MS = 1000;
const displayProgressPersistAt = new Map();
const displayConversationTimers = new Map();
const pendingConversationConfirmations = new Map();
const conversationConfirmationTimers = new Map();
const repairModeStates = new Map();
const repairModeTimers = new Map();
const activeRepairModeDisplays = new Set();
let repairModeTtsSuppressed = false;
const REPAIR_PASSWORD_TIMEOUT_MS = 30000;
const REPAIR_SESSION_TIMEOUT_MS = CONVERSATION_TIMEOUT_MS;
let conversationConfirmationMode = normalizeConversationConfirmationMode(
    config.get('voiceCommand.conversationConfirmationMode', 'off')
);
let serverStartTime = Date.now();
let muteState = {
    isMuted: false,
    previousVolumes: new Map()
};

let wsServer = null;
let taskManager = null;
let aascNodeConnector = null;
// AI 角色面板：服务器只持有共享 IPC 客户端，实际 Claude/Codex Agent 由独立后端宿主进程管理。
// 声明在模块级——handleControlMessageFallback 在模块作用域引用 aiRoles，若只声明在 server.listen 回调里会出作用域。
const aiRoles = new AiRolesService({
    projectRoot: PROJECT_ROOT,
    // 全局设置只作为新建/重建角色的默认后端；AiRolesService 内存中的 bridge 不会因设置变化被替换。
    getAgentBackend: () => chat.getConfig().agentBackend || 'codex',
    // 工作 Agent 与普通聊天 Codex 共用 chat.codexProxy；已运行 bridge 不在运行中切换代理。
    getCodexProxy: () => config.get('chat.codexProxy', 'http://127.0.0.1:7899'),
    // Agent 的实际进程和 stdio 由独立后端宿主持有，服务器只保留 Unix Socket 客户端。
    agentBackendClient: new AgentBackendClient()
});
// 普通聊天的 Pi Agent 由服务器直接持有，和 AI 角色面板使用的后端宿主进程隔离。
const piRuntimeManager = new PiRuntimeManager({
    projectRoot: PROJECT_ROOT,
    // 普通聊天、任务和 Pi Agent 共用内置 Chat2API Responses 入口，避免 Pi 继续读取旧 profile 地址。
    responsesBaseUrl: config.get('chat.responsesBaseUrl', 'http://127.0.0.1:8083/v1')
});
const codexRuntimeManager = new CodexRuntimeManager({
    projectRoot: PROJECT_ROOT,
    proxy: config.get('chat.codexProxy', 'http://127.0.0.1:7899')
});
const runtimeBridgeClients = new Map();
const pendingDisplayAsrRequests = new Map();
let pendingAsrRequestId = 0;
// 视觉请求只在服务端排队并转发，实际模型推理由显示端 NativeDisplay 完成。
const pendingDisplayVisionRequests = new Map();
let pendingVisionRequestId = 0;
const VISION_REQUEST_TIMEOUT_MS = 120000;

if (!ANDROID_NODE_POLICY.enabled) {
    tts.init(config.getTtsConfig());
}
if (!ANDROID_NODE_POLICY.enabled && config.get('asr.serverEnabled', true) === true) {
    asr.init(config.get('asr', {}));
}
chat.init(config.get('chat', {}), { piRuntimeManager, codexRuntimeManager });
// 提醒必须复用统一 TTS 路由，确保 display 模式优先使用显示端并按策略回退。
reminder.init({ generateTTS: generateTtsWithFallback });
voiceCommand.init(config.get('voiceCommand', {}));
// 文本分页播放单独逐句合成，不能复用通用 TTS 的整段队列，避免播放定位标签丢失。
const textMediaTtsService = createTextMediaTtsService({
    generateTTS: (text) => generateTtsWithFallback(text),
    sendToDisplay,
    logError,
    getDisplayCapabilities,
    getDisplayTtsConcurrency: (displayId) => getDisplayTtsConcurrency(
        displayClients.get(displayId)?.state?.cpuStatus
    ),
    // 文本 TTS 每个实际句子都要重新扫描全部可用语音设备，不能复用媒体开始时的选中列表。
    getVoicePlaybackDisplayIds: () => getOnlineVoicePlaybackDisplayIds()
});
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

function normalizeAsrText(text) {
    return String(text || '').trim();
}

const mediaLibraryManager = new MediaLibraryManager({
    configPath: path.join(USER_CONFIG_DIR, 'media-libraries.json'),
    getPort: () => PORT,
    getLocalIP: getLocalIP,
    isHttps: () => useHttps
});

// 动态添加媒体库时只注册一次静态路由，避免子服务器被主控端重复配置后
// 在 Express 中不断叠加相同的路由处理器。
const registeredMediaRoutePrefixes = new Set();

function registerLocalMediaLibraryRoute(libraryId) {
    const library = mediaLibraryManager.getLibrary(libraryId);
    if (!library || !library.provider
        || typeof library.provider.getRoutePrefix !== 'function'
        || typeof library.provider.getBasePath !== 'function'
        || library.provider.isUploadsDir) {
        return false;
    }

    const routePrefix = library.provider.getRoutePrefix();
    if (registeredMediaRoutePrefixes.has(routePrefix)) {
        return true;
    }

    app.use(routePrefix, staticWithMhtmlMime(library.provider.getBasePath()));
    registeredMediaRoutePrefixes.add(routePrefix);
    log('媒体库', `动态添加静态路由: ${routePrefix} -> ${library.provider.getBasePath()}`);
    return true;
}

const aascRemoteMediaLibraryHandlers = createRemoteMediaLibraryHandlers({
    mediaLibraryManager,
    registerLocalRoutes: library => registerLocalMediaLibraryRoute(library?.id || library?.config?.id),
    buildPlaylist: payload => playlistManager.buildFromLibrary(payload.id, payload.path || '/', {
        recursive: payload.recursive,
        mode: payload.mode,
        sortBy: payload.sortBy,
        direction: payload.direction,
        mediaTypes: payload.mediaTypes
    })
});

const { PlaylistManager } = require('../../web-mediacenter/modules/media/playlist-app-service');
const playlistManager = new PlaylistManager(mediaLibraryManager);

const subServerManager = new SubServerManager();
const AASC_MAIN_NODE_ID = 'main-server';
const AASC_HEARTBEAT_TIMEOUT_MS = 90000;
const AASC_ROLE = ['main', 'subserver'].includes(config.get('aasc.role', 'main'))
    ? config.get('aasc.role', 'main')
    : 'main';
const aascServerRegistry = new AascServerRegistry({
    heartbeatTimeoutMs: AASC_HEARTBEAT_TIMEOUT_MS
});
const aascMediaIndexService = new AascMediaIndexService({
    mediaLibraryManager,
    getNode: () => ({
        nodeId: AASC_ROLE === 'subserver' ? ensureAascNodeId() : AASC_MAIN_NODE_ID,
        name: AASC_ROLE === 'subserver'
            ? (config.get('aasc.nodeName', '') || '子服务器')
            : '主服务器',
        url: `${useHttps ? 'https' : 'http'}://${getLocalIP()}:${PORT}`
    }),
    getRemoteNodes: () => aascServerRegistry.getAll(),
    requestRemoteIndex: (node, requestedPath, timeoutMs) => aascServerRegistry.request(
        node.nodeId,
        'media.index.local',
        { path: requestedPath },
        timeoutMs
    ),
    getRemoteMediaProxyUrl: (node, libraryId, filePath) => {
        const origin = `${useHttps ? 'https' : 'http'}://${getLocalIP()}:${PORT}`;
        return `${origin}${buildRemoteMediaProxyPath(node.nodeId, libraryId, filePath)}`;
    }
});
const aascTaskRouter = new AascTaskRouter({
    getDisplays: () => Array.from(displayClients.entries()).map(([id, data]) => ({
        id,
        online: data.ws?.readyState === WebSocket.OPEN,
        capabilities: data.state?.capabilities || DEFAULT_CAPABILITIES
    })),
    getCurrentServer: () => ({ nodeId: AASC_MAIN_NODE_ID })
});

const subServerConfig = config.get('subServers');
if (AASC_ROLE === 'main' && subServerConfig) {
    subServerManager.loadFromConfig(subServerConfig);
    subServerManager.startHealthCheck();
}

function getSubServerCapabilities() {
    if (ANDROID_NODE_POLICY.enabled) {
        return { ...ANDROID_NODE_POLICY.capabilities };
    }
    return {
        mediaLibrary: true,
        displayGateway: true,
        taskRuntime: true,
        hotUpdate: true
    };
}

function getAascServerSnapshots() {
    // 主服务器本身属于当前进程，读取目录时刷新它的心跳，避免主服务在
    // 长时间没有外部请求心跳时被误判为离线。旧 SubServerManager 配置不再
    // 注入 AASC 节点目录，避免主服务器继续主动访问子服务器地址。
    if (AASC_ROLE === 'main') {
        aascServerRegistry.heartbeat(AASC_MAIN_NODE_ID, { runtime: getAascRuntime() });
    }
    return aascServerRegistry.getAll();
}

function getAascRuntime() {
    return {
        displayCount: displayClients.size,
        controlCount: controlClients.size,
        libraryCount: mediaLibraryManager.listLibraries().length
    };
}

function registerMainAascServer(localIP, protocol) {
    return aascServerRegistry.register({
        nodeId: AASC_MAIN_NODE_ID,
        name: '主服务器',
        url: `${protocol}://${localIP}:${PORT}`,
        version: process.env.AASC_SERVER_VERSION || 'unknown',
        capabilities: {
            nodeRegistry: true,
            mediaLibrary: true,
            displayGateway: true
        },
        metadata: {
            role: 'main-server',
            protocol,
            platform: process.platform,
            arch: process.arch
        },
        runtime: getAascRuntime()
    });
}

function ensureAascNodeId() {
    const configuredNodeId = String(config.get('aasc.nodeId', '') || '').trim();
    if (configuredNodeId) {
        return configuredNodeId.slice(0, 128);
    }

    const nodeId = `subserver-${generateId()}`;
    config.set('aasc.nodeId', nodeId);
    return nodeId;
}

/**
 * 子服务器收到主服务器请求后的白名单处理器。
 *
 * 媒体索引直接在本地生成；更新和重启只返回“已接受”，实际动作交给一次性
 * Bootstrap 或当前服务的双进程启动器，避免 WebSocket 会话进程承担生命周期管理。
 */
async function handleSubServerNodeRequest(request) {
    const handlers = new Map([
        ...aascRemoteMediaLibraryHandlers,
        ['media.index.local', async payload => aascMediaIndexService.buildLocalIndex(payload.path || '/')],
        ['task.execute', async payload => executeSubServerTask(payload)],
        ['server.update', async payload => spawnSubServerBootstrap('update', payload)],
        ['server.restart', async () => requestSubServerRestart()]
    ]);
    const handler = handlers.get(request.type);
    if (!handler) {
        throw new Error(`不支持的子服务器请求: ${request.type}`);
    }
    return handler(request.payload || {});
}

async function executeSubServerTask(payload = {}) {
    if (ANDROID_NODE_POLICY.enabled) {
        throw createAndroidCapabilityUnavailableError('taskRuntime');
    }
    if (!taskManager) {
        throw new Error('子服务器任务引擎尚未初始化');
    }
    const submitted = await taskManager.submit({
        ...payload,
        target: 'server',
        routing: 'server'
    });
    return taskManager.runInstance(submitted.taskName, submitted.instanceId);
}

function spawnSubServerBootstrap(command, options = {}) {
    const bootstrapPath = path.join(PROJECT_ROOT, 'scripts/termux/aasc-server-bootstrap.cjs');
    const mainServerUrl = config.get('aasc.mainServerUrl', 'https://192.168.1.39:8081');
    const bootstrapArguments = [
        bootstrapPath,
        command,
        '--server-url',
        mainServerUrl,
        '--project-root',
        PROJECT_ROOT
    ];
    if (options.force === true) {
        bootstrapArguments.push('--force');
    }
    const child = spawn(process.execPath, bootstrapArguments, {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
    const action = command === 'update'
        ? (options.force === true ? '强制更新' : '更新')
        : '重启';
    log('AASC', `已接受子服务器${action}请求，Bootstrap PID: ${child.pid}`);
    const result = { accepted: true, command, pid: child.pid || null };
    if (options.force === true) {
        result.force = true;
    }
    return result;
}

function requestSubServerRestart() {
    setTimeout(() => {
        if (typeof process.send === 'function') {
            try {
                process.send({ type: 'restartRequested' });
                return;
            } catch (error) {
                logError('AASC', `通知启动器重启子服务器失败: ${error.message}`);
            }
        }
        process.kill(process.pid, 'SIGTERM');
    }, 100);
    return { accepted: true, command: 'server.restart' };
}

async function updateAllAascSubservers(options = {}) {
    const force = options.force === true;
    const updatePayload = force ? { force: true } : {};
    const candidates = aascServerRegistry.getAll().filter(server => (
        server.nodeId !== AASC_MAIN_NODE_ID
        && server.status === 'online'
        && server.connected === true
        && aascServerRegistry.getConnection(server.nodeId)
    ));
    if (candidates.length > 0) {
        await serverReleaseService.getManifest();
    }
    const results = await Promise.all(candidates.map(async server => {
        try {
            const response = await aascServerRegistry.request(server.nodeId, 'server.update', updatePayload);
            const accepted = response?.accepted !== false;
            return {
                nodeId: server.nodeId,
                name: server.name,
                status: accepted ? 'accepted' : 'rejected',
                accepted,
                message: response?.message || (accepted ? '更新已下发' : '子服务器未接受更新'),
                response: response || {}
            };
        } catch (error) {
            return {
                nodeId: server.nodeId,
                name: server.name,
                status: 'failed',
                accepted: false,
                message: error.message
            };
        }
    }));
    const accepted = results.filter(result => result.accepted).length;
    const summary = {
        total: results.length,
        accepted,
        failed: results.length - accepted,
        results
    };
    if (force) {
        summary.forced = true;
    }
    return summary;
}

function startAascNodeConnector(localIP, protocol) {
    if (AASC_ROLE !== 'subserver') {
        return null;
    }

    const connector = new AascNodeConnector({
        mainServerUrl: config.get('aasc.mainServerUrl', 'https://192.168.1.39:8081'),
        nodeId: ensureAascNodeId(),
        nodeName: config.get('aasc.nodeName', '') || `子服务器-${localIP}`,
        advertisedUrl: config.get('aasc.advertisedUrl', '') || `${protocol}://${localIP}:${PORT}`,
        version: process.env.AASC_SERVER_VERSION || 'unknown',
        capabilities: {
            ...getSubServerCapabilities()
        },
        metadata: {
            role: 'subserver',
            platform: process.platform,
            arch: process.arch
        },
        heartbeatIntervalMs: config.get('aasc.heartbeatIntervalMs', 30000),
        reconnectMinMs: config.get('aasc.reconnectMinMs', 1000),
        reconnectMaxMs: config.get('aasc.reconnectMaxMs', 30000),
        onRequest: handleSubServerNodeRequest,
        getRuntime: getAascRuntime,
        onStateChange: state => log('AASC', `子服务器主连接状态: ${state.state}`),
        onError: error => logError('AASC', `子服务器主连接失败: ${error.message}`)
    });
    connector.start();
    log('AASC', `子服务器主动连接主服务器: ${config.get('aasc.mainServerUrl', 'https://192.168.1.39:8081')}/server`);
    return connector;
}

mediaLibraryManager.init().then(() => {
    log('媒体库', '媒体库初始化完成');
    
    const localRoutes = mediaLibraryManager.getLocalLibraryRoutes();
    localRoutes.forEach(route => {
        registerLocalMediaLibraryRoute(route.id);
    });
    
    startServer();
}).catch(err => {
    logError('媒体库', `初始化失败: ${err.message}`);
    startServer();
});

async function startServer() {
    // 服务端自重启：新进程延迟监听，避免与旧进程端口冲突（AASC_RELOAD_DELAY 毫秒）
    const reloadDelay = parseInt(process.env.AASC_RELOAD_DELAY || '0', 10);
    if (reloadDelay > 0) {
        await new Promise(r => setTimeout(r, reloadDelay));
    }

    const localIP = getLocalIP();
    const protocol = useHttps ? 'https' : 'http';

    updateVoiceDisplayConfig(localIP, PORT, protocol);

    // 先恢复独立 Agent 后端，再开始监听控制端，避免首个 roleList 请求看到短暂的离线状态。
    await aiRoles.restoreAll();

    server.listen(PORT, '0.0.0.0', async () => {
        if (AASC_ROLE === 'main') {
            registerMainAascServer(localIP, protocol);
        }
        log('系统', '媒体中心服务器已启动');
        log('系统', `控制端地址: ${protocol}://${localIP}:${PORT}/control`);
        log('系统', `显示端地址: ${protocol}://${localIP}:${PORT}/display`);
        if (useHttps) {
            log('系统', 'HTTPS 已启用，支持麦克风等安全特性');
        } else {
            log('系统', 'HTTP 模式，麦克风功能需要 HTTPS 或 localhost');
        }

        // 启动器通过 serverReady 重置异常重启计数，避免一次成功启动后继承旧的崩溃次数。
        if (typeof process.send === 'function') {
            try {
                process.send({ type: 'serverReady' });
            } catch (error) {
                logError('系统', `通知启动器服务器已就绪失败: ${error.message}`);
            }
        }

        tui.setHeader(protocol, localIP, PORT);

        timeListener.start();
        reminder.start(displayClients, sendToDisplay);
        voiceCommand.setClients(displayClients, sendToDisplay, broadcastToControls);
        voiceCommand.setTtsRouter({
            speak: async ({ displayId, text, action, extra }) => {
                const audioPath = await generateTtsWithFallback(text, undefined, undefined, displayId);
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action,
                    text,
                    audioUrl: `/uploads/tts/${path.basename(audioPath)}`,
                    ...extra
                });
                return true;
            }
        });
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
                    if (taskManager) {
                        taskManager.handleDisplayDisconnect(displayId);
                    }
                },
                onControlConnect: (ws) => {
                    log('WS', '控制端连接');
                },
                onControlDisconnect: (ws) => {
                    log('WS', '控制端断开');
                }
            });

            // 注册显示端消息 handler // 委托给现有的 handleDisplayMessageFallback
            registerTextMediaDisplayHandlers({
                wsServer,
                displayTypes: ['canvasSize', 'browserInfo', 'voiceInput', 'voiceStatus', 'voiceConversationTtsFinished', 'voiceTtsPlaybackFinished', 'mediaNameTts', 'voiceVadNoiseResult', 'capabilities', 'cpuStatus', 'commandAck', 'videoProgress', 'audioProgress', 'playlistProgress', 'tempMediaInfo', 'htmlProgress', 'controlScreenshot', 'sleepStateReport', 'playStateReport', 'textProgress'],
                handleDisplayMessage: handleDisplayMessageFallback
            }, textMediaTtsService);

            // audioChunk handler：显示端→服务端的音频流识别 // 分片累积后调 asr.recognize
            const audioChunkSessions = new Map();
            wsServer.registerHandler('audioChunk', async (data, ctx) => {
                const { requestId, chunk, isLast, sampleRate } = data;
                if (!requestId || !chunk) return;
                if (!isServerAsrEnabled()) {
                    log('语音', '服务器 ASR 已关闭，忽略音频流请求');
                    return;
                }

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
                            if (!config.get('voiceprint.enabled', true) && voiceTtsPlaybackTimers.size > 0) {
                                return;
                            }
                            const passwordInput = isRepairModePasswordInput(ctx.displayId);
                            if (!passwordInput) {
                                broadcastToControls({
                                    type: 'voiceInput',
                                    text,
                                    displayId: ctx.displayId,
                                    isFinal: true
                                });
                            }
                            if (await handleRepairModeDisplayInput(ctx.displayId, text)) return;
                            const conversation = handleDisplayConversationInput(ctx.displayId, text);
                            const conversationActive = ['activeGroup', 'activePrivate'].includes(conversation.state?.state);
                            const oneShotGroup = conversation.event?.oneShotGroup === true;
                            log('语音', `voiceCommand门控 displayId=${ctx.displayId} state=${conversation.state?.state || 'unknown'} accepted=${conversation.accepted} event=${conversation.event?.type || 'none'} conversationActive=${conversationActive} oneShotGroup=${oneShotGroup} text=${JSON.stringify(text)}`);
                            if (conversation.accepted && conversation.event?.type === 'input') {
                                handleControlMessageFallback({
                                    type: 'voiceCommand',
                                    text,
                                    displayId: ctx.displayId,
                                    conversationActive,
                                    oneShotGroup
                                }, ctx.ws);
                            }
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
                'getCommandRouting', 'updateCommandRouting', 'getBuiltinVoiceCommands',
                'getConversationConfirmationConfig', 'setConversationConfirmationConfig',
                'setVoiceVad', 'detectVoiceNoise',
                'playlistRequest', 'playlistControl'
            ];
            for (const type of controlTypes) {
                wsServer.registerHandler(type, async (data, ctx) => {
                    await handleControlMessageFallback(data, ctx.ws);
                });
            }

            // 角色管理消息单独注册，避免通用控制消息回退分支缺失时静默丢弃。
            registerAiRoleHandlers(wsServer, { aiRoles, broadcastToControls });

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
            taskManager = new TaskManager({
                maxInstances: 50,
                chatService: chat,
                serverExecutionDisabled: ANDROID_NODE_POLICY.enabled,
                serverExecutionError: 'Android APK 节点不支持服务端任务执行',
                resolveTaskRoute: (task) => aascTaskRouter.resolve(task),
                // tts.server 只切换通用 HTTP 客户端的运行时地址，不改变服务器 TTS 开关。
                getTtsServiceUrl: () => tts.getConfig().serviceUrl,
                setTtsServiceUrl: (serviceUrl) => tts.init({ serviceUrl })
            });
            taskManager.setGenerateTts((text, voice, speed) => generateTtsWithFallback(text, voice, speed));
            registerTaskHandlers(wsServer, taskManager,
                (msg) => broadcastToControls(msg),
                (displayId, msg) => sendToDisplay(displayId, msg)
            );
            taskManager.setSendToDisplay((displayId, msg) => sendToDisplay(displayId, msg));
            taskManager.setBroadcastToDisplays((msg, options) => {
              for (const [id] of displayClients) sendToDisplay(id, msg, options);
            });
            await taskManager.init();
            log('任务引擎', '远程任务系统已初始化');

            // 语音搜索复用任务引擎的单次内置任务；搜索任务只返回结果，播报、频道和历史仍由语音层处理。
            voiceCommand.setSearchRunner(async (query) => {
                const taskResponse = await taskManager.runBuiltinOnce('search.web', { query });
                return taskResponse?.data || taskResponse;
            });
            await taskManager.restoreAutoStartServices();

            // 注入报时任务控制函数（供语音命令"开启报时/关闭报时"使用）
            voiceCommand.setTimeAnnounceToggle(async (enabled) => {
                try {
                    const tasks = await taskManager.listTasks();
                    const announce = tasks.find(t => t.taskName === 'time.announce');
                    if (announce && announce.instances && announce.instances.length > 0) {
                        const inst = announce.instances[0];
                        await taskManager.handleWidgetAction(inst.instanceId, 'updateConfig', { enabled });
                        log('报时', (enabled ? '开启' : '关闭') + '报时（语音指令）');
                    }
                } catch (err) {
                    console.error('[语音命令] 控制报时任务失败:', err.message);
                }
            });

            aascNodeConnector = startAascNodeConnector(localIP, protocol);
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
    displayText: true,
    ttsGeneration: false
};

// 浏览器显示端的 VAD 阈值按设备保存；不同麦克风和摆放环境的底噪不能共用一个动态值。
const DEFAULT_VAD_THRESHOLD = 0.01;
const MIN_VAD_THRESHOLD = 0.001;
const MAX_VAD_THRESHOLD = 0.2;

function normalizeVadThreshold(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_VAD_THRESHOLD;
    return Math.round(Math.min(MAX_VAD_THRESHOLD, Math.max(MIN_VAD_THRESHOLD, number)) * 1000000) / 1000000;
}

const SUB_DISPLAY_CAPABILITIES = {
    mediaRendering: false,
    voicePlayback: true,
    voiceRecording: true,
    voiceRecognition: true,
    displayText: false,
    ttsGeneration: false
};

// 用户能力覆盖只影响对应显示端；voiceRecognition 也允许控制端明确开启/关闭，
// 服务器仍按 displayClients 的插入顺序选择第一个可用 ASR 提供端。
function normalizeDisplayUserCapabilities(capabilities) {
    return { ...(capabilities || {}) };
}

const DEFAULT_DYNAMIC_FIT_CONFIG = Object.freeze({
    transitionSeconds: 3,
    holdSeconds: 2
});

function normalizeDynamicFitConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalizeSeconds = (candidate, fallback) => {
        const number = Number(candidate);
        if (!Number.isFinite(number) || number <= 0) return fallback;
        return Math.round(Math.min(number, 300) * 10) / 10;
    };
    return {
        transitionSeconds: normalizeSeconds(source.transitionSeconds, DEFAULT_DYNAMIC_FIT_CONFIG.transitionSeconds),
        holdSeconds: normalizeSeconds(source.holdSeconds, DEFAULT_DYNAMIC_FIT_CONFIG.holdSeconds)
    };
}

function createDisplayState() {
    return {
        currentMedia: null,
        currentMediaProgress: null,
        currentHtmlScroll: null,
        rotation: 0,
        fit: 'contain',
        dynamicFitConfig: { ...DEFAULT_DYNAMIC_FIT_CONFIG },
        crop: { x: 0, y: 0, width: 100, height: 100 },
        volume: 100,
        isPlaying: false,
        // 仅保存可恢复的文本播放样式与进度，不保存临时播放列表中的 base64 文本内容。
        textStyle: null,
        currentTextProgress: null,
        canvasSize: { width: 1920, height: 1080 },
        browserInfo: null,
        capabilities: null,
        cpuStatus: null,
        vadThreshold: DEFAULT_VAD_THRESHOLD,
        voiceConversation: createConversationState(true)
    };
}

function getDisplayVoiceAssistantNames() {
    const assistantConfig = voiceCommand.getAssistantConfig();
    const templateNames = chat.getTemplates()
        .map(template => template?.name)
        .filter(Boolean);
    return [
        assistantConfig.defaultName,
        ...(Array.isArray(assistantConfig.assistants)
            ? assistantConfig.assistants.map(assistant => assistant.name)
            : []),
        ...templateNames
    ].filter(Boolean);
}

function isDisplayVoiceListeningEnabled(displayData) {
    const capabilities = displayData?.state?.capabilities || DEFAULT_CAPABILITIES;
    return capabilities.voiceRecording === true;
}

function clearDisplayConversationTimer(displayId) {
    const timer = displayConversationTimers.get(displayId);
    if (timer) {
        clearTimeout(timer);
        displayConversationTimers.delete(displayId);
    }
}

function getRepairModeConfig() {
    const repairConfig = config.get('repairMode', {});
    return {
        password: typeof repairConfig?.password === 'string' ? repairConfig.password : '',
        role: typeof repairConfig?.role === 'string' ? repairConfig.role.trim() : ''
    };
}

function clearRepairModeTimer(displayId) {
    const timer = repairModeTimers.get(displayId);
    if (!timer) return;
    clearTimeout(timer);
    repairModeTimers.delete(displayId);
}

function isRepairModeTtsSuppressed() {
    return repairModeTtsSuppressed;
}

function scheduleRepairModeTimer(displayId, expiresAt) {
    clearRepairModeTimer(displayId);
    const delay = Math.max(0, expiresAt - Date.now());
    const timer = setTimeout(() => {
        const state = repairModeStates.get(displayId);
        if (!state || state.expiresAt !== expiresAt) return;
        const wasActive = state.state === 'active';
        repairModeStates.delete(displayId);
        repairModeTimers.delete(displayId);
        if (wasActive) {
            activeRepairModeDisplays.delete(displayId);
            if (activeRepairModeDisplays.size === 0) repairModeTtsSuppressed = false;
        }
        sendRepairModeResponse(displayId, wasActive ? '修复模式已超时退出' : '修复模式密码输入已超时');
    }, delay);
    repairModeTimers.set(displayId, timer);
}

function activateRepairMode(displayId) {
    clearPendingConversationConfirmation(displayId, 'repairMode');
    for (const key of [...voiceTtsPlaybackTimers.keys()]) {
        const separatorIndex = key.indexOf(':');
        if (separatorIndex < 0) continue;
        finishVoiceTtsPlayback(key.slice(0, separatorIndex), key.slice(separatorIndex + 1), 'repairMode');
    }
    activeRepairModeDisplays.add(displayId);
    if (repairModeTtsSuppressed) return;
    repairModeTtsSuppressed = true;
    sendToDisplaysWithCapability('voicePlayback', {
        type: 'tts',
        action: 'stop'
    });
}

function clearRepairMode(displayId, reason = 'cleared') {
    clearRepairModeTimer(displayId);
    const state = repairModeStates.get(displayId);
    repairModeStates.delete(displayId);
    if (state?.state === 'active') activeRepairModeDisplays.delete(displayId);
    if (activeRepairModeDisplays.size === 0) repairModeTtsSuppressed = false;
    return state ? { ...state, reason } : null;
}

async function sendRepairModeResponse(displayId, text) {
    if (!displayId || !text) return;
    sendToDisplay(displayId, {
        type: 'voiceCommand',
        action: 'response',
        text
    });
    try {
        await sendVoiceInputTts(text, { allowRepairModeTts: true });
    } catch (error) {
        logError('修复模式', `响应 TTS 失败: ${error.message}`);
    }
}

function isRepairModePasswordInput(displayId) {
    return repairModeStates.get(displayId)?.state === 'awaitingPassword';
}

function beginRepairMode(displayId) {
    const repairConfig = getRepairModeConfig();
    const result = beginRepairModeEntry(repairModeStates.get(displayId), {
        passwordConfigured: repairConfig.password.length > 0,
        role: repairConfig.role,
        now: Date.now(),
        passwordTimeoutMs: REPAIR_PASSWORD_TIMEOUT_MS
    });
    repairModeStates.set(displayId, result.state);
    if (result.event.type === 'passwordUnavailable') {
        void sendRepairModeResponse(displayId, '修复模式未配置密码');
        return result;
    }
    scheduleRepairModeTimer(displayId, result.state.expiresAt);
    void sendRepairModeResponse(displayId, '请输入修复模式密码');
    return result;
}

function scheduleActiveRepairMode(displayId, state) {
    if (state?.state === 'active' && Number.isFinite(state.expiresAt)) {
        scheduleRepairModeTimer(displayId, state.expiresAt);
    }
}

async function runRepairModeAgent(displayId, state, text) {
    const role = state.role || getRepairModeConfig().role;
    if (!role || !aiRoles.list().some(item => item.name === role)) {
        await sendRepairModeResponse(displayId, '修复模式工作角色不存在，请检查配置');
        return;
    }

    const agentTtsStream = createAgentTtsStream({
        playOnControl: false,
        // 来源显示端只负责接收文字响应；音频沿用通用语音播放目标，避免播到无扬声器的来源端。
        displayId: null,
        displayIds: [],
        getDisplayIds: getOnlineVoicePlaybackDisplayIds,
        ttsScheduler: createTtsGenerationScheduler(),
        splitIntoSentences: chat.splitIntoSentences,
        stripMarkdown,
        generateTTS: (ttsText) => generateTtsWithFallback(ttsText),
        sendToControl: broadcastToControls,
        sendToDisplay,
        allowRepairModeTts: true,
        isTtsSuppressed: isRepairModeTtsSuppressed,
        onError: (error) => logError('修复模式', `工作 Agent TTS 失败: ${error.message}`)
    });

    try {
        await aiRoles.chat(role, text, {
            onStatus: () => broadcastToControls({ type: 'roleList', roles: aiRoles.list() }),
            onChunk: (chunk, message, requestId) => {
                broadcastToControls({ type: 'chatChunk', requestId: requestId || null, chunk, message });
                agentTtsStream.onChunk(chunk);
            },
            onComplete: (message, history, requestId) => {
                broadcastToControls({ type: 'chatResponse', requestId: requestId || null, success: true, message, history });
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'response',
                    text: message,
                    detailText: message
                });
                void agentTtsStream.onComplete(message);
            },
            onError: (error) => {
                const message = error instanceof Error ? error.message : String(error);
                broadcastToControls({ type: 'chatResponse', success: false, error: message });
                void sendRepairModeResponse(displayId, `修复 Agent 处理失败：${message}`);
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError('修复模式', `工作 Agent 调用失败: ${message}`);
        await sendRepairModeResponse(displayId, `修复 Agent 处理失败：${message}`);
    }
}

async function handleRepairModeDisplayInput(displayId, text) {
    const currentState = repairModeStates.get(displayId);
    if (!currentState) return false;

    if (currentState.state === 'awaitingPassword') {
        clearRepairModeTimer(displayId);
        const repairConfig = getRepairModeConfig();
        const result = verifyRepairModePassword(currentState, text, repairConfig.password, {
            roleAvailable: Boolean(repairConfig.role) && aiRoles.list().some(item => item.name === repairConfig.role),
            now: Date.now(),
            sessionTimeoutMs: REPAIR_SESSION_TIMEOUT_MS
        });
        if (result.event.type === 'entered') {
            repairModeStates.set(displayId, result.state);
            activateRepairMode(displayId);
            scheduleActiveRepairMode(displayId, result.state);
            await sendRepairModeResponse(displayId, '密码正确，已进入修复模式。所有操作需要确认。');
        } else {
            repairModeStates.delete(displayId);
            if (result.event.type === 'roleUnavailable') {
                await sendRepairModeResponse(displayId, '修复模式工作角色不存在，请检查配置');
            } else {
                await sendRepairModeResponse(displayId, '修复模式密码错误');
            }
        }
        return true;
    }

    if (currentState.state !== 'active') return false;
    const result = handleRepairModeInput(currentState, text, Date.now());
    if (!result.event) return true;
    if (result.event.type === 'exited') {
        clearRepairMode(displayId, 'voiceExit');
        await sendRepairModeResponse(displayId, '已退出修复模式');
        return true;
    }

    const nextState = {
        ...result.state,
        expiresAt: Date.now() + REPAIR_SESSION_TIMEOUT_MS
    };
    repairModeStates.set(displayId, nextState);
    scheduleActiveRepairMode(displayId, nextState);
    if (result.event.type === 'confirmed') {
        await runRepairModeAgent(displayId, nextState, result.event.text);
    } else if (result.event.type === 'cancelled') {
        await sendRepairModeResponse(displayId, '好的，已取消修复请求');
    } else if (result.event.type === 'confirmationRequired') {
        await sendRepairModeResponse(displayId, result.event.repeat
            ? '请只说确认或取消'
            : `你要执行的是：“${result.event.text}”。请说确认或取消。`);
    }
    return true;
}

function sendDisplayConversationState(displayId, reason) {
    const displayData = displayClients.get(displayId);
    if (!displayData) return;
    const conversation = displayData.state.voiceConversation || createConversationState(true);
    sendToDisplay(displayId, {
        type: 'voiceConversationState',
        state: conversation.state,
        target: conversation.target,
        expiresAt: Number.isFinite(conversation.expiresAt) ? conversation.expiresAt : null,
        reason: reason || null
    });
}

function setDisplayConversationState(displayId, conversation, reason) {
    const displayData = displayClients.get(displayId);
    if (!displayData) return;
    displayData.state.voiceConversation = conversation;
    sendDisplayConversationState(displayId, reason);
    broadcastToControls({
        type: 'voiceConversationState',
        displayId,
        state: conversation.state,
        target: conversation.target,
        reason: reason || null
    });
}

function armDisplayConversationTimer(displayId) {
    clearDisplayConversationTimer(displayId);
    const displayData = displayClients.get(displayId);
    const current = displayData?.state?.voiceConversation;
    if (!displayData || !['activeGroup', 'activePrivate'].includes(current?.state)) return;

    // 服务端是会话到期时间的唯一来源；显示端据此展示倒计时，避免本地计时与实际退出时刻漂移。
    const expiresAt = Date.now() + CONVERSATION_TIMEOUT_MS;
    setDisplayConversationState(displayId, { ...current, expiresAt }, 'conversationTimerStarted');
    const timer = setTimeout(() => {
        const displayData = displayClients.get(displayId);
        if (!displayData || !isDisplayVoiceListeningEnabled(displayData)) return;
        const conversation = displayData.state.voiceConversation;
        if (!['activeGroup', 'activePrivate'].includes(conversation?.state)) return;
        setDisplayConversationState(displayId, createConversationState(true), 'timeout');
        log('语音', `显示端 ${displayId} 3分钟无有效对话，等待重新唤醒`);
    }, CONVERSATION_TIMEOUT_MS);
    displayConversationTimers.set(displayId, timer);
}

function syncDisplayConversationListeningState(displayId, reason) {
    const displayData = displayClients.get(displayId);
    if (!displayData) return;
    if (!isDisplayVoiceListeningEnabled(displayData)) {
        clearDisplayConversationTimer(displayId);
        clearPendingConversationConfirmation(displayId, 'listeningDisabled');
        clearRepairMode(displayId, 'listeningDisabled');
        setDisplayConversationState(displayId, createConversationState(false), reason || 'listeningDisabled');
        return;
    }
    const current = displayData.state.voiceConversation;
    if (!current || current.state === 'disabled') {
        setDisplayConversationState(displayId, createConversationState(true), reason || 'listeningEnabled');
    }
}

function sendConversationPrompt(displayId, text) {
    if (!displayId || !text) return;
    (async () => {
        try {
            await sendVoiceInputTts(text);
            // 唤醒状态提示仍只在触发显示端展示文字，不再携带会导致该端独占播放的 audioUrl。
            sendToDisplay(displayId, {
                type: 'voiceCommand',
                action: 'response',
                text
            });
        } catch (error) {
            logError('语音', `唤醒提示 TTS 失败: ${error.message}`);
        }
    })();
}

function getConversationConfirmationConfig() {
    return {
        mode: conversationConfirmationMode,
        manualTimeoutMs: MANUAL_CONFIRMATION_TIMEOUT_MS,
        autoCancelWindowMs: AUTO_CONFIRMATION_WINDOW_MS
    };
}

function setConversationConfirmationMode(mode, source = 'control') {
    conversationConfirmationMode = normalizeConversationConfirmationMode(mode);
    voiceCommand.setConversationConfirmationMode(conversationConfirmationMode);
    if (conversationConfirmationMode === 'off') {
        for (const displayId of pendingConversationConfirmations.keys()) {
            clearPendingConversationConfirmation(displayId, 'modeDisabled');
        }
    }
    config.set('voiceCommand.conversationConfirmationMode', conversationConfirmationMode);
    broadcastToControls({
        type: 'conversationConfirmationConfig',
        ...getConversationConfirmationConfig(),
        source
    });
    log('语音', `全局对话确认模式已${conversationConfirmationMode === 'off' ? '关闭' : '设置为' + conversationConfirmationMode}`);
    return conversationConfirmationMode;
}

function clearConversationConfirmationTimer(displayId) {
    const timer = conversationConfirmationTimers.get(displayId);
    if (timer) {
        clearTimeout(timer);
        conversationConfirmationTimers.delete(displayId);
    }
}

function clearPendingConversationConfirmation(displayId, reason = 'cleared') {
    clearConversationConfirmationTimer(displayId);
    const record = pendingConversationConfirmations.get(displayId);
    if (!record) return null;
    pendingConversationConfirmations.delete(displayId);
    sendToDisplay(displayId, {
        type: 'voiceCommand',
        action: 'conversationConfirmClear',
        confirmationId: record.id,
        reason
    });
    return record;
}

function scheduleConversationConfirmationTimeout(displayId, expiresAt) {
    clearConversationConfirmationTimer(displayId);
    const delay = Math.max(0, expiresAt - Date.now());
    const timer = setTimeout(() => {
        const record = pendingConversationConfirmations.get(displayId);
        if (!record) return;
        const result = resolveConversationConfirmation(record, 'timeout', Date.now());
        if (result.action === 'confirm') {
            void submitPendingConversationConfirmation(displayId, record, 'auto');
        } else if (result.action === 'cancel') {
            clearPendingConversationConfirmation(displayId, 'timeout');
        }
    }, delay);
    conversationConfirmationTimers.set(displayId, timer);
}

function beginAutoConversationConfirmationWindow(displayId, now = Date.now()) {
    const record = pendingConversationConfirmations.get(displayId);
    if (!record || record.mode !== 'auto' || Number.isFinite(record.cancelUntil)) return false;
    const nextRecord = markConversationConfirmationTtsFinished(record, now);
    pendingConversationConfirmations.set(displayId, nextRecord);
    sendToDisplay(displayId, {
        type: 'voiceCommand',
        action: 'conversationConfirmWindow',
        confirmationId: nextRecord.id,
        expiresAt: nextRecord.cancelUntil
    });
    scheduleConversationConfirmationTimeout(displayId, nextRecord.cancelUntil);
    return true;
}

// 自动确认必须等待确认提示涉及的所有实际播放目标完成，避免远程播报尚未结束时提前提交原话。
function handleConversationConfirmationPlaybackFinished(playbackDisplayId, playbackId, reason = 'finished') {
    if (!playbackDisplayId || !playbackId) return false;
    const playbackKey = getVoiceTtsPlaybackKey(playbackDisplayId, playbackId);
    let handled = false;
    for (const [displayId, record] of pendingConversationConfirmations.entries()) {
        if (!record.playbackKeys?.has(playbackKey)) continue;
        record.playbackKeys.delete(playbackKey);
        handled = true;
        log('语音', `对话确认 TTS 播放${reason === 'finished' ? '完成' : '结束'} displayId=${playbackDisplayId}`);
        if (record.mode === 'auto' && record.playbackKeys.size === 0) {
            beginAutoConversationConfirmationWindow(displayId);
        }
    }
    return handled;
}

async function sendConversationConfirmationResult(displayId, text) {
    sendToDisplay(displayId, {
        type: 'voiceCommand',
        action: 'response',
        text
    });
    try {
        await sendVoiceInputTts(text);
    } catch (error) {
        logError('语音', `对话确认结果 TTS 失败: ${error.message}`);
    }
}

async function submitPendingConversationConfirmation(displayId, record, reason = 'confirmed') {
    const current = pendingConversationConfirmations.get(displayId);
    if (!current || current.id !== record.id) return false;
    clearPendingConversationConfirmation(displayId, reason);
    await handleChatMessage({
        content: record.text,
        displayContent: record.text,
        displayId,
        voiceOriginDisplayId: displayId,
        routeVoiceToAll: true,
        mode: record.chatMode,
        target: record.target,
        sessionId: record.sessionId,
        templateTarget: record.templateTarget,
        sendToControl: broadcastToControls
    });
    return true;
}

async function handlePendingConversationConfirmation(displayId, text) {
    const record = pendingConversationConfirmations.get(displayId);
    if (!record) return false;
    const action = parseConversationConfirmationAction(text);
    if (!action) return false;
    const result = resolveConversationConfirmation(record, action, Date.now());
    if (result.action === 'pending') return true;
    if (result.action === 'confirm') {
        await submitPendingConversationConfirmation(displayId, record, 'confirmed');
        return true;
    }
    clearPendingConversationConfirmation(displayId, 'cancelled');
    await sendConversationConfirmationResult(displayId, '好的，已取消这次对话');
    return true;
}

function requestConversationConfirmation(displayId, text) {
    const session = chat.getSession();
    clearPendingConversationConfirmation(displayId, 'replaced');
    const record = {
        ...createPendingConversationConfirmation(
            text,
            displayId,
            conversationConfirmationMode,
            Date.now()
        ),
        playbackKeys: new Set(),
        chatMode: session.mode === 'private' ? 'private' : 'group',
        target: session.mode === 'private' ? session.privateTarget || null : null,
        sessionId: session.privateSessionId || 'default',
        templateTarget: session.mode === 'private' ? session.privateTarget || null : null
    };
    const promptText = `你刚才说的是：“${record.text}”。请说确认或取消。`;
    pendingConversationConfirmations.set(displayId, record);
    sendToDisplay(displayId, {
        type: 'voiceCommand',
        action: 'conversationConfirm',
        confirmationId: record.id,
        text: promptText,
        detailText: promptText,
        expiresAt: record.expiresAt,
        mode: record.mode
    });
    if (record.mode === 'manual') {
        scheduleConversationConfirmationTimeout(displayId, record.expiresAt);
    }
    (async () => {
        try {
            const targetCount = await sendVoiceInputTts(promptText, {
                onPlaybackStarted: ({ displayId: playbackDisplayId, playbackId }) => {
                    record.playbackKeys.add(getVoiceTtsPlaybackKey(playbackDisplayId, playbackId));
                }
            });
            if (record.mode === 'auto' && targetCount === 0) {
                beginAutoConversationConfirmationWindow(displayId);
            }
        } catch (error) {
            logError('语音', `对话确认提示 TTS 失败: ${error.message}`);
            if (record.mode === 'auto') {
                beginAutoConversationConfirmationWindow(displayId);
            }
        }
    })();
    return record;
}

function handleDisplayConversationInput(displayId, text) {
    const displayData = displayClients.get(displayId);
    if (!displayData || !isDisplayVoiceListeningEnabled(displayData)) {
        return { accepted: false, state: createConversationState(false), event: null };
    }

    // Go/C#/Node 子显示端尚未接入唤醒状态机，继续沿用原有语音命令流程，避免升级服务端后旧客户端失去语音能力。
    if (displayData.isSubDisplay) {
        return {
            accepted: true,
            state: displayData.state.voiceConversation || createConversationState(true),
            event: { type: 'input' }
        };
    }

    const current = displayData.state.voiceConversation || createConversationState(true);
    const result = reduceConversationInput(
        current,
        text,
        getDisplayVoiceAssistantNames(),
        Date.now(),
        { isBuiltin: voiceCommand.isWakeFreeVoiceCommand }
    );
    if (!result.accepted) return result;

    setDisplayConversationState(displayId, result.state, result.event?.type || 'input');
    clearDisplayConversationTimer(displayId);

    if (result.event?.type === 'wake') {
        if (result.event.mode === 'private') {
            chat.setMode('private', result.event.target);
            broadcastToControls({ type: 'privateMode', target: result.event.target, displayId });
            sendConversationPrompt(displayId, `已进入与${result.event.target}的私聊`);
        } else {
            chat.setMode('group');
            broadcastToControls({ type: 'groupMode', displayId });
            sendConversationPrompt(displayId, '已唤醒，进入群聊模式');
        }
    } else if (result.event?.type === 'group') {
        chat.setMode('group');
        broadcastToControls({ type: 'groupMode', displayId });
        sendConversationPrompt(displayId, '已退出私聊，进入群聊模式');
    } else if (result.event?.type === 'end') {
        chat.setMode('group');
        broadcastToControls({ type: 'groupMode', displayId });
        clearDisplayConversationTimer(displayId);
        sendConversationPrompt(displayId, '对话已结束，请再次唤醒');
    }

    if (result.state.state !== 'waitingWake' && result.state.state !== 'disabled') {
        armDisplayConversationTimer(displayId);
    }
    return result;
}

// 播放进度高频上报只更新内存，按时间窗口持久化，避免每次 timeupdate 都同步写配置文件。
function updateDisplayPlaybackProgress(displayData, partialState, forcePersist = false) {
    if (!displayData || !partialState) return;

    Object.assign(displayData.state, partialState);
    const progressKey = displayData.displayId || displayData.ip;
    const now = Date.now();
    const lastPersistAt = displayProgressPersistAt.get(progressKey) || 0;
    const shouldPersist = forcePersist || now - lastPersistAt >= PLAYBACK_PROGRESS_PERSIST_INTERVAL_MS;
    if (!shouldPersist) return;

    displayProgressPersistAt.set(progressKey, now);
    persistDisplayState(displayData, partialState);
}

// 显示端状态以 displayId 持久化，IP 只作为旧数据迁移和日志展示字段。
function persistDisplayState(displayData, partialState) {
    if (!displayData) return null;
    return config.updateDisplayStateById(displayData.displayId, displayData.ip, partialState);
}

function normalizePlaybackProgress(currentTime, duration) {
    const time = Number(currentTime);
    const total = Number(duration);
    if (!Number.isFinite(time) || time < 0) return null;
    return {
        currentTime: time,
        duration: Number.isFinite(total) && total >= 0 ? total : 0
    };
}

app.get('/js/sentence-splitter.js', (req, res) => {
    res.type('application/javascript').sendFile(
        path.join(PROJECT_ROOT, 'src', 'core', 'utils', 'sentence-splitter.js')
    );
});

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
// .mhtml 是单文件网页（MIME 打包），默认 octet-stream 会被浏览器当下载不渲染；
// 统一设为 message/rfc822（Chrome/Edge 渲染 mhtml 的标准 MIME）
function staticWithMhtmlMime(dir) {
  return express.static(dir, {
    setHeaders: (res, filePath) => {
      if (filePath.toLowerCase().endsWith('.mhtml')) {
        res.setHeader('Content-Type', 'message/rfc822');
      }
    }
  });
}

app.use('/uploads', staticWithMhtmlMime(UPLOADS_DIR));
app.use('/res/tasks', express.static(path.join(PROJECT_ROOT, 'res', 'tasks')));
app.use('/models', express.static(path.join(PROJECT_ROOT, 'res', 'models')));
app.use('/js/lib', express.static(path.join(PROJECT_ROOT, 'node_modules', 'onnxruntime-web', 'dist')));
app.use(express.json({ limit: '50mb' }));
// Chat2API 代理只监听服务器本机；控制端通过当前 HTTPS 主服务同源转发，避免浏览器拦截 HTTP 混合内容。
app.use('/api/chat2api-gateway/:instanceId', createChat2ApiGateway({ getTaskManager: () => taskManager }));

app.get('/', (req, res) => {
    res.redirect('/control');
});

app.get('/upload', (req, res) => {
    res.redirect('/control');
});

app.get('/control', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'src', 'apps', 'web-mediacenter', 'ui', 'public', 'upload.html'));
});

app.get('/display', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'src', 'apps', 'web-mediacenter', 'ui', 'public', 'display.html'));
});

async function sendServerReleaseManifest(req, res) {
    try {
        const manifest = await serverReleaseService.getManifest();
        res.json({ status: 'success', manifest });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `读取服务器版本清单失败: ${error.message}` });
    }
}

app.get('/server', sendServerReleaseManifest);
app.get('/server/manifest', sendServerReleaseManifest);

app.get('/server/package', async (req, res) => {
    try {
        await serverReleaseService.streamPackage(res);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ status: 'error', message: `读取服务器代码包失败: ${error.message}` });
        } else {
            res.destroy(error);
        }
    }
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

function requireMediaPath(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${label}不能为空`);
    }
    return value;
}

function getRemoteMediaNode(nodeId) {
    const node = aascServerRegistry.get(nodeId);
    if (!node || node.nodeId === AASC_MAIN_NODE_ID || node.status !== 'online' || !node.url) {
        throw new Error(`AASC 子服务器不可用: ${nodeId}`);
    }
    return node;
}

function encodeRemoteMediaPath(filePath) {
    return String(filePath || '')
        .replace(/^\/+/, '')
        .split('/')
        .filter(Boolean)
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

function copyRemoteMediaHeaders(remoteResponse, response) {
    const headers = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'cache-control',
        'content-disposition',
        'etag',
        'last-modified'
    ];
    headers.forEach(header => {
        if (remoteResponse.headers[header] !== undefined) {
            response.setHeader(header, remoteResponse.headers[header]);
        }
    });
}

function requestRemoteHttp(node, target, options = {}) {
    const client = target.protocol === 'https:' ? https : http;
    const requestHeaders = { ...(options.headers || {}) };
    delete requestHeaders.connection;
    delete requestHeaders.host;
    return new Promise((resolve, reject) => {
        const remoteRequest = client.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || undefined,
            path: `${target.pathname}${target.search}`,
            method: options.method || 'GET',
            headers: requestHeaders,
            rejectUnauthorized: false
        }, resolve);
        remoteRequest.once('error', reject);
        remoteRequest.setTimeout(options.timeoutMs || 120000, () => {
            remoteRequest.destroy(new Error(`远程媒体请求超时: ${node.nodeId}`));
        });
        if (options.bodyStream) {
            options.bodyStream.pipe(remoteRequest);
        } else {
            remoteRequest.end();
        }
    });
}

async function proxyRemoteMediaUpload(req, res) {
    const node = getRemoteMediaNode(req.params.nodeId);
    const target = new URL(
        `/api/media-libraries/${encodeURIComponent(req.params.libraryId)}/upload`,
        `${node.url}/`
    );
    const remoteResponse = await requestRemoteHttp(node, target, {
        method: 'POST',
        headers: req.headers,
        bodyStream: req
    });
    res.status(remoteResponse.statusCode || 502);
    copyRemoteMediaHeaders(remoteResponse, res);
    remoteResponse.pipe(res);
}

async function proxyRemoteMediaFile(req, res) {
    const node = getRemoteMediaNode(req.params.nodeId);
    let filePath;
    try {
        filePath = decodeURIComponent(req.params[0] || '');
    } catch (error) {
        throw new Error(`远程媒体路径编码无效: ${error.message}`);
    }
    const encodedPath = encodeRemoteMediaPath(filePath);
    if (!encodedPath) {
        throw new Error('远程媒体文件路径不能为空');
    }
    const target = new URL(
        `/api/media-libraries/${encodeURIComponent(req.params.libraryId)}/proxy/${encodedPath}`,
        `${node.url}/`
    );
    const remoteResponse = await requestRemoteHttp(node, target, {
        method: 'GET',
        headers: req.headers
    });
    res.status(remoteResponse.statusCode || 502);
    copyRemoteMediaHeaders(remoteResponse, res);
    remoteResponse.pipe(res);
}

const uploadMiddleware = multer({ 
    dest: HTTP_UPLOAD_TEMP_DIR,
    limits: { fileSize: 200 * 1024 * 1024 }
});

const visionUpload = multer({
    dest: HTTP_UPLOAD_TEMP_DIR,
    limits: { fileSize: 20 * 1024 * 1024 }
});

if (!fs.existsSync(HTTP_UPLOAD_TEMP_DIR)) {
    fs.mkdirSync(HTTP_UPLOAD_TEMP_DIR, { recursive: true });
}

function cleanupVisionTempFile(filePath) {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (error) {
        logError('视觉', `清理临时图片失败: ${error.message}`);
    }
}

function readVisionImageBase64(req) {
    if (req.file) {
        return fs.readFileSync(req.file.path, { encoding: 'base64' });
    }

    const imageBase64 = req.body?.imageBase64;
    if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
        const error = new Error('未收到图片文件或 imageBase64');
        error.code = 'VISION_INVALID_IMAGE';
        throw error;
    }
    return imageBase64.replace(/^data:[^;]+;base64,/, '');
}

// OCR 尺寸只作为显示端本地缩放提示，服务器限制范围以避免异常参数进入 WebSocket 链路。
function normalizeVisionShortSide(value) {
    if (value === undefined || value === null || String(value).trim() === '') return 0;
    const shortSide = Number(value);
    if (!Number.isInteger(shortSide) || (shortSide !== 0 && (shortSide < 256 || shortSide > 2048))) {
        const error = new Error('OCR 短边必须为 0 或 256..2048 的整数');
        error.code = 'VISION_INVALID_PARAM';
        throw error;
    }
    return shortSide;
}

function normalizeVisionModel(value) {
    const modelId = String(value || 'yolo11n').trim() || 'yolo11n';
    if (!YOLO_MODEL_IDS.includes(modelId)) {
        const error = new Error(`YOLO 模型必须是 ${YOLO_MODEL_IDS.join('、')} 之一`);
        error.code = 'VISION_INVALID_PARAM';
        throw error;
    }
    return modelId;
}

function getVisionRouteErrorStatus(error) {
    if (error?.code === 'VISION_INVALID_IMAGE') return 400;
    if (error?.code === 'VISION_INVALID_PARAM') return 400;
    if (error?.code === 'VISION_MODEL_NOT_FOUND') return 404;
    if (error?.code === 'VISION_TIMEOUT') return 504;
    if (error?.code === 'VISION_DISPLAY_OFFLINE') return 503;
    return 502;
}

async function handleVisionRoute(kind, req, res) {
    let tempPath = null;
    try {
        tempPath = req.file?.path || null;
        const imageBase64 = readVisionImageBase64(req);
        const shortSide = kind === 'ocr' ? normalizeVisionShortSide(req.body?.shortSide) : undefined;
        const modelId = kind === 'yolo' ? normalizeVisionModel(req.body?.model) : undefined;
        if (kind === 'yolo' && !modelManifestService.createManifest('vision').models.some((model) => model.id === modelId)) {
            const error = new Error(`服务器未准备 YOLO 模型: ${modelId}`);
            error.code = 'VISION_MODEL_NOT_FOUND';
            throw error;
        }
        const capabilityName = kind === 'ocr' ? 'ocrAvailable' : 'yolo11nAvailable';
        const preferredDisplayId = req.body?.displayId || req.body?.targetDisplay || null;
        const display = findDisplayWithVision(capabilityName, preferredDisplayId, modelId);
        if (!display) {
            return res.status(503).json({
                status: 'error',
                message: preferredDisplayId
                    ? `目标显示端不在线或不支持 ${kind.toUpperCase()}`
                    : `没有支持 ${kind.toUpperCase()} 的显示端在线`
            });
        }

        const requestId = `vision-${kind}-${Date.now()}-${++pendingVisionRequestId}`;
        const result = await sendVisionToDisplay(display, kind, imageBase64, requestId, { shortSide, modelId });
        const payload = result && typeof result === 'object' ? result : { data: result };
        return res.json({
            ...payload,
            status: 'success',
            displayId: display.id,
            requestId
        });
    } catch (error) {
        logError('视觉', `${kind.toUpperCase()} 路由失败: ${error.message}`);
        return res.status(getVisionRouteErrorStatus(error)).json({
            status: 'error',
            message: error.message
        });
    } finally {
        cleanupVisionTempFile(tempPath);
    }
}

function sendModelManifest(res, groupName) {
    try {
        return res.json(modelManifestService.createManifest(groupName));
    } catch (error) {
        logError('模型', `${groupName} 模型清单生成失败: ${error.message}`);
        return res.status(500).json({ status: 'error', message: '模型清单生成失败' });
    }
}

function modelDownloadErrorStatus(error) {
    if (error?.code === 'MODEL_INVALID_GROUP' || error?.code === 'MODEL_INVALID_ID' || error?.code === 'MODEL_INVALID_FILE') {
        return 400;
    }
    if (error?.code === 'MODEL_NOT_FOUND') return 404;
    return 500;
}

function streamModelFile(res, filePath) {
    try {
        const stat = fs.statSync(filePath);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => {
            if (!res.headersSent) {
                res.status(500).json({ status: 'error', message: '模型文件读取失败' });
            } else {
                res.end();
            }
        });
        res.on('close', () => stream.destroy());
        res.on('error', () => stream.destroy());
        return stream.pipe(res);
    } catch (error) {
        return res.status(404).json({ status: 'error', message: '模型文件不存在' });
    }
}

// 正式 APK 视觉模型只从服务器按需下载；服务器本身不加载或执行视觉模型。
app.get('/api/vision/model-manifest', (req, res) => sendModelManifest(res, 'vision'));
app.get('/api/vision/model/:modelId/:filename', (req, res) => {
    try {
        const filePath = modelManifestService.resolveFile('vision', req.params.modelId, req.params.filename);
        return streamModelFile(res, filePath);
    } catch (error) {
        return res.status(modelDownloadErrorStatus(error)).json({ status: 'error', message: error.message });
    }
});

// GTCRN 降噪模型与视觉模型使用相同的清单/hash/原子下载契约。
app.get('/api/speech-enhancement/model-manifest', (req, res) => sendModelManifest(res, 'speech-enhancement'));
app.get('/api/speech-enhancement/model/:filename', (req, res) => {
    try {
        const filePath = modelManifestService.resolveFile('speech-enhancement', 'gtcrn', req.params.filename);
        return streamModelFile(res, filePath);
    } catch (error) {
        return res.status(modelDownloadErrorStatus(error)).json({ status: 'error', message: error.message });
    }
});

// 服务器仅负责接收图片并通过 WebSocket 转发到显示端，不在服务端加载或执行视觉模型。
app.post('/api/vision/ocr', visionUpload.single('image'), (req, res) => handleVisionRoute('ocr', req, res));
app.post('/api/vision/yolo', visionUpload.single('image'), (req, res) => handleVisionRoute('yolo', req, res));
app.get('/api/vision/status', (req, res) => {
    const displays = getDisplayList().map((display) => ({
        id: display.id,
        online: true,
        ocrAvailable: display.capabilities?.ocrAvailable === true,
        yolo11nAvailable: display.capabilities?.yolo11nAvailable === true,
        cpuStatus: display.cpuStatus || null
    }));
    res.json({
        status: 'success',
        serverInference: false,
        routes: {
            ocr: '/api/vision/ocr',
            yolo: '/api/vision/yolo',
            modelManifest: '/api/vision/model-manifest'
        },
        displays
    });
});

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
        
        const uniqueName = `${Date.now()}_${file.originalname}`;
        const filePath = path.join(UPLOADS_DIR, uniqueName);
        
        fs.renameSync(file.path, filePath);
        
        const localIP = getLocalIP();
        const protocol = useHttps ? 'https' : 'http';
        const fileUrl = `${protocol}://${localIP}:${PORT}/uploads/${encodeURIComponent(uniqueName)}`;
        
        const mediaData = createUploadedMediaData({
            url: fileUrl,
            fileName: file.originalname,
            timestamp: Date.now()
        });
        
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
        
        const audioPath = await generateTtsWithFallback(text, voice, speed);
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

function getControlTheme() {
    return normalizeControlTheme(config.get('ui.controlTheme', 'dark'));
}

function broadcastControlTheme(theme) {
    displayClients.forEach((_, displayId) => {
        sendToDisplay(displayId, { type: 'controlThemeChanged', theme });
    });
}

// 控制端主题是服务端全局配置，控制端更新后同步通知已连接的显示端。
app.get('/api/config/controlTheme', (req, res) => {
    const theme = getControlTheme();
    res.json({ status: 'success', theme });
});

app.post('/api/config/controlTheme', (req, res) => {
    try {
        const theme = req.body?.theme;
        if (!isControlTheme(theme)) {
            return res.status(400).json({
                status: 'error',
                message: 'theme 必须是已注册的控制端主题'
            });
        }
        config.set('ui.controlTheme', theme);
        broadcastControlTheme(theme);
        res.json({ status: 'success', theme });
    } catch (error) {
        res.status(500).json({ status: 'error', message: '主题配置保存失败' });
    }
});

function isServerAsrEnabled() {
    return !ANDROID_NODE_POLICY.enabled && config.get('asr.serverEnabled', true) === true;
}

function isServerTtsEnabled() {
    return !ANDROID_NODE_POLICY.enabled && config.get('tts.serverEnabled', true) === true;
}

function getServerVoiceConfig() {
    return {
        asrEnabled: isServerAsrEnabled(),
        ttsEnabled: isServerTtsEnabled(),
        asrDevice: config.get('asr.device', 'server'),
        ttsDevice: config.get('tts.device', 'server')
    };
}

function broadcastServerVoiceConfig() {
    broadcastToControls({
        type: 'serverVoiceChanged',
        ...getServerVoiceConfig()
    });
}

app.get('/api/config/serverVoice', (req, res) => {
    res.json({ status: 'success', ...getServerVoiceConfig() });
});

app.post('/api/config/serverVoice', (req, res) => {
    try {
        const body = req.body || {};
        const booleanFields = [
            ['asrEnabled', 'asr.serverEnabled'],
            ['ttsEnabled', 'tts.serverEnabled']
        ];
        for (const [field] of booleanFields) {
            if (body[field] !== undefined && typeof body[field] !== 'boolean') {
                return res.status(400).json({ status: 'error', message: `${field} 必须是布尔值` });
            }
        }

        const changedDevices = [];
        for (const [field, configKey] of booleanFields) {
            if (body[field] !== undefined) config.set(configKey, body[field]);
        }

        if (!isServerAsrEnabled() && config.get('asr.device', 'server') === 'server') {
            config.set('asr.device', 'display');
            changedDevices.push({ type: 'asrDeviceChanged', device: 'display' });
        }
        if (!isServerTtsEnabled() && config.get('tts.device', 'server') === 'server') {
            config.set('tts.device', 'display');
            changedDevices.push({ type: 'ttsDeviceChanged', device: 'display' });
        }

        if (isServerAsrEnabled()) asr.init(config.get('asr', {}));
        broadcastAsrOptions();
        for (const message of changedDevices) broadcastToControls(message);
        broadcastServerVoiceConfig();
        displayClients.forEach((_, displayId) => {
            sendToDisplay(displayId, {
                type: 'ttsConfig',
                device: config.get('tts.device', 'server'),
                localTtsEnabled: config.get('tts.device', 'server') === 'display'
            });
        });
        res.json({ status: 'success', ...getServerVoiceConfig() });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '服务器语音开关更新失败: ' + err.message });
    }
});

app.get('/api/config/asrDevice', (req, res) => {
    res.json({
        status: 'success',
        device: config.get('asr.device', 'server'),
        serverEnabled: isServerAsrEnabled()
    });
});

app.post('/api/config/asrDevice', (req, res) => {
    try {
        const { device } = req.body;
        if (device !== 'server' && device !== 'display') {
            return res.status(400).json({ status: 'error', message: 'device 必须是 server 或 display' });
        }
        if (device === 'server' && !isServerAsrEnabled()) {
            return res.status(409).json({ status: 'error', message: '服务器 ASR 已关闭，请先开启服务器语音识别' });
        }
        config.set('asr.device', device);
        broadcastAsrOptions();

        broadcastToControls({
            type: 'asrDeviceChanged',
            device
        });
        broadcastServerVoiceConfig();

        res.json({ status: 'success', device, serverEnabled: isServerAsrEnabled() });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

function getAsrOptions() {
    return {
        // 正式显示端不再提供语言切换，所有原生 ASR 固定使用中文提示。
        languageMode: 'zh',
        denoise: config.get('asr.denoise', false)
    };
}

function broadcastAsrOptions() {
    const options = getAsrOptions();
    displayClients.forEach((_, displayId) => {
        sendToDisplay(displayId, {
            type: 'asrConfig',
            device: config.get('asr.device', 'server'),
            localAsrEnabled: config.get('asr.device', 'server') === 'display',
            ...options
        });
    });
}

app.get('/api/config/asrOptions', (req, res) => {
    res.json({ status: 'success', ...getAsrOptions() });
});

app.post('/api/config/asrOptions', (req, res) => {
    const body = req.body || {};
    if (body.denoise !== undefined && typeof body.denoise !== 'boolean') {
        return res.status(400).json({ status: 'error', message: 'denoise 必须是布尔值' });
    }
    config.set('asr.languageMode', 'zh');
    if (body.denoise !== undefined) config.set('asr.denoise', body.denoise);
    config.saveConfig();
    broadcastAsrOptions();
    res.json({ status: 'success', ...getAsrOptions() });
});

// TTS 生成设备配置（server=服务端生成，display=显示端离线生成；显示端离线时回退服务端）
app.get('/api/config/ttsDevice', (req, res) => {
    const device = config.get('tts.device', 'server');
    res.json({ status: 'success', device, serverEnabled: isServerTtsEnabled() });
});

app.post('/api/config/ttsDevice', (req, res) => {
    try {
        const { device } = req.body;
        if (device !== 'server' && device !== 'display') {
            return res.status(400).json({ status: 'error', message: 'device 必须是 server 或 display' });
        }
        if (device === 'server' && !isServerTtsEnabled()) {
            return res.status(409).json({ status: 'error', message: '服务器 TTS 已关闭，请先开启服务器语音生成' });
        }
        config.set('tts.device', device);

        broadcastToControls({
            type: 'ttsDeviceChanged',
            device: device
        });

        displayClients.forEach((displayData, displayId) => {
            sendToDisplay(displayId, {
                type: 'ttsConfig',
                device: device,
                localTtsEnabled: device === 'display'
            });
        });
        broadcastServerVoiceConfig();

        res.json({ status: 'success', device, serverEnabled: isServerTtsEnabled() });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

// APK ASR/TTS CPU 大小核并发配置：服务器只保存大核/小核数量并广播，旧客户端忽略未知 cpuConfig。
app.get('/api/config/cpuAffinity', (req, res) => {
    res.json({
        status: 'success',
        cpuAffinity: config.getCpuAffinityConfig()
    });
});

app.post('/api/config/cpuAffinity', (req, res) => {
    try {
        const result = config.applyCpuAffinityConfigUpdate({
            body: req.body,
            broadcastToControls,
            broadcastCpuConfig: sendCpuConfigToAllDisplays
        });
        res.status(result.statusCode).json(result.body);
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'CPU 配置更新失败' });
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
        if (isServerAsrEnabled()) asr.reset(asrConfig);

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

app.get('/api/aasc/servers', (req, res) => {
    try {
        res.json({ status: 'success', servers: getAascServerSnapshots() });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `读取 AASC 服务器列表失败: ${error.message}` });
    }
});

app.post('/api/aasc/servers/register', (req, res) => {
    try {
        const server = aascServerRegistry.register(req.body || {});
        res.json({
            status: 'success',
            server,
            heartbeatTimeoutMs: AASC_HEARTBEAT_TIMEOUT_MS
        });
    } catch (error) {
        res.status(400).json({ status: 'error', message: `服务器注册失败: ${error.message}` });
    }
});

app.post('/api/aasc/servers/:nodeId/heartbeat', (req, res) => {
    try {
        const server = aascServerRegistry.heartbeat(req.params.nodeId, req.body || {});
        if (!server) {
            return res.status(404).json({ status: 'error', message: '服务器节点不存在' });
        }
        res.json({ status: 'success', server });
    } catch (error) {
        res.status(400).json({ status: 'error', message: `服务器心跳失败: ${error.message}` });
    }
});

app.post('/api/aasc/servers/:nodeId/request', async (req, res) => {
    const { type, command, payload, timeoutMs } = req.body || {};
    const requestType = type || command;
    if (typeof requestType !== 'string' || requestType.trim() === '') {
        return res.status(400).json({ status: 'error', message: 'type 或 command 必填' });
    }

    try {
        const result = await aascServerRegistry.request(
            req.params.nodeId,
            requestType.trim(),
            payload || {},
            timeoutMs
        );
        res.json({ status: 'success', result });
    } catch (error) {
        res.status(502).json({ status: 'error', message: `AASC 节点请求失败: ${error.message}` });
    }
});

app.post('/api/aasc/servers/update-all', async (req, res) => {
    try {
        const summary = await updateAllAascSubservers();
        const message = summary.total === 0
            ? '暂无在线子服务器可更新'
            : `已下发 ${summary.accepted}/${summary.total} 台子服务器更新`;
        res.json({ status: 'success', message, ...summary });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `批量重载子服务器失败: ${error.message}` });
    }
});

app.post('/api/aasc/servers/force-update-all', async (req, res) => {
    try {
        const summary = await updateAllAascSubservers({ force: true });
        const message = summary.total === 0
            ? '暂无在线子服务器可强制更新'
            : `已下发 ${summary.accepted}/${summary.total} 台子服务器强制更新`;
        res.json({ status: 'success', message, ...summary });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `强制更新子服务器失败: ${error.message}` });
    }
});

app.post('/api/aasc/servers/:nodeId/media-libraries', async (req, res) => {
    try {
        const result = await requestRemoteMediaLibrary({
            registry: aascServerRegistry,
            nodeId: req.params.nodeId,
            command: 'media.library.add',
            payload: req.body || {}
        });
        res.json({ status: 'success', ...result });
    } catch (error) {
        res.status(502).json({ status: 'error', message: `添加远程媒体库失败: ${error.message}` });
    }
});

app.put('/api/aasc/servers/:nodeId/media-libraries/:libraryId', async (req, res) => {
    try {
        const result = await requestRemoteMediaLibrary({
            registry: aascServerRegistry,
            nodeId: req.params.nodeId,
            command: 'media.library.update',
            payload: {
                id: req.params.libraryId,
                name: req.body?.name,
                readonly: req.body?.readonly,
                isDefault: req.body?.isDefault
            }
        });
        res.json({ status: 'success', ...result });
    } catch (error) {
        res.status(502).json({ status: 'error', message: `更新远程媒体库失败: ${error.message}` });
    }
});

app.delete('/api/aasc/servers/:nodeId/media-libraries/:libraryId', async (req, res) => {
    try {
        const result = await requestRemoteMediaLibrary({
            registry: aascServerRegistry,
            nodeId: req.params.nodeId,
            command: 'media.library.remove',
            payload: { id: req.params.libraryId }
        });
        res.json({ status: 'success', ...result });
    } catch (error) {
        res.status(502).json({ status: 'error', message: `删除远程媒体库失败: ${error.message}` });
    }
});

app.post('/api/aasc/servers/:nodeId/media-libraries/:libraryId/upload', (req, res) => {
    proxyRemoteMediaUpload(req, res).catch(error => {
        if (!res.headersSent) {
            res.status(502).json({ status: 'error', message: `上传到远程媒体库失败: ${error.message}` });
        } else {
            res.end();
        }
    });
});

app.delete('/api/aasc/servers/:nodeId/media-libraries/:libraryId/file', async (req, res) => {
    try {
        const filePath = requireMediaPath(req.query.path, '文件路径');
        const result = await requestRemoteMediaLibrary({
            registry: aascServerRegistry,
            nodeId: req.params.nodeId,
            command: 'media.library.delete-file',
            payload: { id: req.params.libraryId, path: filePath }
        });
        res.json({ status: 'success', ...result });
    } catch (error) {
        res.status(502).json({ status: 'error', message: `删除远程文件失败: ${error.message}` });
    }
});

app.post('/api/aasc/servers/:nodeId/media-libraries/:libraryId/folder', async (req, res) => {
    try {
        if (!req.body?.name) {
            return res.status(400).json({ status: 'error', message: '文件夹名称不能为空' });
        }
        const result = await requestRemoteMediaLibrary({
            registry: aascServerRegistry,
            nodeId: req.params.nodeId,
            command: 'media.library.create-folder',
            payload: {
                id: req.params.libraryId,
                path: req.body.path || '/',
                name: req.body.name
            }
        });
        res.json({ status: 'success', ...result });
    } catch (error) {
        res.status(502).json({ status: 'error', message: `创建远程文件夹失败: ${error.message}` });
    }
});

app.delete('/api/aasc/servers/:nodeId/media-libraries/:libraryId/folder', async (req, res) => {
    try {
        const folderPath = requireMediaPath(req.query.path, '文件夹路径');
        const result = await requestRemoteMediaLibrary({
            registry: aascServerRegistry,
            nodeId: req.params.nodeId,
            command: 'media.library.delete-folder',
            payload: { id: req.params.libraryId, path: folderPath }
        });
        res.json({ status: 'success', ...result });
    } catch (error) {
        res.status(502).json({ status: 'error', message: `删除远程文件夹失败: ${error.message}` });
    }
});

app.post('/api/aasc/servers/:nodeId/media-libraries/:libraryId/set-default', async (req, res) => {
    try {
        const result = await requestRemoteMediaLibrary({
            registry: aascServerRegistry,
            nodeId: req.params.nodeId,
            command: 'media.library.set-default',
            payload: { id: req.params.libraryId }
        });
        res.json({ status: 'success', ...result });
    } catch (error) {
        res.status(502).json({ status: 'error', message: `设置远程默认媒体库失败: ${error.message}` });
    }
});

app.get('/api/aasc/servers/:nodeId/media-libraries/:libraryId/proxy/*', (req, res) => {
    proxyRemoteMediaFile(req, res).catch(error => {
        if (!res.headersSent) {
            res.status(502).json({ status: 'error', message: `读取远程媒体失败: ${error.message}` });
        } else {
            res.end();
        }
    });
});

app.get('/api/aasc/media-index', async (req, res) => {
    try {
        const requestedPath = typeof req.query.path === 'string' ? req.query.path : '/';
        const index = req.query.scope === 'local'
            ? await aascMediaIndexService.buildLocalIndex(requestedPath)
            : await aascMediaIndexService.buildNetworkIndex(requestedPath);
        res.json({ status: 'success', index });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `读取 AASC 媒体索引失败: ${error.message}` });
    }
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
    const device = config.get('asr.device', 'server');
    const ready = device === 'display'
        ? !!findDisplayWithAsr()
        : isServerAsrEnabled() && asr.isReady() === true;
    res.json({
        status: 'success',
        ready,
        device,
        serverEnabled: isServerAsrEnabled(),
        mode: asr.getMode(),
        isolatedProcessEnabled: config.get('asr.isolateProcess.enabled', false)
    });
});

// ASR 模型文件下载（Android 原生识别引擎按需拉取；filename 白名单防路径穿越）
const ASR_MODEL_DIR = path.join(RES_DIR, 'models', 'sensevoice');
const ASR_MODEL_FILES = [
    'model.int8.onnx',
    'model.int8.onnx.sha256',
    'tokens.txt',
    'tokens.txt.sha256'
];

app.get('/api/asr/model/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!ASR_MODEL_FILES.includes(filename)) {
        return res.status(400).json({ status: 'error', message: '非法文件名' });
    }
    const filePath = path.join(ASR_MODEL_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ status: 'error', message: '模型文件不存在' });
    }
    res.setHeader(
        'Content-Type',
        filename.endsWith('.txt') || filename.endsWith('.sha256')
            ? 'text/plain; charset=utf-8'
            : 'application/octet-stream'
    );
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    const stream = fs.createReadStream(filePath);
    // 读流出错或客户端中途断开时销毁流，避免未处理的 'error' 事件崩溃整个服务器进程
    stream.on('error', () => {
        if (!res.headersSent) {
            res.status(500).json({ status: 'error', message: '模型文件读取失败' });
        } else {
            res.end();
        }
    });
    res.on('close', () => stream.destroy());
    // 响应对象出错（如连接被 RST 中断）时同样销毁读流，避免悬空连接
    res.on('error', () => stream.destroy());
    stream.pipe(res);
});

// 声纹模型文件下载（Android 原生声纹识别按需拉取；filename 白名单防路径穿越）
const VOICEPRINT_MODEL_DIR = path.join(RES_DIR, 'models', 'voiceprint');
const VOICEPRINT_MODEL_FILES = [
    '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
    'pyannote_segmentation_3_0_int8.onnx'
];

app.get('/api/voiceprint/model/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!VOICEPRINT_MODEL_FILES.includes(filename)) {
        return res.status(400).json({ status: 'error', message: '非法文件名' });
    }
    const filePath = path.join(VOICEPRINT_MODEL_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ status: 'error', message: '声纹模型文件不存在' });
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
        if (!res.headersSent) {
            res.status(500).json({ status: 'error', message: '模型文件读取失败' });
        } else {
            res.end();
        }
    });
    res.on('close', () => stream.destroy());
    res.on('error', () => stream.destroy());
    stream.pipe(res);
});

// TTS 嵌入式模型文件下载（Android 原生离线语音合成按需拉取；filename 白名单防路径穿越）
const TTS_MODEL_DIR = path.join(RES_DIR, 'models', 'tts');
const TTS_MODEL_FILES = [
    '2052.INI', 'MSTTSLocEnUS.dat', 'MSTTSLocZhCN.dat', 'MSTTSLocZhCN.ini',
    'Tokens.xml', 'ZhCN.address.dat', 'ZhCN.message.dat', 'ZhCN.mixlingual.dat',
    'ZhCN.name.dat', 'am_v5_decoder.bin', 'am_v5_encoder.bin',
    'device_vocoder_v6_streaming.bin', 'phones.txt', 'punc.txt', 'manifest.json'
];

// 模型清单（APK 按此清单逐文件下载并校验 SHA-256）
app.get('/api/tts/model-manifest', (req, res) => {
    const manifestPath = path.join(TTS_MODEL_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return res.status(404).json({ status: 'error', message: '模型清单不存在' });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', fs.statSync(manifestPath).size);
    fs.createReadStream(manifestPath).pipe(res);
});

app.get('/api/tts/model/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!TTS_MODEL_FILES.includes(filename)) {
        return res.status(400).json({ status: 'error', message: '非法文件名' });
    }
    const filePath = path.join(TTS_MODEL_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ status: 'error', message: 'TTS 模型文件不存在' });
    }
    const isJson = filename.endsWith('.json') || filename.endsWith('.xml') || filename.endsWith('.ini') || filename.endsWith('.txt');
    res.setHeader('Content-Type', isJson ? 'application/json; charset=utf-8' : 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
        if (!res.headersSent) {
            res.status(500).json({ status: 'error', message: '文件读取失败' });
        } else {
            res.end();
        }
    });
    res.on('close', () => stream.destroy());
    res.on('error', () => stream.destroy());
    stream.pipe(res);
});

// 声纹识别配置（GET 返回当前配置；POST 更新配置并广播给所有显示端）
app.get('/api/voiceprint/config', (req, res) => {
    res.json({
        status: 'success',
        enabled: config.get('voiceprint.enabled', true),
        extraction: config.get('voiceprint.extraction', 'server'),
        threshold: config.get('voiceprint.threshold', 0.5),
        multiSpeaker: config.get('voiceprint.multiSpeaker', true),
        multiMode: config.get('voiceprint.multiMode', 'fast'),
        speakerCount: config.get('voiceprint.speakerCount', 'AUTO'),
        denoise: config.get('asr.denoise', false)
    });
});

app.post('/api/voiceprint/config', (req, res) => {
    const { enabled, extraction, threshold, multiSpeaker, multiMode, speakerCount, denoise } = req.body || {};
    if (extraction !== undefined && !['server', 'display'].includes(extraction)) {
        return res.status(400).json({ status: 'error', message: 'extraction 只能是 server 或 display' });
    }
    if (threshold !== undefined && (typeof threshold !== 'number' || threshold <= 0 || threshold > 1)) {
        return res.status(400).json({ status: 'error', message: 'threshold 必须是 (0,1] 的数值' });
    }
    if (denoise !== undefined && typeof denoise !== 'boolean') {
        return res.status(400).json({ status: 'error', message: 'denoise 必须是布尔值' });
    }
    if (multiMode !== undefined && multiMode !== 'fast') {
        return res.status(400).json({ status: 'error', message: 'multiMode 只能是 fast' });
    }
    const normalizedSpeakerCount = speakerCount === undefined
        ? config.get('voiceprint.speakerCount', 'AUTO')
        : String(speakerCount).trim().toUpperCase();
    if (normalizedSpeakerCount !== 'AUTO' && !/^[1-5]$/.test(normalizedSpeakerCount)) {
        return res.status(400).json({ status: 'error', message: 'speakerCount 必须是 AUTO 或 1-5' });
    }
    if (enabled !== undefined) config.set('voiceprint.enabled', !!enabled);
    if (extraction !== undefined) config.set('voiceprint.extraction', extraction);
    if (threshold !== undefined) config.set('voiceprint.threshold', threshold);
    if (multiSpeaker !== undefined) config.set('voiceprint.multiSpeaker', !!multiSpeaker);
    config.set('voiceprint.multiMode', multiMode || config.get('voiceprint.multiMode', 'fast'));
    config.set('voiceprint.speakerCount', normalizedSpeakerCount);
    if (denoise !== undefined) config.set('asr.denoise', denoise);
    config.saveConfig();
    // 广播给所有显示端，display.html 收到后 nativeBridge.voiceprintConfigure 重载引擎
    displayClients.forEach((displayData, displayId) => {
        sendToDisplay(displayId, {
            type: 'voiceprintConfig',
            enabled: config.get('voiceprint.enabled', true),
            extraction: config.get('voiceprint.extraction', 'server'),
            threshold: config.get('voiceprint.threshold', 0.5),
            multiSpeaker: config.get('voiceprint.multiSpeaker', true),
            multiMode: config.get('voiceprint.multiMode', 'fast'),
            speakerCount: config.get('voiceprint.speakerCount', 'AUTO'),
            denoise: config.get('asr.denoise', false)
        });
    });
    // 普通 ASR 与声纹流程共享同一降噪状态，配置从声纹面板修改后立即同步。
    broadcastAsrOptions();
    res.json({ status: 'success', message: '声纹配置已更新' });
});

// 修复模式配置：读取时只返回密码状态，避免控制端获取明文密码。
app.get('/api/repair-mode/config', (req, res) => {
    const publicConfig = createPublicRepairModeConfig(
        config.get('repairMode', {}),
        aiRoles.list()
    );
    res.json({ status: 'success', ...publicConfig });
});

// 修复模式配置：空密码输入表示保持原密码，只有明确勾选清空才会停用修复模式。
app.post('/api/repair-mode/config', (req, res) => {
    const result = updateRepairModeConfig({
        body: req.body,
        currentConfig: config.get('repairMode', {}),
        roles: aiRoles.list()
    });
    if (!result.ok) {
        return res.status(400).json({ status: 'error', message: result.message });
    }

    config.set('repairMode.password', result.value.password);
    config.set('repairMode.role', result.value.role);
    config.saveConfig();
    broadcastToControls({ type: 'repairModeConfig', ...result.publicConfig });
    res.json({ status: 'success', message: '修复模式配置已更新', ...result.publicConfig });
});

// 声纹库：读取权威库（APK 同步用）
app.get('/api/voiceprint/db', (req, res) => {
    const db = voiceprintStore.getDb();
    res.json({ status: 'success', ...db });
});

// 声纹库：删除某人声纹
app.post('/api/voiceprint/remove', (req, res) => {
    const name = req.body && req.body.name;
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ status: 'error', message: '缺少 name' });
    }
    const removed = voiceprintStore.remove(name);
    if (!removed) {
        return res.status(404).json({ status: 'error', message: '声纹不存在' });
    }
    res.json({ status: 'success', message: '已删除' });
});

// 声纹注册：控制端上传 audio+name；按 voiceprint.extraction 分派 server 本地提取 / display 中转 APK
const voiceprintUpload = multer({ dest: VOICEPRINT_TEMP_DIR });
const voiceprintService = require('../modules/voiceprint/voiceprint-service');
let pendingVoiceprintExtracts = new Map();   // requestId -> {resolve, reject, timer}
let pendingVoiceprintRequestId = 0;

app.post('/api/voiceprint/register', voiceprintUpload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ status: 'error', message: '未收到音频文件' });
        const name = (req.body && req.body.name || '').trim();
        if (!name) {
            cleanupTempFile(req.file.path);
            return res.status(400).json({ status: 'error', message: '缺少名字' });
        }
        const extraction = config.get('voiceprint.extraction', 'server');
        let embedding;
        if (extraction === 'server') {
            // server 模式：本地懒加载 SpeakerEmbeddingExtractor 提取
            try {
                embedding = await voiceprintService.extractEmbedding(req.file.path);
            } catch (e) {
                cleanupTempFile(req.file.path);
                return res.status(500).json({ status: 'error', message: '声纹提取失败: ' + e.message });
            }
        } else {
            // display 模式：中转在线 APK 提取（WS 下行 voiceprintExtract，回传由 Task 5 处理）
            const display = findDisplayWithVoiceprint();
            if (!display) {
                cleanupTempFile(req.file.path);
                return res.status(503).json({ status: 'error', message: '没有支持声纹的显示端在线' });
            }
            const audioBase64 = fs.readFileSync(req.file.path, { encoding: 'base64' });
            cleanupTempFile(req.file.path);
            const requestId = 'vp-' + Date.now() + '-' + (++pendingVoiceprintRequestId);
            embedding = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingVoiceprintExtracts.delete(requestId);
                    reject(new Error('显示端声纹提取超时'));
                }, 30000);
                pendingVoiceprintExtracts.set(requestId, { resolve, reject, timer });
                try {
                    const sent = sendToDisplay(display.id, { type: 'voiceprintExtract', requestId, audioBase64 });
                    // sendToDisplay 返回 false 表示 ws 未 OPEN（显示端在 find 与 send 之间已断开），
                    // 立即失败，避免白白等满 30s 超时
                    if (!sent) {
                        clearTimeout(timer);
                        pendingVoiceprintExtracts.delete(requestId);
                        reject(new Error('显示端已离线，声纹提取失败'));
                    }
                } catch (err) {
                    clearTimeout(timer);
                    pendingVoiceprintExtracts.delete(requestId);
                    reject(new Error('发送提取请求失败: ' + err.message));
                }
            });
        }
        // 无论 server/display 模式，提取完成后都清理上传的临时音频（display 模式已提前清理，这里重复调用无害）
        cleanupTempFile(req.file.path);
        voiceprintStore.add(name, embedding);
        res.json({ status: 'success', message: `已注册 ${name} 的声纹`, name, dim: embedding.length });
    } catch (e) {
        if (req.file && req.file.path) cleanupTempFile(req.file.path);
        res.status(500).json({ status: 'error', message: '注册失败: ' + e.message });
    }
});

app.post('/api/asr/recognize', asrUpload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: '未收到音频文件' });
        }
        const asrDevice = config.get('asr.device', 'server');

        if (asrDevice === 'server' && !isServerAsrEnabled()) {
            cleanupTempFile(req.file.path);
            return res.status(503).json({ status: 'error', message: '服务器 ASR 已关闭' });
        }

        if (asrDevice === 'display') {
            const displayWithAsr = findDisplayWithAsr();
            if (!displayWithAsr) {
                cleanupTempFile(req.file.path);
                return res.status(503).json({ status: 'error', message: '没有支持 ASR 的显示端在线' });
            }

            try {
                const audioBase64 = fs.readFileSync(req.file.path, { encoding: 'base64' });
                const requestId = 'asr-' + Date.now() + '-' + (++pendingAsrRequestId);
                const result = await sendAudioToDisplayAsr(displayWithAsr, audioBase64, requestId);
                cleanupTempFile(req.file.path);

                if (result.segments && result.segments.length) {
                    const normalizedSegments = result.segments
                        .map(segment => ({ ...segment, text: normalizeAsrText(segment.text) }));
                    const segmentStates = normalizedSegments.map(segment => ({
                        segment,
                        isValid: Boolean(segment.speaker) && hasValidContent(segment.text)
                    }));
                    const segments = segmentStates
                        .filter(state => state.isValid)
                        .map(state => state.segment);
                    const ignoredText = segmentStates
                        .filter(state => state.segment.text && !state.isValid)
                        .map(state => state.segment.text)
                        .join('，');
                    if (segments.length === 0) {
                        return res.json({
                            status: 'ignored',
                            reason: '未识别到已注册声纹',
                            text: ignoredText,
                            segments: []
                        });
                    }
                    const response = {
                        status: 'success',
                        segments: segments.map(segment => ({
                            text: segment.text,
                            speaker: segment.speaker
                        }))
                    };
                    if (ignoredText) response.ignoredText = ignoredText;
                    return res.json(response);
                }

                const text = normalizeAsrText(result.text);
                if (!text) {
                    return res.json({ status: 'ignored', reason: '显示端未识别到有效语音', text: '' });
                }
                if (!hasValidContent(text)) {
                    log('语音', `忽略无效语音输入: ${text}`);
                    return res.json({ status: 'ignored', reason: '未检测到有效内容', text });
                }

                // speaker 存在但为空表示启用声纹后未匹配；字段缺省表示普通 ASR，直接放行。
                if (result.speaker !== undefined) {
                    if (!result.speaker) {
                        log('语音', `忽略未识别到声纹的语音: ${text}`);
                        return res.json({ status: 'ignored', reason: '未识别到已注册声纹', text });
                    }
                    return res.json({ status: 'success', text, speaker: result.speaker });
                }
                return res.json({ status: 'success', text });
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
        
        const recognizedText = normalizeAsrText(await asr.recognize(req.file.path));
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
        broadcastToControls({ type: 'chatConfigChanged', config: newConfig });
        res.json({
            status: 'success',
            message: '聊天配置已更新',
            config: newConfig
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: '配置更新失败' });
    }
});

app.post('/api/ai-roles/stop-all', async (req, res) => {
    try {
        const stopped = await aiRoles.stopAll();
        broadcastToControls({ type: 'roleList', roles: aiRoles.list() });
        res.json({ status: 'success', message: `已关闭 ${stopped} 个 Agent`, stopped });
    } catch (err) {
        res.status(500).json({ status: 'error', message: `关闭 Agent 失败: ${err.message}` });
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
        res.status(400).json({ status: 'error', message: `配置更新失败: ${err.message}` });
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
    try {
        const history = chat.clearHistory(req.body || {});
        log('Chat', `清空聊天历史 source=http mode=${req.body?.mode || '-'} target=${req.body?.target || '-'} sessionId=${req.body?.sessionId || '-'}`);
        res.json({
            status: 'success',
            message: '聊天记录已清空',
            history: history
        });
    } catch (error) {
        logError('Chat', `拒绝清空聊天历史: ${error.message}`);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.get('/api/chat/history/export', (req, res) => {
    try {
        const payload = chat.exportHistory();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="chat-history.json"');
        res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
        logError('Chat', `导出聊天历史失败: ${error.message}`);
        res.status(500).json({ status: 'error', message: `导出聊天历史失败: ${error.message}` });
    }
});

app.post('/api/chat/history/import', (req, res) => {
    try {
        const body = req.body || {};
        const payload = body.history || body;
        const result = chat.importHistory(payload, {
            mode: body.mode || 'merge',
            confirmed: body.confirmed === true
        });
        log('Chat', `导入聊天历史 source=http mode=${body.mode || 'merge'} imported=${result.importedCount} skipped=${result.skippedCount}`);
        res.json({ status: 'success', ...result });
    } catch (error) {
        logError('Chat', `导入聊天历史失败: ${error.message}`);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.get('/api/aasc-user/export', (req, res) => {
    try {
        const payload = chat.exportUserConfig();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="aasc-user-config.json"');
        res.send(JSON.stringify(payload, null, 2));
    } catch (error) {
        logError('Config', `导出 aasc-user 配置失败: ${error.message}`);
        res.status(500).json({ status: 'error', message: `导出配置失败: ${error.message}` });
    }
});

app.post('/api/aasc-user/import', (req, res) => {
    try {
        const body = req.body || {};
        const payload = body.config || body;
        const result = chat.importUserConfig(payload, {
            mode: body.mode || 'merge',
            confirmed: body.confirmed === true
        });
        log('Config', `导入 aasc-user 配置 source=http mode=${body.mode || 'merge'} written=${result.writtenCount} deleted=${result.deletedCount}`);
        res.json({ status: 'success', message: '配置导入完成，请重启服务端使全部配置生效', ...result });
    } catch (error) {
        logError('Config', `导入 aasc-user 配置失败: ${error.message}`);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/chat/round', (req, res) => {
    try {
        const result = chat.deleteConversationRound(req.body || {});
        res.json({
            status: result.success ? 'success' : 'error',
            message: result.message || (result.success ? '本轮对话已删除' : '删除本轮对话失败'),
            history: result.history
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `删除本轮对话失败: ${error.message}` });
    }
});

app.get('/api/chat/sessions', (req, res) => {
    const target = String(req.query.target || '').trim();
    if (target) {
        return res.json({ status: 'success', sessions: chat.listSessions(target) });
    }
    res.json({ status: 'success', sessions: chat.listAllSessions() });
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
        res.status(400).json({ status: 'error', message: `模板更新失败: ${err.message}` });
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
        res.status(400).json({ status: 'error', message: `模板添加失败: ${err.message}` });
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
                    app.use(routePrefix, staticWithMhtmlMime(basePath));
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
            'mkv': 'video/x-matroska',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'mp3': 'audio/mpeg'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');

        // 用文件大小解析 Range（本地/SMB 有精确 size → 支持视频 seek；http 库 size 未知时回落全量）
        let range = null;
        try {
            const fileInfo = await mediaLibraryManager.getFile(req.params.id, filePath);
            if (fileInfo && fileInfo.size) {
                const library = mediaLibraryManager.getLibrary(req.params.id);
                const provider = library ? library.provider : null;
                range = provider ? provider.parseRange(req.headers.range, fileInfo.size) : null;
            }
        } catch (e) {
        }

        const result = await mediaLibraryManager.getFileStream(req.params.id, filePath, range);

        res.status(result.statusCode);
        // provider 明确给出的响应头覆盖 mimeTypes 兜底（http 库带上游 content-type 等）
        if (result.headers) {
            for (const h of Object.keys(result.headers)) {
                res.setHeader(h, result.headers[h]);
            }
        }

        result.stream.pipe(res);

        req.on('close', () => {
            if (result.stream && typeof result.stream.destroy === 'function') {
                result.stream.destroy();
            }
        });

        result.stream.on('error', (err) => {
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

// 通用 HTTPS 媒体代理：服务器 HTTPS 时，控制端手动输入的 http:// 媒体 URL 由
// sendToDisplay 重写为同源 /api/media-proxy，绕开浏览器/WebView 混合内容拦截。
// 流式转发 + Range 透传（relay 上游 206/200），支持视频 seek。
app.get('/api/media-proxy', (req, res) => {
    const target = typeof req.query.url === 'string' ? req.query.url : '';

    if (!target || !/^https?:\/\//i.test(target)) {
        return res.status(400).json({ status: 'error', message: '无效的URL' });
    }

    // SSRF 基础防护：屏蔽本机回环/链路本地/云元数据地址；内网媒体（192.168.x 等）放行，
    // 因为本系统媒体库本身即内网资源（威胁模型是已认证控制端，非匿名外网）
    try {
        const u = new URL(target);
        const host = u.hostname.toLowerCase();
        const isLocalOnly = host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
            host === '0.0.0.0' || host === '169.254.169.254' ||
            /^127\./.test(host) || /^169\.254\./.test(host) || /^fe80:/.test(host) || host.endsWith('.local');
        if (isLocalOnly) {
            return res.status(403).json({ status: 'error', message: '不允许代理访问该地址' });
        }
    } catch (e) {
        return res.status(400).json({ status: 'error', message: '无效的URL' });
    }

    const client = target.startsWith('https') ? https : http;
    const upstreamOptions = { headers: {} };
    if (req.headers.range) {
        upstreamOptions.headers.Range = req.headers.range;
    }

    const upstream = client.get(target, upstreamOptions, (upRes) => {
        if (upRes.statusCode !== 200 && upRes.statusCode !== 206) {
            res.status(502).json({ status: 'error', message: '上游错误: ' + upRes.statusCode });
            upRes.resume();
            return;
        }
        res.status(upRes.statusCode);
        for (const h of ['content-type', 'content-range', 'accept-ranges', 'content-length', 'content-disposition']) {
            if (upRes.headers[h]) res.setHeader(h, upRes.headers[h]);
        }
        upRes.pipe(res);
        req.on('close', () => upRes.destroy());
    });

    upstream.setTimeout(15000, () => upstream.destroy(new Error('代理请求超时')));
    upstream.on('error', (err) => {
        if (!res.headersSent) {
            res.status(504).json({ status: 'error', message: '代理请求失败: ' + err.message });
        } else {
            res.end();
        }
    });
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
            if (caps.ttsGeneration) {
                capabilities.push({ id: 'voice-generation', name: '语音生成', category: 'professional', level: 3 });
            }
            if (caps.displayText) {
                capabilities.push({ id: 'display-text', name: '文本显示', category: 'basic', level: 2 });
            }
            if (caps.ocrAvailable === true) {
                capabilities.push({ id: 'ocr', name: '图像文字识别（OCR）', category: 'professional', level: 3 });
            }
            if (caps.yolo11nAvailable === true) {
                capabilities.push({ id: 'yolo11n', name: '目标检测（YOLO11n）', category: 'professional', level: 3 });
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
            if (caps.ttsGeneration) {
                capabilities.push({ id: 'voice-generation', name: '语音生成', category: 'professional', level: 3 });
            }
            if (caps.ocrAvailable === true) {
                capabilities.push({ id: 'ocr', name: '图像文字识别（OCR）', category: 'professional', level: 3 });
            }
            if (caps.yolo11nAvailable === true) {
                capabilities.push({ id: 'yolo11n', name: '目标检测（YOLO11n）', category: 'professional', level: 3 });
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

const mapPositionsPath = path.join(USER_CONFIG_DIR, 'map-positions.json');

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
        const dir = path.dirname(mapPositionsPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
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

// 显示端代码版本检测：前端轮询此端点，public 目录下任一文件 mtime 变化即自动 reload（无需重启 APK）
// 递归扫描整个 public 目录，避免新增 js/css 文件时漏检
function getDisplayVersion() {
    const publicDir = path.join(PROJECT_ROOT, 'src/apps/web-mediacenter/ui/public');
    let maxMtime = 0;
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                walk(p);
            } else {
                try {
                    const m = fs.statSync(p).mtimeMs;
                    if (m > maxMtime) maxMtime = m;
                } catch (e) { /* 文件被并发删除时跳过 */ }
            }
        }
    };
    walk(publicDir);
    return maxMtime;
}
app.get('/api/display-version', (req, res) => {
    res.json({ version: getDisplayVersion() });
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
                    settings: config.getDisplayStateById(displayId, savedIp),
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
                    persistDisplayState(displayData, { [key]: value });
                    
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
        // 双进程模式下由前台启动器复用同一个 TTY 拉起新服务器；直接运行 server-app.js 时则只退出当前进程。
        if (typeof process.send === 'function') {
            try {
                process.send({ type: 'restartRequested' });
            } catch (error) {
                logError('系统', `通知启动器重启失败: ${error.message}`);
            }
        }

        wss.clients.forEach(client => {
            client.close();
        });

        tui.destroy();
        void shutdownManagedRuntimes(0);
    }, 100);
});

let processShutdownStarted = false;
async function shutdownManagedRuntimes(exitCode) {
    if (processShutdownStarted) return;
    processShutdownStarted = true;
    try {
        if (aascNodeConnector) {
            aascNodeConnector.stop();
            aascNodeConnector = null;
        }
        // 无论是控制端重启还是外部 SIGINT/SIGTERM，都要先释放 blessed 的 raw mode 和刷新定时器。
        tui.destroy();
        await chat.shutdown();
    } catch (error) {
        logError('Chat', `Pi Runtime关闭失败: ${error.message}`);
    } finally {
        process.exit(exitCode);
    }
}

process.once('SIGTERM', () => {
    void shutdownManagedRuntimes(143);
});
process.once('SIGINT', () => {
    void shutdownManagedRuntimes(130);
});

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
            cpuStatus: data.state.cpuStatus,
            voiceConversation: data.state.voiceConversation,
            vadThreshold: normalizeVadThreshold(data.state.vadThreshold),
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

function normalizeDisplayIdList(displayIds) {
    if (!Array.isArray(displayIds)) return [];
    const seen = new Set();
    const normalized = [];
    for (const displayId of displayIds) {
        if (typeof displayId !== 'string' || !displayId || seen.has(displayId)) continue;
        seen.add(displayId);
        normalized.push(displayId);
    }
    return normalized;
}

function getOnlineSelectedDisplayIds(displayIds) {
    return normalizeDisplayIdList(displayIds).filter((displayId) => displayClients.has(displayId));
}

function hasManualVoicePlayback(displayId) {
    const capabilities = getDisplayCapabilities(displayId);
    return capabilities?.voicePlayback === true;
}

function getSelectedVoiceDisplayIds(displayIds) {
    return getOnlineSelectedDisplayIds(displayIds).filter((displayId) => hasManualVoicePlayback(displayId));
}

function resolveTextVoiceTarget(originDisplayId, selectedDisplayIds) {
    const onlineSelectedIds = getOnlineSelectedDisplayIds(selectedDisplayIds);
    if (onlineSelectedIds.includes(originDisplayId) && hasManualVoicePlayback(originDisplayId)) {
        return originDisplayId;
    }
    return onlineSelectedIds.find((displayId) => hasManualVoicePlayback(displayId)) || null;
}

function buildTextVoiceRoute(originDisplayId, selectedDisplayIds) {
    const normalizedSelectedIds = normalizeDisplayIdList(selectedDisplayIds);
    const selectedVoiceDisplayIds = getSelectedVoiceDisplayIds(normalizedSelectedIds);
    return {
        selectedDisplayIds: normalizedSelectedIds,
        selectedVoiceDisplayIds,
        voiceTargetDisplayId: resolveTextVoiceTarget(originDisplayId, normalizedSelectedIds)
    };
}

function applyTextMediaRoute(media, originDisplayId, selectedDisplayIds) {
    if (!media || media.mediaType !== 'text') return media;
    const route = buildTextVoiceRoute(originDisplayId, selectedDisplayIds);
    return {
        ...media,
        ...route,
        route
    };
}

function buildTextPlaylistVoiceRoutes(selectedDisplayIds) {
    const normalizedSelectedIds = normalizeDisplayIdList(selectedDisplayIds);
    const selectedVoiceDisplayIds = getSelectedVoiceDisplayIds(normalizedSelectedIds);
    const voiceRouteByDisplayId = {};
    for (const originDisplayId of normalizedSelectedIds) {
        voiceRouteByDisplayId[originDisplayId] = {
            selectedDisplayIds: normalizedSelectedIds,
            selectedVoiceDisplayIds,
            voiceTargetDisplayId: resolveTextVoiceTarget(originDisplayId, normalizedSelectedIds)
        };
    }
    return {
        selectedDisplayIds: normalizedSelectedIds,
        selectedVoiceDisplayIds,
        voiceRouteByDisplayId
    };
}

function getSavedTextRoute(displayId, savedState) {
    const currentPlaylist = savedState?.currentPlaylist;
    if (currentPlaylist) {
        const startData = currentPlaylist.startData || {};
        const currentItem = startData.playlist?.[currentPlaylist.index];
        if (currentItem?.mediaType !== 'text') return null;
        return startData.voiceRouteByDisplayId?.[displayId] || {
            selectedDisplayIds: startData.selectedDisplayIds,
            selectedVoiceDisplayIds: startData.selectedVoiceDisplayIds,
            voiceTargetDisplayId: startData.voiceTargetDisplayId
        };
    }
    if (savedState?.currentMedia?.mediaType !== 'text') return null;
    return savedState.currentMedia.route || savedState.currentMedia;
}

function restoreTextMediaRoute(displayId, savedState) {
    const savedRoute = getSavedTextRoute(displayId, savedState);
    if (!savedRoute) {
        textMediaTtsService.clearDisplayRoute(displayId);
        return;
    }

    const route = buildTextVoiceRoute(displayId, savedRoute.selectedDisplayIds || [displayId]);
    const savedTarget = savedRoute.voiceTargetDisplayId;
    const savedSelectedVoices = normalizeDisplayIdList(savedRoute.selectedVoiceDisplayIds);
    // 目标当前离线时保留服务器此前选中的可信目标，等请求时再由 TTS 服务检查在线状态；
    // 目标已在线但手动能力被关闭时，不恢复旧目标，避免绕过当前控制端设置。
    if (!route.voiceTargetDisplayId
        && typeof savedTarget === 'string'
        && route.selectedDisplayIds.includes(savedTarget)
        && savedSelectedVoices.includes(savedTarget)
        && !displayClients.has(savedTarget)) {
        route.voiceTargetDisplayId = savedTarget;
        route.selectedVoiceDisplayIds = savedSelectedVoices;
    }
    textMediaTtsService.setDisplayRoute(displayId, route);
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

/**
 * 获取当前真正处于 OPEN 状态且允许语音播放的显示端，供文本 TTS 在每句播放前动态选择。
 * 通用能力查询还服务于控制端展示，因此不直接改变 getDisplaysWithCapability 的既有语义。
 *
 * @returns {string[]} 可作为当前 TTS 目标的显示端 ID
 */
function getOnlineVoicePlaybackDisplayIds() {
    return getDisplaysWithCapability('voicePlayback')
        .filter(({ data }) => data.ws?.readyState === WebSocket.OPEN)
        .map(({ id }) => id);
}

function sendToDisplaysWithCapability(capabilityName, message) {
    const displays = getDisplaysWithCapability(capabilityName);
    for (const display of displays) {
        sendToDisplay(display.id, message);
    }
    return displays.length;
}

function getVoiceTtsPlaybackKey(displayId, playbackId) {
    return `${displayId}:${playbackId}`;
}

function normalizeVoiceTtsRepeatCount(value) {
    const count = Number(value);
    return Number.isInteger(count) && count > 0 ? count : 1;
}

function broadcastVoiceTtsPlaybackState(state, playbackId, playbackDisplayId) {
    const message = {
        type: 'voiceTtsPlaybackState',
        state,
        voiceTtsPlaybackId: playbackId,
        playbackDisplayId,
        voiceprintEnabled: config.get('voiceprint.enabled', true)
    };
    for (const { id, data } of getDisplaysWithCapability('voiceRecording')) {
        if (data.ws?.readyState === WebSocket.OPEN) sendToDisplay(id, message);
    }
}

function finishVoiceTtsPlayback(playbackDisplayId, playbackId, reason = 'finished') {
    if (!playbackDisplayId || !playbackId) return false;
    const key = getVoiceTtsPlaybackKey(playbackDisplayId, playbackId);
    const session = voiceTtsPlaybackTimers.get(key);
    if (!session) return false;
    clearTimeout(session.timer);
    voiceTtsPlaybackTimers.delete(key);
    broadcastVoiceTtsPlaybackState(reason, playbackId, playbackDisplayId);
    handleConversationConfirmationPlaybackFinished(playbackDisplayId, playbackId, reason);
    return true;
}

function completeVoiceTtsPlayback(playbackDisplayId, playbackId, completedCount = 1) {
    if (!playbackDisplayId || !playbackId) return false;
    const key = getVoiceTtsPlaybackKey(playbackDisplayId, playbackId);
    const session = voiceTtsPlaybackTimers.get(key);
    if (!session) return false;

    const count = normalizeVoiceTtsRepeatCount(completedCount);
    session.completedCount += count;
    if (session.completedCount < session.repeatCount) return false;
    return finishVoiceTtsPlayback(playbackDisplayId, playbackId);
}

function finishVoiceTtsPlaybacksForDisplay(playbackDisplayId) {
    const prefix = `${playbackDisplayId}:`;
    for (const key of voiceTtsPlaybackTimers.keys()) {
        if (!key.startsWith(prefix)) continue;
        const playbackId = key.slice(prefix.length);
        finishVoiceTtsPlayback(playbackDisplayId, playbackId, 'timeout');
    }
}

function startVoiceTtsPlayback(playbackDisplayId, playbackId, repeatCount = 1) {
    const key = getVoiceTtsPlaybackKey(playbackDisplayId, playbackId);
    const existingSession = voiceTtsPlaybackTimers.get(key);
    if (existingSession) return;

    const timer = setTimeout(() => {
        finishVoiceTtsPlayback(playbackDisplayId, playbackId, 'timeout');
    }, VOICE_TTS_PLAYBACK_TIMEOUT_MS);
    voiceTtsPlaybackTimers.set(key, {
        timer,
        repeatCount: normalizeVoiceTtsRepeatCount(repeatCount),
        completedCount: 0
    });
    broadcastVoiceTtsPlaybackState('started', playbackId, playbackDisplayId);
}

function prepareVoiceTtsPlayback(displayId, data) {
    if (!data || data.type !== 'tts' || data.action !== 'playAudio' || data.prefetch === true) return;
    if (!data.voiceTtsPlaybackId) {
        data.voiceTtsPlaybackId = generateCorrelationId('voice-tts');
    }
    const key = getVoiceTtsPlaybackKey(displayId, data.voiceTtsPlaybackId);
    const repeatCount = normalizeVoiceTtsRepeatCount(data.voiceTtsPlaybackRepeatCount);
    const session = voiceTtsPlaybackTimers.get(key);
    if (session) {
        session.repeatCount = Math.max(session.repeatCount, repeatCount);
        return;
    }

    startVoiceTtsPlayback(displayId, data.voiceTtsPlaybackId, repeatCount);
}

let displayListDebounceTimer = null;

const SILENT_BROADCAST_TYPES = new Set(['logUpdate', 'systemStats', 'task:progress', 'task:widget_update', 'commandAck', 'videoProgress', 'audioProgress', 'playlistProgress', 'htmlProgress']);
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

// 声纹库变更广播：让所有显示端重拉权威库重建本地 SpeakerEmbeddingManager
function broadcastVoiceprintDbUpdated() {
    displayClients.forEach((displayData, displayId) => {
        sendToDisplay(displayId, { type: 'speakerDbUpdated' });
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

// 显示端模式严格复用 Map 的连接插入顺序，不按 IP、设备名或固定设备优先级排序。
function findDisplayWithAsr() {
    for (const [displayId, displayData] of displayClients) {
        const caps = displayData.state?.capabilities;
        if (caps && caps.voiceRecognition === true) {
            return { id: displayId, ws: displayData.ws };
        }
    }
    return null;
}

// 查找支持本地声纹提取（voiceprintAvailable）的显示端，用于 voiceprint.extraction='display' 时中转
function findDisplayWithVoiceprint() {
    for (const [displayId, displayData] of displayClients) {
        const caps = displayData.state?.capabilities;
        if (caps && caps.voiceprintAvailable) {
            return { id: displayId, ws: displayData.ws };
        }
    }
    return null;
}

function sendAudioToDisplayAsr(display, audioBase64, requestId) {
    return new Promise((resolve, reject) => {
        const timeoutMs = 60000;
        const timer = setTimeout(() => {
            pendingDisplayAsrRequests.delete(requestId);
            reject(new Error('显示端 ASR 响应超时'));
        }, timeoutMs);

        pendingDisplayAsrRequests.set(requestId, { resolve, reject, timer });
        try {
            const sent = sendToDisplay(display.id, {
                type: 'asrAudio',
                audioData: audioBase64,
                requestId
            });
            if (!sent) {
                clearTimeout(timer);
                pendingDisplayAsrRequests.delete(requestId);
                reject(new Error('显示端已离线，ASR 请求发送失败'));
            }
        } catch (err) {
            clearTimeout(timer);
            pendingDisplayAsrRequests.delete(requestId);
            reject(new Error('发送音频到显示端失败: ' + err.message));
        }
    });
}

// 按显示端能力查找视觉推理目标；指定 displayId 时只允许选择该显示端，避免结果回错设备。
function findDisplayWithVision(capabilityName, preferredDisplayId = null, modelId = null) {
    if (preferredDisplayId) {
        const preferredDisplay = displayClients.get(preferredDisplayId);
        const preferredCaps = preferredDisplay?.state?.capabilities;
        if (preferredDisplay && preferredDisplay.ws?.readyState === WebSocket.OPEN &&
            supportsVisionModel(preferredCaps, capabilityName, modelId)) {
            return { id: preferredDisplayId, ws: preferredDisplay.ws };
        }
        return null;
    }

    for (const [displayId, displayData] of displayClients) {
        const caps = displayData.state?.capabilities;
        if (displayData.ws?.readyState === WebSocket.OPEN && supportsVisionModel(caps, capabilityName, modelId)) {
            return { id: displayId, ws: displayData.ws };
        }
    }
    return null;
}

function supportsVisionModel(capabilities, capabilityName, modelId) {
    if (capabilities?.[capabilityName] !== true) return false;
    if (capabilityName !== 'yolo11nAvailable' || !modelId || modelId === 'yolo11n') return true;
    return Array.isArray(capabilities.yoloModels) && capabilities.yoloModels.includes(modelId);
}

function sendVisionToDisplay(display, kind, imageBase64, requestId, options = {}) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const pending = pendingDisplayVisionRequests.get(requestId);
            if (!pending) return;
            pendingDisplayVisionRequests.delete(requestId);
            const error = new Error(`显示端 ${kind.toUpperCase()} 响应超时`);
            error.code = 'VISION_TIMEOUT';
            reject(error);
        }, VISION_REQUEST_TIMEOUT_MS);

        pendingDisplayVisionRequests.set(requestId, {
            displayId: display.id,
            kind,
            resolve,
            reject,
            timer
        });

        try {
            const messageType = kind === 'ocr' ? 'visionOcr' : 'visionYolo11n';
            const message = {
                type: messageType,
                requestId,
                imageBase64
            };
            if (kind === 'ocr' && options.shortSide !== undefined) message.shortSide = options.shortSide;
            if (kind === 'yolo' && options.modelId) message.model = options.modelId;
            const sent = sendToDisplay(display.id, message);
            if (!sent) {
                clearTimeout(timer);
                pendingDisplayVisionRequests.delete(requestId);
                const error = new Error('显示端已离线，视觉请求发送失败');
                error.code = 'VISION_DISPLAY_OFFLINE';
                reject(error);
            }
        } catch (error) {
            clearTimeout(timer);
            pendingDisplayVisionRequests.delete(requestId);
            const sendError = new Error('发送视觉请求到显示端失败: ' + error.message);
            sendError.code = 'VISION_DISPLAY_SEND_ERROR';
            reject(sendError);
        }
    });
}

function rejectPendingVisionRequestsForDisplay(displayId) {
    for (const [requestId, pending] of pendingDisplayVisionRequests) {
        if (pending.displayId !== displayId) continue;
        pendingDisplayVisionRequests.delete(requestId);
        clearTimeout(pending.timer);
        const error = new Error('显示端已离线，视觉请求失败');
        error.code = 'VISION_DISPLAY_OFFLINE';
        pending.reject(error);
    }
}

// 查找支持本地 TTS 生成（ttsGeneration）的显示端，用于 tts.device='display' 路由。
// 优先使用当前请求的目标显示端，避免多个显示端连接时把任务发到错误设备。
function findDisplayWithTts(preferredDisplayId = null) {
    if (preferredDisplayId) {
        const preferredDisplay = displayClients.get(preferredDisplayId);
        const preferredCaps = preferredDisplay?.state?.capabilities;
        if (preferredDisplay && preferredCaps?.ttsGeneration) {
            return { id: preferredDisplayId, ws: preferredDisplay.ws };
        }
    }
    for (const [displayId, displayData] of displayClients) {
        const caps = displayData.state?.capabilities;
        if (caps && caps.ttsGeneration) {
            return { id: displayId, ws: displayData.ws };
        }
    }
    return null;
}

// 普通 Chat/手动 TTS 只在显示端有明确的 TTS 槽位回报时启用双路生成，
// 控制端播放、服务端生成、旧 APK 和无状态显示端都安全回退单路。
function createTtsGenerationScheduler(preferredDisplayId = null) {
    if (config.get('tts.device', 'server') !== 'display') {
        return createOrderedTaskScheduler({ concurrency: 1 });
    }
    const display = findDisplayWithTts(preferredDisplayId);
    const cpuStatus = displayClients.get(display?.id)?.state?.cpuStatus;
    return createOrderedTaskScheduler({ concurrency: getDisplayTtsConcurrency(cpuStatus) });
}

const pendingDisplayTtsRequests = new Map();
let pendingDisplayTtsRequestId = 0;
const TTS_START_ACK_TIMEOUT_MS = 3000;
const TTS_GENERATION_TIMEOUT_MS = 60000;

// 向显示端发送 TTS 生成请求，等待 base64 WAV 回包；超时 60s
function sendTtsGenerateToDisplay(display, text, requestId) {
    return new Promise((resolve, reject) => {
        const pending = {
            displayId: display.id,
            resolve,
            reject,
            timer: null,
            startTimer: null,
            started: false
        };
        pending.timer = setTimeout(() => {
            if (pendingDisplayTtsRequests.get(requestId) !== pending) return;
            pendingDisplayTtsRequests.delete(requestId);
            clearTimeout(pending.startTimer);
            reject(new Error('显示端 TTS 生成超时'));
        }, TTS_GENERATION_TIMEOUT_MS);
        pending.startTimer = setTimeout(() => {
            if (pendingDisplayTtsRequests.get(requestId) !== pending || pending.started) return;
            pendingDisplayTtsRequests.delete(requestId);
            clearTimeout(pending.timer);
            reject(new Error('显示端未收到 TTS 开始生成回执'));
        }, TTS_START_ACK_TIMEOUT_MS);

        pendingDisplayTtsRequests.set(requestId, pending);

        try {
            const sent = sendToDisplay(display.id, {
                type: 'ttsGenerate',
                text: text,
                requestId: requestId
            });
            if (!sent) {
                clearTimeout(pending.timer);
                clearTimeout(pending.startTimer);
                pendingDisplayTtsRequests.delete(requestId);
                reject(new Error('显示端已离线，无法开始 TTS 生成'));
            }
        } catch (err) {
            clearTimeout(pending.timer);
            clearTimeout(pending.startTimer);
            pendingDisplayTtsRequests.delete(requestId);
            reject(new Error('发送 TTS 请求到显示端失败: ' + err.message));
        }
    });
}

// 带 fallback 的 TTS 生成：tts.device='display' 时优先用显示端离线合成，
// 显示端离线/错误/超时则回退服务端 tts.generateTTS；server 模式直接走服务端
async function generateTtsWithFallback(text, voice, speed, preferredDisplayId = null) {
    const ttsText = normalizeTtsPauseText(text);
    const ttsDevice = config.get('tts.device', 'server');
    if (ttsDevice === 'display') {
        const display = findDisplayWithTts(preferredDisplayId);
        if (display) {
            const requestId = 'tts-' + Date.now() + '-' + (++pendingDisplayTtsRequestId);
            try {
                const result = await sendTtsGenerateToDisplay(display, ttsText, requestId);
                // 显示端返回 base64 WAV → 写入临时文件供播放
                const buffer = Buffer.from(result.audioData, 'base64');
                const ttsDir = path.join(RES_DIR, 'uploads', 'tts');
                if (!fs.existsSync(ttsDir)) fs.mkdirSync(ttsDir, { recursive: true });
                const outPath = path.join(ttsDir, 'tts_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8) + '.wav');
                fs.writeFileSync(outPath, buffer);
                log('TTS', '显示端生成成功 (displayId=' + display.id + ' bytes=' + buffer.length + ')');
                return outPath;
            } catch (err) {
                if (!isServerTtsEnabled()) {
                    throw new Error('服务器 TTS 已关闭，显示端生成失败: ' + err.message);
                }
                log('TTS', '显示端生成失败，回退服务端: ' + err.message);
            }
        } else {
            if (!isServerTtsEnabled()) {
                throw new Error('服务器 TTS 已关闭，且没有可用显示端');
            }
            log('TTS', '无在线支持 TTS 的显示端，回退服务端');
        }
    }
    if (!isServerTtsEnabled()) {
        throw new Error('服务器 TTS 已关闭');
    }
    return tts.generateTTS(ttsText, voice, speed);
}

// 显示端语音输入的播报统一遵循通用播放路由；来源显示端只接收语音回复弹窗，不自动成为 TTS 目标。
// TTS 生成设备和音频播放目标分离：生成仍遵循 tts.device 配置，播放目标由通用能力路由决定。
function getVoiceTtsBatchPayload(playbackOptions = {}) {
    if (!playbackOptions.batchId) return {};
    return {
        voiceTtsBatchId: playbackOptions.batchId,
        voiceTtsBatchEnd: playbackOptions.batchEnd === true
    };
}

async function sendVoiceInputTts(text, playbackOptions = {}) {
    if (isRepairModeTtsSuppressed() && playbackOptions.allowRepairModeTts !== true) return 0;
    const audioPath = await generateTtsWithFallback(text);
    const audioUrl = `/uploads/tts/${path.basename(audioPath)}`;
    const targetDisplayIds = getOnlineVoicePlaybackDisplayIds();
    const batchPayload = getVoiceTtsBatchPayload(playbackOptions);
    let sentCount = 0;

    for (const targetDisplayId of targetDisplayIds) {
        const message = {
            type: 'tts',
            action: 'playAudio',
            audioUrl,
            text,
            ...batchPayload
        };
        const sent = sendToDisplay(targetDisplayId, message, {
            allowRepairModeTts: playbackOptions.allowRepairModeTts === true
        });
        if (!sent) continue;
        sentCount++;
        if (typeof playbackOptions.onPlaybackStarted === 'function') {
            playbackOptions.onPlaybackStarted({
                displayId: targetDisplayId,
                playbackId: message.voiceTtsPlaybackId
            });
        }
    }

    return sentCount;
}

// 媒体文件名播报统一由服务器生成并下发，复用跨显示端 TTS 播放状态广播。
async function sendMediaNameTts(displayId, text) {
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    if (!displayId || !normalizedText) return false;

    try {
        const audioPath = await generateTtsWithFallback(normalizedText, undefined, undefined, displayId);
        return sendToDisplay(displayId, {
            type: 'tts',
            action: 'playAudio',
            audioUrl: `/uploads/tts/${path.basename(audioPath)}`,
            text: normalizedText
        });
    } catch (error) {
        logError('TTS', `媒体文件名播报失败: ${error.message}`);
        return false;
    }
}

// 帮助文本等较长语音内容按句串行处理，避免一次 TTS 请求携带整段长文本。
// 回调内部仍负责选择通用或控制端定向播放目标，本函数只负责分句和顺序。
async function sendVoiceTtsSentences(text, sendSentence) {
    const sentences = chat.splitIntoSentences(text);
    const orderedSentences = sentences.length > 0 ? sentences : [text];
    const batchId = generateCorrelationId('voice-tts-batch');
    for (let index = 0; index < orderedSentences.length; index++) {
        await sendSentence(orderedSentences[index], {
            batchId,
            batchEnd: index === orderedSentences.length - 1
        });
    }
}

async function sendVoiceInputTtsSentences(text) {
    await sendVoiceTtsSentences(text, (sentence, playbackOptions) => sendVoiceInputTts(sentence, playbackOptions));
}

async function sendVoiceCommandTtsSentences(text, targetDisplayId) {
    await sendVoiceTtsSentences(text, (sentence, playbackOptions) => sendVoiceCommandTts(sentence, targetDisplayId, playbackOptions));
}

// 控制端语音命令继续按控制端指定的显示目标播放，但生成过程同样统一走 fallback 路由。
async function sendVoiceCommandTts(text, targetDisplayId, playbackOptions = {}) {
    if (isRepairModeTtsSuppressed() && playbackOptions.allowRepairModeTts !== true) return false;
    const audioPath = await generateTtsWithFallback(text, undefined, undefined, targetDisplayId);
    if (!targetDisplayId) return false;

    return sendToDisplay(targetDisplayId, {
        type: 'tts',
        action: 'playAudio',
        audioUrl: `/uploads/tts/${path.basename(audioPath)}`,
        text,
        ...getVoiceTtsBatchPayload(playbackOptions)
    }, {
        allowRepairModeTts: playbackOptions.allowRepairModeTts === true
    });
}

// 裁剪调试日志开关
let _cropDebugLog = false;

// 服务器 HTTPS 时，把 http:// 媒体 URL 重写为同源 /api/media-proxy（绕开浏览器/WebView 混合内容拦截）
function rewriteMediaUrl(url) {
    if (!useHttps || typeof url !== 'string') return url;
    if (/^http:\/\//i.test(url)) {
        return '/api/media-proxy?url=' + encodeURIComponent(url);
    }
    return url;
}

// URL 媒体必须至少有一个可用地址；直连地址缺失时提升同源代理地址，
// 防止 null/undefined 被持久化、转发后由显示端或浏览器发起无效请求。
function normalizeMediaBatchPayload(media) {
    if (!media || typeof media !== 'object' || Array.isArray(media)) return null;
    if (media.temp || media.type === 'base64') return media;

    const normalizeUrl = value => {
        if (typeof value !== 'string') return '';
        const url = value.trim();
        return url && !['null', 'undefined'].includes(url.toLowerCase()) ? url : '';
    };
    const directUrl = normalizeUrl(media.url);
    const fallbackUrl = normalizeUrl(media.fallbackUrl);
    const playbackUrl = directUrl || fallbackUrl;
    if (!playbackUrl) return null;

    return {
        ...media,
        url: playbackUrl,
        ...(directUrl && fallbackUrl && directUrl !== fallbackUrl ? { fallbackUrl } : {})
    };
}

/**
 * 规范化子服务器返回的播放列表。
 *
 * 子服务器媒体提供者生成的 URL 可能包含 localhost、容器地址或旧网卡地址，
 * 不能直接下发给显示端。这里使用注册表中的节点地址重写直连地址，同时保留
 * 主服务器远程代理作为第二条路径；没有任何可用地址的条目直接过滤掉。
 */
function normalizeRemotePlaylist(playlist, nodeId, nodeUrl, libraryId) {
    if (!Array.isArray(playlist)) return [];
    return playlist.map(item => {
        if (!item || typeof item !== 'object' || item.data) return item;
        const pathValue = typeof item.path === 'string' ? item.path : '';
        const directUrl = normalizeRemoteMediaUrl(
            item.directUrl || item.url,
            nodeUrl,
            libraryId,
            pathValue
        );
        const fallbackUrl = pathValue
            ? buildRemoteMediaProxyPath(nodeId, libraryId, pathValue)
            : '';
        const playbackUrl = directUrl || fallbackUrl;
        if (!playbackUrl) return null;
        return {
            ...item,
            path: pathValue,
            url: playbackUrl,
            directUrl,
            ...(directUrl && fallbackUrl && directUrl !== fallbackUrl ? { fallbackUrl } : {})
        };
    }).filter(Boolean);
}

function sendToDisplay(displayId, data, options = {}) {
    // 统一出口重写 http 媒体 URL：手动 URL 输入、restore 恢复、单文件播放等所有下发路径一次覆盖
    if (data.url) data.url = rewriteMediaUrl(data.url);
    if (isRepairModeTtsSuppressed()
        && data.type === 'tts'
        && data.action === 'playAudio'
        && options.allowRepairModeTts !== true) {
        return false;
    }
    const displayData = displayClients.get(displayId);
    if (shouldSkipDisplayTts(displayData, options)) {
        log('TTS', `跳过睡眠显示端播报: ${displayId}`, {
            displayId,
            sleepState: displayData?.state?.sleepState,
            checkSleep: true
        });
        return false;
    }
    if (displayData && displayData.ws.readyState === WebSocket.OPEN) {
        prepareVoiceTtsPlayback(displayId, data);
        if (!data.correlationId) {
            data.correlationId = generateCorrelationId(data.type || 'msg');
        }
        // 高频更新消息（每 2s）不写日志
        const isHighFreq = data.type === 'task:renderUpdate' || data.type === 'task:progress';
        const shouldLogCrop = !isHighFreq && (data.type !== 'control' || data.action !== 'crop' || _cropDebugLog);
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

/**
 * 接收子服务器主动建立的 /server WebSocket 连接。
 *
 * /server 的 HTTP 请求仍由 Express 提供版本清单和代码包；只有升级为
 * WebSocket 后才进入这里。节点必须先注册，主服务器再把会话放入注册表，
 * 后续媒体索引、任务和热更新请求都通过这个会话下发。
 */
function handleAascNodeConnection(ws) {
    let registeredNodeId = null;
    let registering = false;
    const session = new AascNodeSession(ws, {
        onError: error => logError('AASC', `节点会话错误: ${error.message}`),
        onMessage: async message => {
            const handlers = {
                'node.register': handleNodeRegister,
                'node.heartbeat': handleNodeHeartbeat
            };
            const handler = handlers[message.type];
            if (!handler) return;
            await handler(message);
        }
    });

    async function handleNodeRegister(message) {
        if (registeredNodeId || registering) {
            session.close(1008, 'node already registered');
            return;
        }

        registering = true;
        try {
            const registration = normalizeNodeRegistration(message.payload);
            const server = aascServerRegistry.register(registration);
            const attached = aascServerRegistry.attachConnection(server.nodeId, session);
            if (!attached) {
                throw new Error('节点连接未能加入 AASC 注册表');
            }
            registeredNodeId = server.nodeId;
            session.send('node.registered', {
                nodeId: server.nodeId,
                heartbeatTimeoutMs: AASC_HEARTBEAT_TIMEOUT_MS,
                serverTime: Date.now()
            });
            broadcastToControls({
                type: 'aascServersChanged',
                servers: getAascServerSnapshots()
            });
            log('AASC', `子服务器已注册: ${server.nodeId}`);
        } catch (error) {
            logError('AASC', `子服务器注册失败: ${error.message}`);
            session.close(1008, 'invalid node registration');
        } finally {
            registering = false;
        }
    }

    async function handleNodeHeartbeat(message) {
        if (!registeredNodeId) return;
        const server = aascServerRegistry.heartbeat(registeredNodeId, message.payload);
        if (!server) return;
        session.send('node.heartbeatAck', {
            nodeId: server.nodeId,
            lastHeartbeatAt: server.lastHeartbeatAt,
            serverTime: Date.now()
        });
    }

    ws.once('close', () => {
        if (!registeredNodeId) return;
        const detached = aascServerRegistry.detachConnection(registeredNodeId, session);
        if (!detached) return;
        broadcastToControls({
            type: 'aascServersChanged',
            servers: getAascServerSnapshots()
        });
        log('AASC', `子服务器已断开: ${registeredNodeId}`);
    });
}

wss.on('connection', (ws, req) => {
    const url = req.url || '/';

    if (url === '/server' || url.startsWith('/server?')) {
        handleAascNodeConnection(ws, req);
        return;
    }

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
        const savedState = config.getDisplayStateById(displayId, clientIP);

        // 浏览器刷新或重连可能复用 displayId；新连接接管前先关闭旧连接。
        const previousDisplay = displayClients.get(displayId);
        const previousState = previousDisplay?.ws?.readyState;
        if (previousDisplay && previousDisplay.ws !== ws &&
            (previousState === WebSocket.OPEN || previousState === WebSocket.CONNECTING)) {
            previousDisplay.ws.close(4001, 'replaced by newer display connection');
        }

        displayClients.set(displayId, {
            ws: ws,
            displayId: displayId,
            ip: clientIP,
            isSubDisplay: isSubDisplay,
            lastSeen: Date.now(),
            state: {
                ...createDisplayState(),
                ...savedState,
                dynamicFitConfig: normalizeDynamicFitConfig(savedState?.dynamicFitConfig),
                vadThreshold: normalizeVadThreshold(savedState?.vadThreshold),
                isSubDisplay: isSubDisplay,
                capabilities: isSubDisplay ? { ...SUB_DISPLAY_CAPABILITIES } : null
            }
        });
        // 非子显示端：从持久化恢复用户覆盖值，等显示端声明能力后自动合并
        if (!isSubDisplay && savedState?.userCapabilities) {
            const entry = displayClients.get(displayId);
            if (entry) {
                entry.state.userCapabilities = normalizeDisplayUserCapabilities(savedState.userCapabilities);
                entry.state.capabilities = {
                    ...DEFAULT_CAPABILITIES,
                    ...entry.state.userCapabilities
                };
            }
        }
        syncDisplayConversationListeningState(displayId, 'connect');
        log('连接', `显示端 ${displayId} (${clientIP})${isSubDisplay ? ' [子显示端]' : ''} 已连接，当前连接数: ${displayClients.size}`);
        
        if (wsServer) {
            wsServer.handleDisplayConnect(displayId, clientIP, ws, savedState);
        }
        
        ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));
        ws.send(JSON.stringify({ type: 'displayId', id: displayId, ip: clientIP }));
        ws.send(JSON.stringify({ type: 'controlThemeChanged', theme: getControlTheme() }));

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
                    vadThreshold: normalizeVadThreshold(displayClients.get(displayId)?.state.vadThreshold)
                }
            }));
        }

        ws.send(JSON.stringify({
            type: 'voiceVadConfig',
            threshold: normalizeVadThreshold(displayClients.get(displayId)?.state.vadThreshold)
        }));

        ws.send(JSON.stringify({
            type: 'asrConfig',
            device: config.get('asr.device', 'server'),
            localAsrEnabled: config.get('asr.device', 'server') === 'display',
            ...getAsrOptions()
        }));

        const ttsDevice = config.get('tts.device', 'server');
        ws.send(JSON.stringify({
            type: 'ttsConfig',
            device: ttsDevice,
            localTtsEnabled: ttsDevice === 'display'
        }));

        ws.send(JSON.stringify(
            config.createCpuConfigMessage(config.getCpuAffinityConfig())
        ));

        // 显示端连接时推送声纹配置，避免新连接 APK 默认关闭声纹
        ws.send(JSON.stringify({
            type: 'voiceprintConfig',
            enabled: config.get('voiceprint.enabled', true),
            extraction: config.get('voiceprint.extraction', 'server'),
            threshold: config.get('voiceprint.threshold', 0.5),
            multiSpeaker: config.get('voiceprint.multiSpeaker', true),
            multiMode: config.get('voiceprint.multiMode', 'fast'),
            speakerCount: config.get('voiceprint.speakerCount', 'AUTO'),
            denoise: config.get('asr.denoise', false)
        }));

        // 显示端已连接，重试待转发的显示端服务
        if (taskManager) {
            taskManager.retryPendingDisplayServices(displayId);
            taskManager.retryOrphanedTasks(displayId);
            taskManager.reforwardStaleDisplayTasks(displayId);
        }

        // 连接时发送服务器端保存的用户能力覆盖（如果有），让显示端启动时就知道限制
        if (!isSubDisplay && savedState?.userCapabilities) {
            const initialCaps = {
                ...DEFAULT_CAPABILITIES,
                ...normalizeDisplayUserCapabilities(savedState.userCapabilities)
            };
            ws.send(JSON.stringify({
                type: 'capabilitiesUpdated',
                capabilities: initialCaps
            }));
        }
        sendDisplayConversationState(displayId, 'connect');

        // 批量播放也必须先恢复通用显示设置；批量消息只负责恢复播放列表和断点。
        if (savedState) {
            restoreTextMediaRoute(displayId, savedState);
            const restoreState = savedState.currentPlaylist
                ? { ...savedState, currentMedia: null, currentMediaProgress: null }
                : savedState;
            ws.send(JSON.stringify({
                type: 'restoreState',
                state: restoreState
            }));
        }

        if (savedState?.currentPlaylist) {
            ws.send(JSON.stringify({
                type: 'playlistStart',
                ...savedState.currentPlaylist.startData,
                resumeIndex: savedState.currentPlaylist.index,
                resumeTime: savedState.currentPlaylist.currentTime || 0,
                resumeTextPage: savedState.currentPlaylist.currentTextPage || 0,
                resumeState: savedState.currentPlaylist.state || 'playing'
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

                if (data.type !== 'clientLog' && data.type !== 'task:progress' && data.type !== 'commandAck' && data.type !== 'videoProgress' && data.type !== 'audioProgress' && data.type !== 'playlistProgress' && data.type !== 'htmlProgress' && data.type !== 'textProgress') {
                    log('WS', `<< ${data.type}${data.chunk ? ' chunk='+data.chunk.length : ''}${data.isLast ? ' isLast' : ''}${data.text ? ' "'+data.text+'"' : ''}`, { displayId, source: `display:${displayId}`, scope: 'single' });
                }

                if (data.type === 'asrResult') {
                    const pending = pendingDisplayAsrRequests.get(data.requestId);
                    if (pending) {
                        pendingDisplayAsrRequests.delete(data.requestId);
                        clearTimeout(pending.timer);
                        if (data.text || (data.segments && data.segments.length)) {
                            pending.resolve({
                                text: data.text || '',
                                speaker: data.speaker,
                                segments: data.segments
                            });
                        } else {
                            pending.reject(new Error(data.error || '显示端 ASR 识别失败'));
                        }
                    }
                    return;
                }

                if (data.type === 'visionOcrResult' || data.type === 'visionYolo11nResult') {
                    const pending = pendingDisplayVisionRequests.get(data.requestId);
                    if (!pending || pending.displayId !== displayId) return;
                    pendingDisplayVisionRequests.delete(data.requestId);
                    clearTimeout(pending.timer);
                    if (data.success === false || data.error) {
                        pending.reject(new Error(data.error || '显示端视觉推理失败'));
                    } else {
                        pending.resolve(data);
                    }
                    return;
                }

                if (data.type === 'voiceprintExtracted') {
                    const pending = pendingVoiceprintExtracts.get(data.requestId);
                    if (pending) {
                        pendingVoiceprintExtracts.delete(data.requestId);
                        clearTimeout(pending.timer);
                        if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
                            pending.resolve(data.embedding);
                        } else {
                            pending.reject(new Error(data.error || '显示端声纹提取失败'));
                        }
                    }
                    return;
                }

                // 显示端 TTS 开始生成回执：必须先于最终 ttsResult 到达。
                if (data.type === 'ttsGenerating') {
                    const pending = pendingDisplayTtsRequests.get(data.requestId);
                    if (pending) {
                        pending.started = true;
                        clearTimeout(pending.startTimer);
                    }
                    return;
                }

                // 显示端 TTS 生成回包：base64 WAV 或 error
                if (data.type === 'ttsResult') {
                    const pending = pendingDisplayTtsRequests.get(data.requestId);
                    if (pending) {
                        pendingDisplayTtsRequests.delete(data.requestId);
                        clearTimeout(pending.timer);
                        clearTimeout(pending.startTimer);
                        if (!pending.started) {
                            pending.reject(new Error('显示端未先回报 TTS 开始生成'));
                        } else if (data.audioData) {
                            pending.resolve({ audioData: data.audioData });
                        } else {
                            pending.reject(new Error(data.error || '显示端 TTS 生成失败'));
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
            const currentDisplay = displayClients.get(displayId);

            // 旧连接的 close 事件可能晚于新连接到达，不能误删当前连接。
            if (!currentDisplay || currentDisplay.ws !== ws) {
                if (wsServer) {
                    wsServer.handleDisplayDisconnect(displayId, ws);
                }
                ws.removeAllListeners();
                log('断开', `忽略过期显示端连接: ${displayId}`);
                return;
            }

            muteState.previousVolumes.delete(displayId);
            clearDisplayConversationTimer(displayId);
            clearPendingConversationConfirmation(displayId, 'displayDisconnected');
            clearRepairMode(displayId, 'displayDisconnected');
            finishVoiceTtsPlaybacksForDisplay(displayId);
            displayClients.delete(displayId);
            for (const [requestId, pending] of pendingDisplayTtsRequests) {
                if (pending.displayId !== displayId) continue;
                pendingDisplayTtsRequests.delete(requestId);
                clearTimeout(pending.timer);
                clearTimeout(pending.startTimer);
                pending.reject(new Error('显示端已离线，TTS 生成失败'));
            }
            rejectPendingVisionRequestsForDisplay(displayId);
            ws.removeAllListeners();
            if (wsServer) {
                wsServer.handleDisplayDisconnect(displayId, ws);
            }
            textMediaTtsService.handleDisplayDisconnect(displayId);
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
            type: 'conversationConfirmationConfig',
            ...getConversationConfirmationConfig()
        }));
        // 推送各显示端当前临时媒体信息（控制端刷新后预览数据丢失时显示占位提示）
        displayClients.forEach((dd, id) => {
            if (dd.state.lastTempMedia) {
                ws.send(JSON.stringify({
                    type: 'tempMediaInfo',
                    displayId: id,
                    ...dd.state.lastTempMedia
                }));
            }
        });
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
                    const shouldLogCrop = data.type !== 'control' || (data.action !== 'crop' && data.action !== 'controlInput') || _cropDebugLog;
                    const isWidgetRefreshAction = data.type === 'task:widget_action'
                        && data.payload?.action === 'widgetRefresh';
                    const isTaskListRequest = data.type === 'task:list';
                    if (shouldLogCrop && !isWidgetRefreshAction && !isTaskListRequest) {
                        const inputText = typeof data.text === 'string' ? data.text : data.content;
                        const textSummary = typeof inputText === 'string'
                            ? ` "${inputText.length > 500 ? `${inputText.slice(0, 500)}…` : inputText}"`
                            : '';
                        const requestSummary = data.requestId ? ` requestId=${data.requestId}` : '';
                        const modeSummary = data.mode ? ` mode=${data.mode}` : '';
                        log('WS', `<< ${data.type}${requestSummary}${data.displayId ? ' displayId='+data.displayId : ''}${modeSummary}${textSummary}`, extra);
                    }
                }

                if (data.type === 'updateCapabilities') {
                    const targetDisplayId = data.displayId;
                    const targetDisplayData = displayClients.get(targetDisplayId);
                    if (targetDisplayData) {
                        const userCapabilities = normalizeDisplayUserCapabilities(data.capabilities);
                        targetDisplayData.state.capabilities = {
                            ...DEFAULT_CAPABILITIES,
                            ...data.capabilities
                        };
                        // 保存用户覆盖值，重连后恢复
                        targetDisplayData.state.userCapabilities = userCapabilities;
                        syncDisplayConversationListeningState(targetDisplayId, 'control');
                        sendToDisplay(targetDisplayId, {
                            type: 'capabilitiesUpdated',
                            capabilities: targetDisplayData.state.capabilities
                        });
                        ws.send(JSON.stringify({
                            type: 'capabilitiesUpdated',
                            displayId: targetDisplayId,
                            capabilities: targetDisplayData.state.capabilities
                        }));
                        if (config) {
                            persistDisplayState(targetDisplayData, {
                                capabilities: targetDisplayData.state.capabilities,
                                userCapabilities
                            });
                        }
                        broadcastDisplayList();
                        log('能力', `控制端更新显示端 ${targetDisplayId} 能力`);
                    } else {
                        ws.send(JSON.stringify({
                            type: 'capabilitiesUpdateError',
                            displayId: targetDisplayId,
                            message: '显示端不存在或已断开'
                        }));
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

    if (handleTextMediaDisplayMessage({
        displayId,
        data,
        displayData,
        persistDisplayState,
        broadcastToControls
    })) return;
    
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
    } else if (data.type === 'videoProgress') {
        const progress = normalizePlaybackProgress(data.currentTime, data.duration);
        if (displayData && progress) {
            updateDisplayPlaybackProgress(displayData, { currentMediaProgress: progress });
        }
        broadcastToControls({
            displayId: displayId,
            type: 'videoProgress',
            currentTime: data.currentTime,
            duration: data.duration
        });
    } else if (data.type === 'audioProgress') {
        // 音频进度与视频进度分开命名，避免控制端误把音频当作视频媒体处理。
        const progress = normalizePlaybackProgress(data.currentTime, data.duration);
        if (displayData && progress) {
            updateDisplayPlaybackProgress(displayData, { currentMediaProgress: progress });
        }
        broadcastToControls({
            displayId: displayId,
            type: 'audioProgress',
            currentTime: data.currentTime,
            duration: data.duration
        });
    } else if (data.type === 'htmlProgress') {
        // html 播放进度（滚动比例 + 缩放倍数）转发到控制端
        broadcastToControls({
            displayId: displayId,
            type: 'htmlProgress',
            scrollProgress: data.scrollProgress,
            scale: data.scale,
            mode: data.mode,
            loop: data.loop
        });
    } else if (data.type === 'controlScreenshot') {
        // 控制模式截图（html-to-image / getDisplayMedia / none）转发到控制端
        broadcastToControls({
            displayId: displayId,
            type: 'controlScreenshot',
            mode: data.mode,
            dataUrl: data.dataUrl,
            width: data.width,
            height: data.height
        });
    } else if (data.type === 'playlistProgress') {
        let currentPlaylistItems = [];
        if (displayData && displayData.state.currentPlaylist) {
            const previousIndex = displayData.state.currentPlaylist.index;
            currentPlaylistItems = displayData.state.currentPlaylist.startData?.playlist || [];
            displayData.state.currentPlaylist.index = data.index;
            displayData.state.currentPlaylist.state = data.state;
            // 文本列表不使用媒体秒数，按页面和句子断点恢复；字段缺失时保留旧版本兼容语义。
            if (data.mediaType === 'text') {
                displayData.state.currentPlaylist.currentTextPage = Number.isFinite(data.pageIndex) ? data.pageIndex : 0;
                displayData.state.currentPlaylist.currentTextPageTotal = Number.isFinite(data.pageTotal) ? data.pageTotal : 0;
                displayData.state.currentPlaylist.currentTextSentence = Number.isFinite(data.sentenceIndex) ? data.sentenceIndex : 0;
                displayData.state.currentPlaylist.currentTextSentenceTotal = Number.isFinite(data.sentenceTotal) ? data.sentenceTotal : 0;
                displayData.state.currentPlaylist.currentTextFormat = data.format || null;
            }
            const progress = normalizePlaybackProgress(data.currentTime, data.duration);
            if (progress) {
                displayData.state.currentPlaylist.currentTime = progress.currentTime;
                displayData.state.currentPlaylist.duration = progress.duration;
            } else if (previousIndex !== data.index) {
                displayData.state.currentPlaylist.currentTime = 0;
                displayData.state.currentPlaylist.duration = 0;
            }
            if (data.state === 'finished' || data.state === 'stopped') {
                displayData.state.currentPlaylist = null;
                persistDisplayState(displayData, { currentPlaylist: null });
            } else if (!displayData.state.currentPlaylist.temp) {
                updateDisplayPlaybackProgress(displayData, {
                    currentPlaylist: displayData.state.currentPlaylist
                }, data.state === 'paused' || previousIndex !== data.index);
            }
        }
        broadcastToControls({
            displayId: displayId,
            type: 'playlistProgress',
            listId: data.listId,
            index: data.index,
            total: data.total,
            state: data.state,
            fileName: data.fileName,
            url: data.url,
            mediaType: data.mediaType,
            tempPreviewKey: currentPlaylistItems[data.index || 0]?.tempPreviewKey,
            width: data.width,
            height: data.height,
            currentTime: data.currentTime,
            duration: data.duration,
            pageIndex: data.pageIndex,
            pageTotal: data.pageTotal,
            sentenceIndex: data.sentenceIndex,
            sentenceTotal: data.sentenceTotal,
            format: data.format
        });
    } else if (data.type === 'tempMediaInfo') {
        broadcastToControls({
            displayId: displayId,
            type: 'tempMediaInfo',
            fileName: data.fileName,
            mediaType: data.mediaType,
            width: data.width,
            height: data.height
        });
    } else if (data.type === 'sleepStateReport' && displayData) {
        // 睡眠状态上报：存到 state（getState/device-settings 可返回）并转发控制端，供睡眠卡片按钮显示
        displayData.state.sleepState = data.sleepState;
        broadcastToControls({
            displayId: displayId,
            type: 'sleepStateReport',
            sleepState: data.sleepState
        });
    } else if (data.type === 'playStateReport' && displayData) {
        // 播放状态上报：显示端上报真实 isPlaying（播放/暂停命令、显示新媒体、重连恢复后），
        // 持久化后重连 restoreState 据此恢复，避免控制端暂停的视频重连后自动播放
        displayData.state.isPlaying = data.isPlaying;
        persistDisplayState(displayData, { isPlaying: data.isPlaying });
        const progress = normalizePlaybackProgress(data.currentTime, data.duration);
        if (progress && !displayData.state.currentPlaylist) {
            updateDisplayPlaybackProgress(
                displayData,
                { currentMediaProgress: progress },
                data.isPlaying === false
            );
        }
        broadcastToControls({
            displayId: displayId,
            type: 'playStateReport',
            isPlaying: data.isPlaying
        });
    } else if (data.type === 'mediaNameTts' && displayData) {
        // 文件名播报由服务器统一生成，sendToDisplay 会创建播放状态并广播给其他录音显示端。
        void sendMediaNameTts(displayId, data.text);
    } else if (data.type === 'voiceConversationTtsFinished' && displayData) {
        // 该事件只负责普通会话的 3 分钟续期；确认提示使用带 playbackId 的完成回执计时。
        if (isDisplayVoiceListeningEnabled(displayData)
            && ['activeGroup', 'activePrivate'].includes(displayData.state.voiceConversation?.state)) {
            armDisplayConversationTimer(displayId);
            log('语音', `显示端 ${displayId} TTS 播放完成，重新计时3分钟`);
        }
    } else if (data.type === 'voiceTtsPlaybackFinished' && displayData) {
        completeVoiceTtsPlayback(displayId, data.voiceTtsPlaybackId, data.completedCount);
    } else if (data.type === 'voiceVadNoiseResult' && displayData) {
        // 底噪检测只回传统计结果，不进入 ASR、唤醒或内置指令处理链路。
        broadcastToControls({
            type: 'voiceVadNoiseResult',
            displayId,
            requestId: data.requestId || null,
            durationMs: data.durationMs,
            sampleCount: data.sampleCount,
            averageRms: data.averageRms,
            peakRms: data.peakRms,
            p95Rms: data.p95Rms,
            recommendedThreshold: normalizeVadThreshold(data.recommendedThreshold),
            error: data.error || null
        });
    } else if (data.type === 'voiceInput' && displayData) {
        // 控制端需要观察所有有效 ASR 文字，声纹过滤只决定是否进入命令处理链路。
        const voiceprintEnabledNow = config.get('voiceprint.enabled', true);
        const speakerPayload = voiceprintEnabledNow && data.speaker !== undefined
            ? { speaker: data.speaker }
            : {};
        if (!isRepairModePasswordInput(displayId)) {
            broadcastToControls({
                type: 'voiceInput',
                displayId: displayId,
                text: data.text,
                isFinal: data.isFinal,
                fullText: data.fullText,
                ...speakerPayload
            });
        }

        // 声纹未注册/未匹配时不触发唤醒、对话或命令，但不能撤销已经回传控制端的文字。
        if (voiceprintEnabledNow && data.speaker !== undefined && data.speaker === null) {
            log('语音', `未识别到声纹，仅回传控制端不处理: "${data.text}"`);
            return;
        }

        // TTS 可能在另一台显示端播放；即使录音端刚好有一段 ASR 已在途中，也不能让播报回声继续进入命令处理。
        if (!voiceprintEnabledNow && voiceTtsPlaybackTimers.size > 0) {
            if (!isRepairModePasswordInput(displayId)) {
                log('语音', `TTS 播报期间忽略显示端 ${displayId} 的在途语音: "${data.text}"`);
            }
            return;
        }

        if (data.isFinal && data.text && data.text.trim()
            && ['awaitingPassword', 'active'].includes(repairModeStates.get(displayId)?.state)) {
            void handleRepairModeDisplayInput(displayId, data.text.trim());
            return;
        }

        // 构造 voiceCommand 消息转发到控制端处理链路，复用 LLM/命令解析/执行逻辑
        if (data.isFinal && data.text && data.text.trim()) {
            const conversation = handleDisplayConversationInput(displayId, data.text.trim());
            const conversationActive = ['activeGroup', 'activePrivate'].includes(conversation.state?.state);
            const oneShotGroup = conversation.event?.oneShotGroup === true;
            log('语音', `voiceCommand门控 displayId=${displayId} state=${conversation.state?.state || 'unknown'} accepted=${conversation.accepted} event=${conversation.event?.type || 'none'} conversationActive=${conversationActive} oneShotGroup=${oneShotGroup} text=${JSON.stringify(data.text.trim())}`);
            if (!conversation.accepted) {
                log('语音', `显示端 ${displayId} 当前等待唤醒，忽略普通语音`);
                return;
            }
            if (conversation.event?.type !== 'input') {
                return;
            }
            handleControlMessageFallback({
                type: 'voiceCommand',
                text: data.text.trim(),
                displayId,
                conversationActive,
                oneShotGroup,
                ...speakerPayload
            }, ws);
        }
    } else if (data.type === 'voiceStatus' && displayData) {
        displayData.state.voiceSupported = data.supported;
        displayData.state.voiceListening = data.listening;
        broadcastDisplayList();
    } else if (data.type === 'cpuStatus' && displayData) {
        const cpuStatus = normalizeDisplayCpuStatus(data.status);
        if (!cpuStatus) {
            log('能力', `忽略显示端 ${displayId} 的非法 CPU 状态`);
            return;
        }
        displayData.state.cpuStatus = cpuStatus;
        broadcastToControls({
            type: 'cpuStatusUpdated',
            displayId,
            cpuStatus
        });
        broadcastDisplayList();
        log('能力', `显示端 ${displayId} CPU 状态已更新，TTS 槽位=${cpuStatus.tts.totalCoreCount}`);
    } else if (data.type === 'capabilities' && displayData) {
        displayData.state.capabilities = {
            ...DEFAULT_CAPABILITIES,
            ...data.capabilities
        };
        // 重连后恢复用户手动覆盖的能力值
        if (displayData.state.userCapabilities) {
            Object.assign(
                displayData.state.capabilities,
                normalizeDisplayUserCapabilities(displayData.state.userCapabilities)
            );
        }
        syncDisplayConversationListeningState(displayId, 'capabilities');
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

    if (data.type === 'setVoiceVad') {
        if (!displayData) {
            ws.send(JSON.stringify({
                type: 'voiceVadConfigError',
                displayId,
                message: '显示端不存在或已断开'
            }));
            return;
        }
        const threshold = normalizeVadThreshold(data.threshold);
        displayData.state.vadThreshold = threshold;
        persistDisplayState(displayData, { vadThreshold: threshold });
        sendToDisplay(displayId, { type: 'voiceVadConfig', threshold });
        ws.send(JSON.stringify({ type: 'voiceVadConfig', displayId, threshold }));
        broadcastDisplayList();
        log('语音', `控制端更新显示端 ${displayId} VAD 阈值: ${threshold}`);
        return;
    }

    if (data.type === 'detectVoiceNoise') {
        if (!displayData) {
            ws.send(JSON.stringify({
                type: 'voiceVadNoiseResult',
                displayId,
                requestId: data.requestId || null,
                error: '显示端不存在或已断开'
            }));
            return;
        }
        const requestId = data.requestId || generateCorrelationId('vad-noise');
        const sent = sendToDisplay(displayId, {
            type: 'voiceVadNoiseTest',
            requestId,
            durationMs: 3000
        });
        if (!sent) {
            ws.send(JSON.stringify({
                type: 'voiceVadNoiseResult',
                displayId,
                requestId,
                error: '显示端当前不可用'
            }));
            return;
        }
        ws.send(JSON.stringify({ type: 'voiceVadNoiseStarted', displayId, requestId, durationMs: 3000 }));
        log('语音', `开始检测显示端 ${displayId} 底噪，requestId=${requestId}`);
        return;
    }

    if (data.type === 'getConversationConfirmationConfig') {
        ws.send(JSON.stringify({
            type: 'conversationConfirmationConfig',
            ...getConversationConfirmationConfig()
        }));
        return;
    }

    if (data.type === 'setConversationConfirmationConfig') {
        const mode = setConversationConfirmationMode(data.mode, 'control');
        ws.send(JSON.stringify({
            type: 'conversationConfirmationConfig',
            ...getConversationConfirmationConfig(),
            mode
        }));
        return;
    }
    
    if (data.type === 'voiceCommand') {
                    (async () => {
                        try {
                            const playOnControl = data.playOnControl || false;
                            const targetDisplayId = data.displayId || displayId;
                            const isDisplayVoiceInput = displayData?.ws === ws;

                            if (isDisplayVoiceInput
                                && ['awaitingPassword', 'active'].includes(repairModeStates.get(targetDisplayId)?.state)) {
                                await handleRepairModeDisplayInput(targetDisplayId, data.text);
                                return;
                            }

                            if (isDisplayVoiceInput && pendingConversationConfirmations.has(targetDisplayId)) {
                                const handled = await handlePendingConversationConfirmation(targetDisplayId, data.text);
                                if (!handled) {
                                    log('语音', `显示端 ${targetDisplayId} 等待对话确认，忽略非确认输入: ${JSON.stringify(data.text)}`);
                                }
                                return;
                            }

                            if (isDisplayVoiceInput
                                && data.conversationActive === true
                                && conversationConfirmationMode !== 'off'
                                && !voiceCommand.isWakeFreeVoiceCommand(data.text)) {
                                requestConversationConfirmation(targetDisplayId, data.text);
                                return;
                            }
                            
                            const sendToControl = isDisplayVoiceInput
                                ? (msg) => broadcastToControls(msg)
                                : (msg) => ws.send(JSON.stringify(msg));
                            
                            const callbacks = playOnControl ? {
                                onResult: async (text) => {
                                    if (isRepairModeTtsSuppressed()) return;
                                    try {
                                        const audioPath = await generateTtsWithFallback(text);
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
                                    if (isRepairModeTtsSuppressed()) return;
                                    try {
                                        const audioPath = await generateTtsWithFallback(text);
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
                            } : {
                                onTts: isDisplayVoiceInput
                                    ? async (text) => sendVoiceInputTts(text)
                                    : async (text) => sendVoiceCommandTts(text, targetDisplayId),
                                onStop: async () => {
                                    if (isDisplayVoiceInput) {
                                        sendToDisplaysWithCapability('voicePlayback', {
                                            type: 'tts',
                                            action: 'stop'
                                        });
                                    } else if (targetDisplayId) {
                                        sendToDisplay(targetDisplayId, { type: 'tts', action: 'stop' });
                                    }
                                }
                            };
                            
                            const result = await voiceCommand.processVoiceCommand(
                                data.text,
                                targetDisplayId,
                                callbacks,
                                false,
                                {
                                    groupAssistantNames: getDisplayVoiceAssistantNames(),
                                    conversationActive: data.conversationActive === true,
                                    oneShotGroup: data.oneShotGroup === true
                                }
                            );
                            
                            if (!result) return;

                            if (result.type === 'repairMode') {
                                if (!isDisplayVoiceInput) {
                                    const message = '修复模式只能从显示端语音进入';
                                    if (targetDisplayId) {
                                        sendToDisplay(targetDisplayId, {
                                            type: 'voiceCommand',
                                            action: 'response',
                                            text: message
                                        });
                                        void sendVoiceCommandTts(message, targetDisplayId);
                                    }
                                    return;
                                }
                                if (result.action === 'enter') {
                                    beginRepairMode(targetDisplayId);
                                } else if (repairModeStates.has(targetDisplayId)) {
                                    clearRepairMode(targetDisplayId, 'voiceExit');
                                    await sendRepairModeResponse(targetDisplayId, '已退出修复模式');
                                } else {
                                    await sendRepairModeResponse(targetDisplayId, '当前未进入修复模式');
                                }
                                return;
                            }

                            if (result.type === 'showHelp') {
                                // 控制端网页显示帮助列表；目标显示端先收到完整文本，立即打开帮助弹窗。
                                if (controlClients.has(ws)) {
                                    sendToControl({ type: 'showHelp' });
                                }
                                if (targetDisplayId && sendToDisplay) {
                                    const helpTTS = voiceCommand.getVoiceCommandHelpText(
                                        chat.getCommands(),
                                        result.topic
                                    );
                                    sendToDisplay(targetDisplayId, {
                                        type: 'voiceCommand',
                                        action: 'response',
                                        text: helpTTS
                                    });
                                    (async () => {
                                        try {
                                            if (isDisplayVoiceInput) {
                                                await sendVoiceInputTtsSentences(helpTTS);
                                            } else {
                                                await sendVoiceCommandTtsSentences(helpTTS, targetDisplayId);
                                            }
                                        } catch (err) {
                                            logError('VoiceCommand', `帮助TTS生成失败: ${err.message}`);
                                        }
                                    })();
                                }
                            } else if (result.type === 'conversationConfirmationMode') {
                                const mode = setConversationConfirmationMode(result.mode, isDisplayVoiceInput ? 'voice' : 'control');
                                const modeText = mode === 'manual'
                                    ? '已开启对话确认'
                                    : mode === 'auto'
                                        ? '已开启对话自动确认，七秒内可说取消'
                                        : '已关闭对话确认';
                                if (targetDisplayId && sendToDisplay) {
                                    sendToDisplay(targetDisplayId, {
                                        type: 'voiceCommand',
                                        action: 'response',
                                        text: modeText
                                    });
                                    void (isDisplayVoiceInput
                                        ? sendVoiceInputTts(modeText)
                                        : sendVoiceCommandTts(modeText, targetDisplayId));
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
                                            if (isDisplayVoiceInput) {
                                                await sendVoiceInputTts(modeText);
                                            } else {
                                                await sendVoiceCommandTts(modeText, targetDisplayId);
                                            }
                                            sendToDisplay(targetDisplayId, {
                                                type: 'voiceCommand',
                                                action: 'response',
                                                text: modeText
                                            });
                                        } catch (err) {
                                            logError('VoiceCommand', `指令模式TTS失败: ${err.message}`);
                                        }
                                    })();
                                }
                            } else if (result.type === 'commands') {
                                await voiceCommand.executeCommands(result.actions, targetDisplayId, {
                                    onChat: async (message, systemPrompt, skipHistory) => {
                                        await handleChatMessage({
                                            content: message,
                                            displayId: targetDisplayId,
                                            playOnControl: playOnControl,
                                            routeVoiceToAll: isDisplayVoiceInput,
                                            voiceOriginDisplayId: isDisplayVoiceInput ? targetDisplayId : null,
                                            systemPrompt: systemPrompt,
                                            skipHistory: skipHistory || false,
                                            sendToControl: sendToControl
                                        });
                                    },
                                    onSearch: async (searchResult) => {
                                        await handleLlmSearchCommand({
                                            query: searchResult.query,
                                            targetDisplayId,
                                            playOnControl,
                                            isDisplayVoiceInput,
                                            sendToControl
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
                            } else if (result.type === 'search') {
                                await handleLlmSearchCommand({
                                    query: result.query,
                                    targetDisplayId,
                                    playOnControl,
                                    isDisplayVoiceInput,
                                    sendToControl
                                });
                            } else if (result.type === 'chat') {
                                await handleChatMessage({
                                    content: result.message,
                                    displayId: targetDisplayId,
                                    playOnControl: playOnControl,
                                    routeVoiceToAll: isDisplayVoiceInput,
                                    voiceOriginDisplayId: isDisplayVoiceInput ? targetDisplayId : null,
                                    mode: result.mode || 'group',
                                    target: result.target || null,
                                    sessionId: result.sessionId || 'default',
                                    templateTarget: result.templateTarget,
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
                                const audioPath = await generateTtsWithFallback(`今日提醒：${text}`);
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
                                const audioPath = await generateTtsWithFallback('今天没有提醒');
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
                    try {
                        const history = chat.clearHistory({
                            mode: data.mode,
                            target: data.target,
                            sessionId: data.sessionId
                        });
                        log('Chat', `清空聊天历史 source=websocket mode=${data.mode || '-'} target=${data.target || '-'} sessionId=${data.sessionId || '-'}`);
                        ws.send(JSON.stringify({ type: 'chatHistory', history }));
                    } catch (error) {
                        logError('Chat', `拒绝 WebSocket 清空聊天历史: ${error.message}`);
                        ws.send(JSON.stringify({ type: 'chatHistoryError', message: error.message }));
                    }
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
                } else if (data.type === 'getBuiltinVoiceCommands') {
                    ws.send(JSON.stringify({
                        type: 'builtinVoiceCommands',
                        commands: voiceCommand.getBuiltinVoiceCommands()
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
                    const media = normalizeMediaBatchPayload(data.media);
                    if (!media) {
                        logError('媒体', '拒绝下发无效媒体：直连地址和代理地址均为空');
                        ws.send(JSON.stringify({ type: 'mediaError', message: '媒体地址不可用，无法播放' }));
                        return;
                    }
                    const displayIds = data.displayIds || [];
                    displayIds.forEach(id => {
                        const dd = displayClients.get(id);
                        if (dd) {
                            const mediaForDisplay = applyTextMediaRoute(media, id, displayIds);
                            if (mediaForDisplay?.mediaType === 'text') {
                                textMediaTtsService.setDisplayRoute(id, mediaForDisplay.route);
                            } else {
                                textMediaTtsService.clearDisplayRoute(id);
                            }
                            if (dd.state.currentPlaylist) {
                                dd.state.currentPlaylist = null;
                                persistDisplayState(dd, { currentPlaylist: null });
                            }
                            if (mediaForDisplay.temp) {
                                // 记录临时媒体信息：控制端刷新后用于裁剪预览区占位提示
                                dd.state.lastTempMedia = {
                                    fileName: mediaForDisplay.fileName,
                                    mediaType: mediaForDisplay.mediaType,
                                    width: mediaForDisplay.width,
                                    height: mediaForDisplay.height
                                };
                                // 临时媒体也更新当前媒体（仅内存不持久化），
                                // 避免 displayState 恢复旧媒体顶掉刷新后的占位提示
                                dd.state.currentMedia = mediaForDisplay;
                                dd.state.currentMediaProgress = null;
                            } else {
                                dd.state.lastTempMedia = null;
                                dd.state.currentMedia = mediaForDisplay;
                                dd.state.currentMediaProgress = null;
                                persistDisplayState(dd, {
                                    currentMedia: mediaForDisplay,
                                    currentMediaProgress: null
                                });
                            }
                            log('系统', `${mediaForDisplay.temp ? '临时媒体' : '媒体'}发送到显示端: ${id}`);
                            sendToDisplay(id, mediaForDisplay);
                        }
                    });
                    return;
                } else if (data.type === 'playlistRequest') {
                    (async () => {
                        try {
                            const displayIds = data.displayIds || [];
                            if (displayIds.length === 0) {
                                ws.send(JSON.stringify({ type: 'playlistError', message: '没有可用的显示端' }));
                                return;
                            }
                            let playlist;
                            if (data.temp) {
                                playlist = playlistManager.buildFromTemp(data.files || [], {
                                    mode: data.mode, sortBy: data.sortBy, direction: data.direction, mediaTypes: data.mediaTypes
                                });
                            } else if (data.remoteNodeId) {
                                const remoteNode = aascServerRegistry.get(data.remoteNodeId);
                                const remoteResult = await requestRemoteMediaLibrary({
                                    registry: aascServerRegistry,
                                    nodeId: data.remoteNodeId,
                                    command: 'media.library.playlist',
                                    payload: {
                                        id: data.libraryId,
                                        path: data.path || '/',
                                        recursive: data.recursive,
                                        mode: data.mode,
                                        sortBy: data.sortBy,
                                        direction: data.direction,
                                        mediaTypes: data.mediaTypes
                                    }
                                });
                                playlist = normalizeRemotePlaylist(
                                    remoteResult?.playlist || [],
                                    data.remoteNodeId,
                                    remoteNode?.url,
                                    data.libraryId
                                );
                            } else {
                                playlist = await playlistManager.buildFromLibrary(data.libraryId, data.path, {
                                    recursive: data.recursive, mode: data.mode, sortBy: data.sortBy, direction: data.direction, mediaTypes: data.mediaTypes
                                });
                            }
                            if (!playlist || playlist.length === 0) {
                                ws.send(JSON.stringify({ type: 'playlistError', message: '没有可播放的媒体文件' }));
                                return;
                            }
                            const listId = 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
                            const voiceRouteByDisplayId = buildTextPlaylistVoiceRoutes(displayIds);
                            const startData = {
                                listId, playlist,
                                interval: data.interval || 0,
                                loop: !!data.loop,
                                announceName: !!data.announceName,
                                selectedDisplayIds: voiceRouteByDisplayId.selectedDisplayIds,
                                selectedVoiceDisplayIds: voiceRouteByDisplayId.selectedVoiceDisplayIds,
                                voiceRouteByDisplayId: voiceRouteByDisplayId.voiceRouteByDisplayId
                            };
                            const buildStartDataForDisplay = (id, playlistForDisplay) => {
                                const route = voiceRouteByDisplayId.voiceRouteByDisplayId[id] || buildTextVoiceRoute(id, displayIds);
                                return {
                                    ...startData,
                                    playlist: playlistForDisplay || playlist,
                                    selectedDisplayIds: route.selectedDisplayIds,
                                    selectedVoiceDisplayIds: route.selectedVoiceDisplayIds,
                                    voiceTargetDisplayId: route.voiceTargetDisplayId,
                                    voiceRouteByDisplayId: voiceRouteByDisplayId.voiceRouteByDisplayId
                                };
                            };
                            const tempPlaylistMetadata = data.temp ? playlist.map(item => ({
                                fileName: item.fileName,
                                mediaType: item.mediaType,
                                mimeType: item.mimeType,
                                format: item.format,
                                width: item.width,
                                height: item.height,
                                tempPreviewKey: item.tempPreviewKey
                            })) : null;
                            const sentIds = [];
                            displayIds.forEach(id => {
                                const dd = displayClients.get(id);
                                if (!dd) return;
                                const statePlaylist = data.temp ? tempPlaylistMetadata.map(item => ({
                                    fileName: item.fileName,
                                    mediaType: item.mediaType,
                                    mimeType: item.mimeType,
                                    format: item.format,
                                    width: item.width,
                                    height: item.height,
                                    tempPreviewKey: item.tempPreviewKey
                                })) : playlist;
                                const stateStartData = {
                                    ...buildStartDataForDisplay(id, statePlaylist),
                                    temp: !!data.temp
                                };
                                textMediaTtsService.setDisplayRoute(id, {
                                    selectedDisplayIds: stateStartData.selectedDisplayIds,
                                    selectedVoiceDisplayIds: stateStartData.selectedVoiceDisplayIds,
                                    voiceTargetDisplayId: stateStartData.voiceTargetDisplayId
                                });
                                // 控制端刷新只需要恢复当前项文件名和预览元数据；临时列表不把 base64 放入状态，
                                // 避免 getState/配置同步携带整批音频内容；语音路由字段仍需保留以支持重连恢复。
                                const currentPlaylist = {
                                    startData: stateStartData,
                                    index: 0,
                                    state: 'playing',
                                    currentTime: 0,
                                    duration: 0,
                                    currentTextPage: 0,
                                    currentTextPageTotal: 0,
                                    currentTextSentence: 0,
                                    currentTextSentenceTotal: 0,
                                    currentTextFormat: null,
                                    temp: !!data.temp
                                };
                                // 批量临时播放开始，清除单文件临时媒体记录（避免陈旧占位）
                                if (data.temp) {
                                    dd.state.lastTempMedia = null;
                                    if (dd.state.currentPlaylist) {
                                        dd.state.currentPlaylist = null;
                                        persistDisplayState(dd, { currentPlaylist: null });
                                    }
                                    dd.state.currentPlaylist = { ...currentPlaylist };
                                    dd.state.currentMediaProgress = null;
                                } else {
                                    dd.state.currentPlaylist = { ...currentPlaylist };
                                    dd.state.currentMediaProgress = null;
                                    persistDisplayState(dd, {
                                        currentPlaylist: dd.state.currentPlaylist,
                                        currentMediaProgress: null
                                    });
                                }
                                sendToDisplay(id, {
                                    type: 'playlistStart',
                                    ...buildStartDataForDisplay(id, playlist),
                                    temp: !!data.temp
                                });
                                sentIds.push(id);
                            });
                            ws.send(JSON.stringify({
                                type: 'playlistStarted',
                                listId,
                                total: playlist.length,
                                displayIds: sentIds,
                                temp: !!data.temp,
                                ...(tempPlaylistMetadata ? { playlist: tempPlaylistMetadata } : {})
                            }));
                        } catch (err) {
                            logError('批量播放', `生成列表失败: ${err.message}`);
                            ws.send(JSON.stringify({ type: 'playlistError', message: '生成播放列表失败: ' + err.message }));
                        }
                    })();
                    return;
                } else if (data.type === 'playlistControl') {
                    (data.displayIds || []).forEach(id => {
                        const dd = displayClients.get(id);
                        if (!dd) return;
                        sendToDisplay(id, { type: 'playlistControl', action: data.action, index: data.index });
                        if (['pause', 'prev', 'next', 'jump'].includes(data.action)) {
                            // 批量控制不会携带文本 playbackId；按源显示端当前上下文取消，保留 route 供恢复后新句使用。
                            textMediaTtsService.cancel(id);
                        }
                        if (data.action === 'stop' && dd.state.currentPlaylist) {
                            textMediaTtsService.clearDisplayRoute(id);
                            dd.state.currentPlaylist = null;
                            persistDisplayState(dd, { currentPlaylist: null });
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
                    if (displayData.state.currentPlaylist) {
                        displayData.state.currentPlaylist = null;
                        persistDisplayState(displayData, { currentPlaylist: null });
                    }
                    if (data.media.temp) {
                        // 记录临时媒体信息：控制端刷新后用于裁剪预览区占位提示
                        displayData.state.lastTempMedia = {
                            fileName: data.media.fileName,
                            mediaType: data.media.mediaType,
                            width: data.media.width,
                            height: data.media.height
                        };
                        // 临时媒体也持久化为当前媒体：
                        // 显示端 reload 后 restoreState 恢复最近发的临时网页/媒体，不回退到旧的正式媒体
                        displayData.state.currentMedia = data.media;
                        displayData.state.currentMediaProgress = null;
                        persistDisplayState(displayData, {
                            currentMedia: data.media,
                            currentMediaProgress: null
                        });
                    } else {
                        displayData.state.lastTempMedia = null;
                        displayData.state.currentMedia = data.media;
                        displayData.state.currentMediaProgress = null;
                        persistDisplayState(displayData, {
                            currentMedia: data.media,
                            currentMediaProgress: null
                        });
                    }
                    sendToDisplay(displayId, data.media);
                } else if (data.type === 'control') {
                    if (handleTextMediaControlMessage({
                        displayId,
                        data,
                        displayData,
                        persistDisplayState,
                        sendToDisplay,
                        textMediaTtsService
                    })) return;
                    if (data.action === 'rotate') {
                        displayData.state.rotation = data.value;
                        persistDisplayState(displayData, { rotation: data.value });
                    } else if (data.action === 'fit') {
                        displayData.state.fit = data.value;
                        persistDisplayState(displayData, { fit: data.value });
                    } else if (data.action === 'dynamicFitConfig') {
                        const dynamicFitConfig = normalizeDynamicFitConfig(data.value);
                        displayData.state.dynamicFitConfig = dynamicFitConfig;
                        persistDisplayState(displayData, { dynamicFitConfig });
                        data.value = dynamicFitConfig;
                    } else if (data.action === 'crop') {
                        displayData.state.crop = data.value;
                        persistDisplayState(displayData, { crop: data.value });
                    } else if (data.action === 'volume') {
                        displayData.state.volume = data.value;
                        persistDisplayState(displayData, { volume: data.value });
                    } else if (data.action === 'play') {
                        displayData.state.isPlaying = data.value;
                        persistDisplayState(displayData, { isPlaying: data.value });
                    } else if (data.action === 'htmlScroll') {
                        // html 滚动模式持久化：显示端重启/刷新后恢复
                        displayData.state.currentHtmlScroll = data.value;
                        persistDisplayState(displayData, { currentHtmlScroll: data.value });
                    } else if (data.action === 'cropDebug') {
                        _cropDebugLog = !!data.value;
                    } else if (data.action === 'controlMode' || data.action === 'controlInput') {
                        // 控制模式开关与输入转发：不更新 state，原样转发显示端
                    } else if (data.action === 'sleepSettings') {
                        // 睡眠设置持久化：显示端刷新/重启后 restoreState 恢复
                        displayData.state.sleep = data.value;
                        persistDisplayState(displayData, { sleep: data.value });
                    }
                    sendToDisplay(displayId, data);
                } else if (data.type === 'tts') {
                    if (data.action === 'stop') {
                        sendToDisplaysWithCapability('voicePlayback', data);
                    } else if (data.action === 'play' && data.text) {
                        if (isRepairModeTtsSuppressed()) return;
                        (async () => {
                            try {
                                const cleanText = stripMarkdown(data.text);
                                const sentences = chat.splitIntoSentences(cleanText)
                                    .filter((sentence) => !isPunctuationOnly(sentence));
                                const targetDisplayIds = data.displayIds || (displayId ? [displayId] : []);
                                const preferredDisplayId = targetDisplayIds[0] || displayId || null;
                                const ttsScheduler = createTtsGenerationScheduler(preferredDisplayId);

                                const tasks = sentences.map((sentence) => ttsScheduler.enqueue(async () => {
                                    const audioPath = await generateTtsWithFallback(sentence, undefined, undefined, preferredDisplayId);
                                    return { sentence, audioPath };
                                }).then((result) => {
                                    if (!result || isRepairModeTtsSuppressed()) return;
                                    const { sentence, audioPath } = result;
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
                                }).catch((err) => {
                                    logError('TTS', `句子生成失败: ${err.message}`);
                                }));
                                await Promise.all(tasks);
                            } catch (err) {
                                logError('TTS', `播放失败: ${err.message}`);
                            }
                        })();
                    } else if (data.action === 'setAutoTts') {
                        // 自动播报开关：既控制整点报时（time.announce 任务），也控制显示端媒体文件名播报。
                        // 持久化到 displayData.state.autoTts（显示端刷新/重启后 restoreState 恢复）+ 转发显示端
                        if (taskManager) {
                            (async () => {
                                try {
                                    const tasks = await taskManager.listTasks();
                                    const announce = tasks.find(t => t.taskName === 'time.announce');
                                    if (announce && announce.instances && announce.instances.length > 0) {
                                        const inst = announce.instances[0];
                                        await taskManager.handleWidgetAction(inst.instanceId, 'updateConfig', { enabled: data.enabled === true });
                                        log('报时', '自动播报: ' + (data.enabled ? '开启' : '关闭'));
                                    }
                                } catch (err) {
                                    logError('TTS', 'setAutoTts 失败: ' + err.message);
                                }
                            })();
                        }
                        if (displayData) {
                            const enabled = data.enabled === true;
                            displayData.state.autoTts = enabled;
                            persistDisplayState(displayData, { autoTts: enabled });
                        }
                        sendToDisplay(displayId, data);
                    } else {
                        sendToDisplay(displayId, data);
                    }
                } else if (data.type === 'chat') {
                    (async () => {
                        try {
                            const ttsScheduler = createTtsGenerationScheduler(displayId);
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
                                onSentence: (sentence) => {
                                    if (isPunctuationOnly(sentence)) return;
                                    ttsScheduler.enqueue(async () => {
                                        const cleanText = stripMarkdown(sentence);
                                        const audioPath = await generateTtsWithFallback(cleanText, undefined, undefined, displayId);
                                        return { audioPath, sentence };
                                    }).then(({ audioPath, sentence }) => {
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
                            await ttsScheduler.waitForIdle();
                        } catch (err) {
                            logError('Chat', `处理失败: ${err.message}`);
                            ws.send(JSON.stringify({
                                type: 'chatResponse',
                                requestId: data.requestId,
                                success: false,
                                error: err.message
                            }));
                        }
                    })();
                } else if (data.type === 'roleList') {
                    try {
                        ws.send(JSON.stringify({ type: 'roleList', roles: aiRoles.list() }));
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'roleError', message: err.message }));
                    }
                } else if (data.type === 'roleAdd') {
                    // 重名/空名/非法名由 role-store 抛错，捕获后回 roleError，避免进程崩溃
                    try {
                        aiRoles.add(data.name);
                        broadcastToControls({ type: 'roleList', roles: aiRoles.list() });
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'roleError', message: err.message }));
                    }
                } else if (data.type === 'roleDelete') {
                    try {
                        if (!aiRoles.list().some(r => r.name === data.role)) {
                            ws.send(JSON.stringify({ type: 'roleError', message: '角色不存在' }));
                            return;
                        }
                        await aiRoles.remove(data.role);
                        broadcastToControls({ type: 'roleList', roles: aiRoles.list() });
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'roleError', message: err.message }));
                    }
                } else if (data.type === 'roleHistory') {
                    try {
                        if (!aiRoles.list().some(r => r.name === data.role)) {
                            ws.send(JSON.stringify({ type: 'roleError', message: '角色不存在' }));
                            return;
                        }
                        ws.send(JSON.stringify({ type: 'roleHistory', role: data.role, history: aiRoles.history(data.role) }));
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'roleError', message: err.message }));
                    }
                } else if (data.type === 'chatMessage') {
                    (async () => {
                        try {
                            // Agent 消息显式使用 assistantType；旧控制端只发 mode=role 时继续兼容。
                            const isAgentMessage = data.assistantType === 'agent' ||
                                (!data.assistantType && data.mode === 'role');
                            if (isAgentMessage) {
                                const session = chat.getSession();
                                const targetDisplayId = data.displayId || displayId;
                                const targetDisplayIds = data.displayIds || [];
                                const playOnControl = data.playOnControl || session.playOnControl;
                                const preferredDisplayId = targetDisplayIds[0] || targetDisplayId || null;
                                const agentTtsStream = createAgentTtsStream({
                                    playOnControl,
                                    displayId: targetDisplayId,
                                    displayIds: targetDisplayIds,
                                    ttsScheduler: createTtsGenerationScheduler(preferredDisplayId),
                                    splitIntoSentences: chat.splitIntoSentences,
                                    stripMarkdown,
                                    generateTTS: (text) => generateTtsWithFallback(text, undefined, undefined, preferredDisplayId),
                                    sendToControl: (ttsMessage) => ws.send(JSON.stringify(ttsMessage)),
                                    sendToDisplay,
                                    isTtsSuppressed: isRepairModeTtsSuppressed,
                                    onError: (error) => logError('Chat', `Agent TTS生成失败: ${error.message}`)
                                });
                                if (!data.role) {
                                    ws.send(JSON.stringify({ type: 'roleError', message: 'Agent 消息缺少角色' }));
                                    return;
                                }
                                // 角色名来自前端输入：先确认存在，避免对不存在的角色静默建孤儿目录
                                if (!aiRoles.list().some(r => r.name === data.role)) {
                                    ws.send(JSON.stringify({ type: 'roleError', message: '角色不存在' }));
                                    return;
                                }
                                await aiRoles.chat(data.role, data.content, {
                                    requestId: data.requestId,
                                    onStatus: () => {
                                        broadcastToControls({ type: 'roleList', roles: aiRoles.list() });
                                    },
                                    onChunk: (chunk, message, requestId) => {
                                        ws.send(JSON.stringify({ type: 'chatChunk', requestId: requestId || data.requestId, chunk, message }));
                                        agentTtsStream.onChunk(chunk);
                                    },
                                    onComplete: (message, history, requestId) => {
                                        ws.send(JSON.stringify({ type: 'chatResponse', requestId: requestId || data.requestId, success: true, message, history }));
                                        void agentTtsStream.onComplete(message);
                                    },
                                    onError: (error) => ws.send(JSON.stringify({ type: 'chatResponse', requestId: data.requestId, success: false, error: error instanceof Error ? error.message : error }))
                                });
                                return;
                            }
                            const session = chat.getSession();
                            const targetDisplayId = data.displayId || displayId;
                            const targetDisplayIds = data.displayIds || [];
                            
                            await handleChatMessage({
                                requestId: data.requestId,
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
                                requestId: data.requestId,
                                success: false,
                                error: err.message
                            }));
                        }
                    })();
                } else if (data.type === 'executeCommands') {
                    (async () => {
                        try {
                            await voiceCommand.executeCommands(data.actions, data.displayId, {
                                onChat: async (message, systemPrompt, skipHistory) => {
                                    await handleChatMessage({
                                        content: message,
                                        displayId: data.displayId,
                                        playOnControl: data.playOnControl,
                                        systemPrompt: systemPrompt,
                                        skipHistory: skipHistory || false,
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
        requestId,
        content,
        displayContent,
        displayId,
        voiceOriginDisplayId = null,
        displayIds = [],
        playOnControl = false,
        routeVoiceToAll = false,
        systemPrompt: customSystemPrompt,
        templateTarget,
        mode = 'group',
        target,
        sessionId,
        skipHistory = false,
        allowRepairModeTts = false,
        sendToControl
    } = options;
    
    const effectiveRequestId = requestId || generateCorrelationId('chat');
    const messageMode = mode;
    const messageTarget = messageMode === 'private' ? target : null;
    const effectiveTemplateTarget = messageMode === 'group' ? null : templateTarget;
    
    chat.addMessage({
        role: 'control',
        name: '控制端',
        content: displayContent || content,
        mode: messageMode,
        target: messageTarget,
        sessionId: sessionId,
        templateId: effectiveTemplateTarget || 'default'
    });
    
    let systemPrompt = null;
    let includeHistory = false;
    let contextCount = 0;
    if (messageMode === 'group') {
        systemPrompt = chat.getGroupSystemPrompt();
        contextCount = chat.getConfig().contextCount || 0;
        if (contextCount > 0) includeHistory = true;
    } else if (effectiveTemplateTarget) {
        const template = chat.getTemplateByName(effectiveTemplateTarget);
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
    if (customSystemPrompt && !effectiveTemplateTarget && messageMode !== 'group') {
        systemPrompt = customSystemPrompt;
    }
    if (skipHistory) {
        includeHistory = false;
        contextCount = 0;
    }

    const preferredDisplayId = displayIds[0] || (routeVoiceToAll ? null : displayId) || null;
    const ttsScheduler = tts ? createTtsGenerationScheduler(preferredDisplayId) : null;
    const sendChatResponse = (payload) => {
        const responseLength = typeof payload.message === 'string' ? payload.message.length : 0;
        log('WS', `>> chatResponse requestId=${effectiveRequestId} success=${payload.success} messageLength=${responseLength}`, {
            source: 'server',
            scope: 'single',
            targetId: displayId || voiceOriginDisplayId || null,
            correlationId: effectiveRequestId
        });
        sendToControl(payload);
    };
    if (voiceOriginDisplayId && sendToControl) {
        sendToControl({
            type: 'chatInput',
            requestId: effectiveRequestId,
            content: displayContent || content,
            displayId: voiceOriginDisplayId,
            mode: messageMode
        });
    }
    await chat.chatStream(content, {
        useTemplate: null,
        displayId: displayId,
        systemPrompt: systemPrompt,
        includeHistory: includeHistory,
        contextCount: contextCount,
        mode: messageMode,
        target: messageTarget,
        templateTarget: effectiveTemplateTarget,
        sessionId: sessionId
    }, {
        onChunk: (chunk, fullMessage) => {
            sendToControl({ type: 'chatChunk', requestId: effectiveRequestId, chunk, message: fullMessage });
        },
        onSentence: (sentence) => {
            if (!tts || isPunctuationOnly(sentence)) return;
            if (isRepairModeTtsSuppressed() && !allowRepairModeTts) return;
            ttsScheduler.enqueue(async () => {
                if (isRepairModeTtsSuppressed() && !allowRepairModeTts) return null;
                const cleanText = stripMarkdown(sentence);
                const audioPath = await generateTtsWithFallback(cleanText, undefined, undefined, preferredDisplayId);
                return { audioPath, sentence };
            }).then((result) => {
                if (!result || (isRepairModeTtsSuppressed() && !allowRepairModeTts)) return;
                const { audioPath, sentence } = result;
                const fileName = path.basename(audioPath);
                const audioUrl = `/uploads/tts/${fileName}`;

                if (playOnControl) {
                    sendToControl({ type: 'playOnControl', audioUrl, text: sentence });
                } else if (routeVoiceToAll) {
                    for (const targetId of getOnlineVoicePlaybackDisplayIds()) {
                        sendToDisplay(targetId, {
                            type: 'tts',
                            action: 'playAudio',
                            audioUrl: audioUrl,
                            text: sentence
                        });
                    }
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
        },
        onComplete: (fullMessage, history) => {
            chat.addMessage({
                role: 'assistant',
                name: effectiveTemplateTarget || '助手',
                content: fullMessage,
                mode: messageMode,
                target: messageTarget,
                sessionId: sessionId,
                templateId: effectiveTemplateTarget || 'default'
            });
            
            sendChatResponse({ type: 'chatResponse', requestId: effectiveRequestId, success: true, message: fullMessage, history: chat.getHistory() });
            if (voiceOriginDisplayId) {
                sendToDisplay(voiceOriginDisplayId, {
                    type: 'voiceCommand',
                    action: 'response',
                    text: fullMessage,
                    detailText: fullMessage
                });
            }
        },
        onError: (error) => {
            sendChatResponse({ type: 'chatResponse', requestId: effectiveRequestId, success: false, error });
        }
    });
    if (ttsScheduler) await ttsScheduler.waitForIdle();
}

async function sendSearchTts(text, options = {}) {
    const {
        targetDisplayId = null,
        playOnControl = false,
        isDisplayVoiceInput = false,
        sendToControl
    } = options;
    if (!text) return;
    if (isRepairModeTtsSuppressed()) return;

    if (playOnControl) {
        const audioPath = await generateTtsWithFallback(text);
        sendToControl({
            type: 'playOnControl',
            audioUrl: `/uploads/tts/${path.basename(audioPath)}`,
            text
        });
        return;
    }

    if (isDisplayVoiceInput) {
        await sendVoiceInputTtsSentences(text);
        return;
    }

    if (targetDisplayId) {
        await sendVoiceCommandTtsSentences(text, targetDisplayId);
    }
}

async function handleLlmSearchCommand(options = {}) {
    const {
        query = '',
        targetDisplayId = null,
        playOnControl = false,
        isDisplayVoiceInput = false,
        sendToControl
    } = options;
    const normalizedQuery = String(query || '').trim();
    const requestId = generateCorrelationId('search');
    const searchingText = `正在搜索${normalizedQuery || '相关信息'}`;
    const sendChannel = (payload) => {
        sendToControl({
            type: 'searchChannel',
            requestId,
            query: normalizedQuery,
            timestamp: Date.now(),
            ...payload
        });
    };

    sendChannel({
        status: 'started',
        content: searchingText,
        result: null,
        error: null
    });
    try {
        await sendSearchTts(searchingText, {
            targetDisplayId,
            playOnControl,
            isDisplayVoiceInput,
            sendToControl
        });
    } catch (error) {
        logError('Search', `搜索开始提示TTS失败: ${error.message}`);
    }

    const activeProfile = chat.getProfileByName(chat.getActiveProfile());
    const useEphemeralAgent = activeProfile?.mode === 'agent'
        && ['pi', 'codex'].includes(activeProfile?.backend);
    const prompt = normalizedQuery ? `搜索：${normalizedQuery}` : '帮我搜索一些信息';
    const searchSystemPrompt = '你是独立搜索助手。只处理当前搜索请求，使用可用的只读网络搜索工具获取信息；不要引用或猜测其他聊天内容，回答时给出简洁、准确的搜索结果。';
    let result;

    try {
        result = await chat.chatStream(prompt, {
            systemPrompt: searchSystemPrompt,
            includeHistory: false,
            contextCount: 0,
            mode: 'search',
            target: null,
            sessionId: requestId,
            conversationKey: `search:${requestId}`,
            ephemeral: useEphemeralAgent
        }, {
            onChunk: (chunk, fullMessage) => {
                sendChannel({
                    status: 'running',
                    content: fullMessage || chunk,
                    result: null,
                    error: null
                });
            }
        });

        if (!result?.success || !String(result.message || '').trim()) {
            throw new Error(result?.error || '搜索返回空结果');
        }

        const responseText = String(result.message).trim();
        const searchResult = {
            type: 'agent_answer',
            content: responseText
        };
        voiceCommand.recordSearchHistory(normalizedQuery, searchResult);
        sendChannel({
            status: 'completed',
            content: responseText,
            result: searchResult,
            error: null
        });

        try {
            await sendSearchTts(responseText, {
                targetDisplayId,
                playOnControl,
                isDisplayVoiceInput,
                sendToControl
            });
        } catch (error) {
            logError('Search', `搜索结果TTS失败: ${error.message}`);
        }

        if (!playOnControl && targetDisplayId && sendToDisplay) {
            sendToDisplay(targetDisplayId, {
                type: 'voiceCommand',
                action: 'response',
                text: responseText,
                detailText: responseText
            });
        }
    } catch (error) {
        sendChannel({
            status: 'failed',
            content: '搜索失败，请稍后再试',
            result: null,
            error: error.message
        });
        logError('Search', `LLM 搜索失败: ${error.message}`);
    }
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
                onChat: async (message, systemPrompt, skipHistory) => {
                    await handleChatMessage({
                        content: message,
                        displayId: targetDisplayId,
                        systemPrompt: systemPrompt,
                        skipHistory: skipHistory || false,
                        sendToControl: sendToControl
                    });
                },
                onSearch: async (searchResult) => {
                    await handleLlmSearchCommand({
                        query: searchResult.query,
                        targetDisplayId,
                        sendToControl
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
        } else if (result.type === 'search') {
            await handleLlmSearchCommand({
                query: result.query,
                targetDisplayId,
                sendToControl
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
        rejectPendingVisionRequestsForDisplay(id);
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
