const blessed = require('blessed');

const CATEGORY_COLORS = {
    '连接': 'green',
    '断开': 'red',
    '语音': 'cyan',
    'TTS': 'yellow',
    '提醒': 'magenta',
    '录音': 'blue',
    'ASR': 'cyan',
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
            width: '50%',
            height: '40%',
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
            left: '50%',
            width: '50%',
            height: '40%',
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

        this.logBox = blessed.log({
            top: '40%+1',
            left: 0,
            width: '100%',
            height: '60%-2',
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
        this.screen.append(this.logBox);

        this.logBox.focus();

        this.screen.key(['q', 'C-c'], () => {
            this.destroy();
            process.exit(0);
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
        this.headerBox = null;
        this.connectionBox = null;
        this.recordingBox = null;
        this.logBox = null;
        this.screen = null;
        this.enabled = false;
    }
}

module.exports = SubDisplayTUI;
