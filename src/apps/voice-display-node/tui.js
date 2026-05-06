const blessed = require('blessed');

const CATEGORY_COLORS = {
    '连接': 'green',
    '断开': 'red',
    '语音': 'cyan',
    '语音输入': 'cyan',
    '语音命令': 'green',
    'TTS': 'yellow',
    '提醒': 'magenta',
    '录音': 'blue',
    'ASR': 'cyan',
    'ASR子进程': 'cyan',
    '心跳': 'gray',
    '错误': 'red',
    '系统': 'gray',
    '重连': 'yellow',
    '配置': 'gray',
    '能力': 'blue',
    '启动': 'green',
    '停止': 'red'
};

function getCategoryColor(category) {
    return CATEGORY_COLORS[category] || 'gray';
}

function getTimestamp() {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
}

function formatMemory(bytes) {
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

class SubDisplayTUI {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        if (!this.enabled) return;

        this.maxLogLines = options.maxLogLines || 300;
        this.displayId = options.displayId || 'unknown';
        this.renderPending = false;
        this.logBuffer = [];
        this.maxLogBuffer = 1000;
        this._logCount = 0;
        this._trimTimer = null;
        this.systemStats = null;
        this.keyboardMode = 'browse';  // 键盘模式: browse=浏览, input=输入
        this.inputBox = null;          // 底部文本输入行
        this.onSendText = null;        // 文本发送回调
        this._initScreen();
    }

    _initScreen() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: `Voice Display - ${this.displayId}`,
            fullUnicode: true,
            dockBorders: true
        });

        this.headerBox = blessed.box({
            top: 0,
            left: 0,
            width: '100%',
            height: 1,
            style: {
                bg: 'green',
                fg: 'black',
                bold: true
            },
            content: ` Voice Display Node - ${this.displayId} `
        });

        this.connectionBox = blessed.box({
            top: 1,
            left: 0,
            width: '34%',
            height: '35%',
            label: ' 连接状态 ',
            border: {
                type: 'line'
            },
            style: {
                border: {
                    fg: 'cyan'
                }
            },
            tags: true,
            scrollable: true
        });

        this.recordingBox = blessed.box({
            top: 1,
            left: '34%',
            width: '33%',
            height: '35%',
            label: ' 录音状态 ',
            border: {
                type: 'line'
            },
            style: {
                border: {
                    fg: 'magenta'
                }
            },
            tags: true,
            scrollable: true
        });

        this.monitorBox = blessed.box({
            top: 1,
            left: '67%',
            width: '33%',
            height: '35%',
            label: ' 系统监控 ',
            border: {
                type: 'line'
            },
            style: {
                border: {
                    fg: 'yellow'
                }
            },
            tags: true,
            scrollable: true
        });

        this.logBox = blessed.log({
            top: '35%+1',
            left: 0,
            width: '100%',
            height: '65%-3',  // 底部留 1 行给输入栏
            label: ' 事件日志 ',
            border: {
                type: 'line'
            },
            style: {
                border: {
                    fg: 'yellow'
                }
            },
            tags: true,
            scrollable: true,
            focusable: true,
            scrollbar: {
                ch: ' ',
                track: {
                    bg: 'black'
                },
                style: {
                    inverse: true
                }
            },
            bufferLength: this.maxLogLines
        });

        this.screen.append(this.headerBox);
        this.screen.append(this.connectionBox);
        this.screen.append(this.recordingBox);
        this.screen.append(this.monitorBox);
        this.screen.append(this.logBox);

        this.logBox.focus();

        this.screen.key(['q', 'C-c'], () => {
            if (this.keyboardMode !== 'input') {  // 输入模式下禁止退出，防止误触
                this.destroy();
                process.exit(0);
            }
        });

        this._bindScrollKeys();

        this.screen.render();
        this._startTrimTimer();
    }

    updateConnectionState(state) {
        if (!this.enabled) return;
        const connIcon = state.connected ? '{green-fg}OK{/green-fg}' : '{red-fg}NO{/red-fg}';
        const lines = [
            ` 服务器: ${state.connected ? '已连接' : '未连接'} ${connIcon}`,
            ` 地址: ${state.serverUrl || '-'}`,
            ` 显示端ID: ${state.displayId || '-'}`,
            ` 心跳: ${state.heartbeatStatus || '-'}`,
            ` 重连: ${state.reconnectAttempts || 0}/${state.maxReconnectAttempts || 5}`
        ];
        this.connectionBox.setContent(lines.join('\n'));
        this._scheduleRender();
    }

    updateRecordingState(state) {
        if (!this.enabled) return;
        const recIcon = state.recordingEnabled ? '{green-fg}ON{/green-fg}' : '{yellow-fg}OFF{/yellow-fg}';
        const asrIcon = state.asrReady ? '{green-fg}OK{/green-fg}' : '{red-fg}NO{/red-fg}';
        const lines = [
            ` 录音: ${state.recordingEnabled ? '开启' : '暂停'} ${recIcon}`,
            ` ASR: ${state.asrReady ? '就绪' : '不可用'} ${asrIcon}`,
            ` VAD: ${state.vadStatus || '-'}`,
            ` 播放队列: ${state.playQueueSize || 0}`,
            ` 最近识别: ${state.lastRecognition || '-'}`
        ];
        this.recordingBox.setContent(lines.join('\n'));
        this._scheduleRender();
    }

    updateSystemStats(stats) {
        if (!this.enabled) return;
        this.systemStats = stats;

        const cpu = stats.cpu || {};
        const mem = stats.memory || {};
        const uptime = stats.uptime || {};
        const cpuUsage = parseFloat(cpu.usage || 0);
        const memUsage = parseFloat(mem.usagePercent || 0);
        const cpuColor = cpuUsage > 80 ? 'red' : cpuUsage > 50 ? 'yellow' : 'green';
        const memColor = memUsage > 80 ? 'red' : memUsage > 50 ? 'yellow' : 'green';

        const lines = [
            ` {bold}CPU:{/bold} {${cpuColor}-fg}${cpuUsage}%{/${cpuColor}-fg}`,
            ` {bold}核心:{/bold} ${cpu.count || '-'}`,
            ` {bold}负载:{/bold} ${(cpu.loadAvg?.['1m'] || 0).toFixed(2)}`,
            ` {bold}内存:{/bold} {${memColor}-fg}${memUsage}%{/${memColor}-fg}`,
            ` {bold}已用:{/bold} ${formatMemory(mem.used)}/${formatMemory(mem.total)}`,
            ` {bold}进程RSS:{/bold} ${formatMemory(mem.process?.rss || 0)}`,
            ` {bold}堆内存:{/bold} ${formatMemory(mem.process?.heapUsed || 0)}/${formatMemory(mem.process?.heapTotal || 0)}`,
            ` {bold}系统运行:{/bold} ${formatUptime(uptime.system || 0)}`,
            ` {bold}进程运行:{/bold} ${formatUptime(uptime.process || 0)}`
        ];
        this.monitorBox.setContent(lines.join('\n'));
        this._scheduleRender();
    }

    addLog(category, message) {
        if (!this.enabled) return;
        const timestamp = getTimestamp();
        const color = getCategoryColor(category);
        const tag = `[${category}]`;

        this.logBuffer.push({ timestamp, category, message, color, tag });
        if (this.logBuffer.length > this.maxLogBuffer) {
            this.logBuffer.splice(0, this.logBuffer.length - this.maxLogBuffer);
        }

        this.logBox.log(`{${color}-fg}${timestamp} ${tag}{/${color}-fg} ${message}`);
        this._scheduleRender();

        this._logCount++;
        if (this._logCount % 200 === 0) {
            this._trimLogBox();
        }
    }

    _bindScrollKeys() {
        this.screen.key(['up'], () => {
            this.logBox.scroll(-1);
            this._scheduleRender();
        });
        this.screen.key(['down'], () => {
            this.logBox.scroll(1);
            this._scheduleRender();
        });
        this.screen.key(['pageup'], () => {
            this.logBox.scroll(-(this.logBox.height - 2));
            this._scheduleRender();
        });
        this.screen.key(['pagedown'], () => {
            this.logBox.scroll(this.logBox.height - 2);
            this._scheduleRender();
        });
        this.screen.key(['home'], () => {
            this.logBox.scrollTo(0);
            this._scheduleRender();
        });
        this.screen.key(['end'], () => {
            this.logBox.scrollTo(this.logBox.getScrollHeight());
            this._scheduleRender();
        });
    }

    _trimLogBox() {
        if (!this.enabled || !this.logBox) return;

        const lineCount = this.logBox._clines ? this.logBox._clines.length : 0;
        const threshold = Math.floor(this.maxLogLines * 1.5);
        if (lineCount <= threshold) return;

        this.logBox.setContent('');

        const recentBuffer = this.logBuffer.slice(-this.maxLogLines);
        recentBuffer.forEach(e => {
            this.logBox.log(`{${e.color}-fg}${e.timestamp} ${e.tag}{/${e.color}-fg} ${e.message}`);
        });

        this._scheduleRender();
    }

    _startTrimTimer() {
        this._trimTimer = setInterval(() => {
            this._trimLogBox();
        }, 60000);
    }

    _scheduleRender() {
        if (this.renderPending) return;
        this.renderPending = true;
        setImmediate(() => {
            if (!this.enabled) return;
            try {
                this.screen.render();
            } catch (e) {
                // 忽略渲染错误
            }
            this.renderPending = false;
        });
    }

    /**
     * 初始化底部文本输入行
     * 用于在 TUI 底栏输入文本，按 Enter 发送走 voiceInput 流程
     * @param {Function} onSendCallback - 发送文本的回调，接收 (text) => void
     */
    initChatInputBar(onSendCallback) {
        if (!this.enabled) return;

        this.onSendText = onSendCallback;
        this.keyboardMode = 'browse';  // 初始为浏览模式

        this.inputBox = blessed.textarea({
            bottom: 0,
            left: 0,
            width: '100%',
            height: 1,
            placeholder: '输入文本后 Enter 发送 (Tab 切换焦点)',
            inputOnFocus: true,
            style: {
                bg: 'blue',
                fg: 'white',
                focus: { bg: 'green', fg: 'black' }
            }
        });

        this.screen.append(this.inputBox);

        // Tab 切换焦点：浏览模式 ↔ 输入模式
        this.screen.key(['tab', 'S-tab'], () => {
            if (this.keyboardMode === 'browse') {
                this.keyboardMode = 'input';
                this.inputBox.focus();
            } else {
                this.keyboardMode = 'browse';
                this.logBox.focus();
            }
            this.screen.render();
        });

        // Enter 发送文本（绑定到输入框本身，避免被 inputOnFocus 截获）
        this.inputBox.key(['enter'], () => {
            const text = this.inputBox.getValue().trim();
            if (text.length > 0 && this.onSendText) {
                this.onSendText(text);
            }
            this.inputBox.clearValue();
            this.screen.render();
            return false;  // 阻止 textarea 默认的换行行为
        });

        // Esc 从输入模式退回浏览模式
        this.screen.key(['escape'], () => {
            if (this.keyboardMode === 'input') {
                this.keyboardMode = 'browse';
                this.logBox.focus();
                this.inputBox.clearValue();
                this.screen.render();
            }
        });

        this.screen.render();
    }

    destroy() {
        if (!this.enabled) return;
        if (this._trimTimer) {
            clearInterval(this._trimTimer);
            this._trimTimer = null;
        }
        try {
            this.screen.destroy();
        } catch (e) {
            // 忽略销毁错误
        }
        this.logBuffer = [];
        this.systemStats = null;
        this.headerBox = null;
        this.connectionBox = null;
        this.recordingBox = null;
        this.monitorBox = null;
        this.logBox = null;
        this.screen = null;
        this.enabled = false;
    }
}

module.exports = SubDisplayTUI;
