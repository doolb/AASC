const blessed = require('blessed');

const CATEGORY_COLORS = {
    '连接': 'green',
    '断开': 'red',
    '语音': 'cyan',
    'TTS': 'yellow',
    '提醒': 'magenta',
    '设备': 'blue',
    '能力': 'blue',
    '错误': 'red',
    '系统': 'white',
    '静音': 'yellow',
    '子显示端': 'blue',
    'AASC': 'green',
    '媒体库': 'green',
    '整点报时': 'yellow',
    'Chat': 'cyan',
    'Commands': 'cyan',
    '配置': 'white',
    '内存': 'gray'
};

function getCategoryColor(category) {
    return CATEGORY_COLORS[category] || 'white';
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

function formatCapabilities(caps) {
    if (!caps) return '-';
    const icons = [];
    if (caps.mediaRendering) icons.push('M');
    if (caps.voicePlayback) icons.push('P');
    if (caps.voiceRecording) icons.push('R');
    if (caps.voiceRecognition) icons.push('A');
    if (caps.displayText) icons.push('T');
    return icons.join(',') || '-';
}

function formatMemory(bytes) {
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

function getTimestamp() {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
}

class ServerTUI {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        if (!this.enabled) return;

        this.maxLogLines = options.maxLogLines || 500;
        this.refreshTimer = null;
        this.renderPending = false;
        this._initScreen();
    }

    _initScreen() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Web MediaCenter Server',
            fullUnicode: true,
            dockBorders: true
        });

        this.headerBox = blessed.box({
            top: 0,
            left: 0,
            width: '100%',
            height: 1,
            style: {
                bg: 'blue',
                fg: 'white',
                bold: true
            },
            content: ' Web MediaCenter Server - Starting...'
        });

        this.statusBox = blessed.box({
            top: 1,
            left: 0,
            width: '30%',
            height: '40%',
            label: ' 系统状态 ',
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

        this.deviceTable = blessed.box({
            top: 1,
            left: '30%',
            width: '70%',
            height: '40%',
            label: ' 设备列表 ',
            border: {
                type: 'line'
            },
            style: {
                border: {
                    fg: 'green'
                },
                header: {
                    fg: 'white',
                    bg: 'blue',
                    bold: true
                },
                cell: {
                    fg: 'white'
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
        this.screen.append(this.statusBox);
        this.screen.append(this.deviceTable);
        this.screen.append(this.logBox);

        this.screen.key(['q', 'C-c'], () => {
            this.destroy();
            process.exit(0);
        });

        this.screen.render();
    }

    setHeader(protocol, ip, port) {
        if (!this.enabled) return;
        this.headerBox.setContent(` Web MediaCenter Server - ${protocol}://${ip}:${port} `);
        this._scheduleRender();
    }

    updateStatus(data) {
        if (!this.enabled) return;
        const lines = [
            ` {bold}运行时间:{/bold} ${formatUptime(data.uptime)}`,
            ` {bold}内存 RSS:{/bold} ${formatMemory(data.memoryRSS)}`,
            ` {bold}内存 Heap:{/bold} ${formatMemory(data.memoryHeapUsed)}/${formatMemory(data.memoryHeapTotal)}`,
            ` {bold}协议:{/bold} ${data.protocol}`,
            ` {bold}静音:{/bold} ${data.isMuted ? '{red-fg}是{/red-fg}' : '{green-fg}否{/green-fg}'}`,
            ` {bold}显示端:{/bold} ${data.displayCount}`,
            ` {bold}控制端:{/bold} ${data.controlCount}`
        ];
        this.statusBox.setContent(lines.join('\n'));
        this._scheduleRender();
    }

    updateDeviceList(devices) {
        if (!this.enabled) return;
        if (!devices || !Array.isArray(devices)) {
            this.deviceTable.setContent(' ID         IP              类型     能力');
            this._scheduleRender();
            return;
        }

        const header = ' ID         IP              类型     能力';
        const filteredDevices = devices.filter(d => d != null);
        const rows = filteredDevices.map((d) => {
            const typeStr = d.isSubDisplay ? '子显示' : '显示端';
            const caps = d.capabilities || {};
            const id = (d.id != null && d.id !== undefined) ? String(d.id) : '-';
            const ip = (d.ip != null && d.ip !== undefined) ? String(d.ip) : '-';

            return [
                id.padEnd(10),
                ip.padEnd(15),
                typeStr.padEnd(6),
                formatCapabilities(caps)
            ].join(' ');
        });

        this.deviceTable.setContent([header, ...rows].join('\n'));
        this._scheduleRender();
    }

    addLog(category, message) {
        if (!this.enabled) return;
        const timestamp = getTimestamp();
        const color = getCategoryColor(category);
        const tag = `[${category}]`;
        this.logBox.log(`{${color}-fg}${timestamp} ${tag}{/${color}-fg} ${message}`);
        this._scheduleRender();
    }

    startRefresh(getStatus, getDevices) {
        if (!this.enabled) return;
        this.refreshTimer = setInterval(() => {
            try {
                const status = getStatus();
                this.updateStatus(status);
                const devices = getDevices();
                this.updateDeviceList(devices);
            } catch (e) {
                // 静默忽略刷新错误
            }
        }, 2000);
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
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        try {
            this.screen.destroy();
        } catch (e) {
            // 忽略销毁错误
        }
        this.enabled = false;
    }
}

module.exports = ServerTUI;
