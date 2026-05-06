const blessed = require('blessed');

const CATEGORY_COLORS = {
    '连接': 'green',
    '断开': 'red',
    '语音': 'cyan',
    '语音输入': 'cyan',
    '语音命令': 'green',
    'TTS': 'yellow',
    '提醒': 'magenta',
    '设备': 'blue',
    '能力': 'blue',
    '错误': 'red',
    '系统': 'gray',
    '静音': 'yellow',
    '子显示端': 'blue',
    'AASC': 'green',
    'ASR子进程': 'cyan',
    '媒体库': 'green',
    '整点报时': 'yellow',
    'Chat': 'cyan',
    'Commands': 'cyan',
    '配置': 'gray',
    '内存': 'gray'
};

function getCategoryColor(category) {
    return CATEGORY_COLORS[category] || 'gray';
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
    const items = [];
    if (caps.mediaRendering) items.push('媒体');
    if (caps.voicePlayback) items.push('播放');
    if (caps.voiceRecording) items.push('录音');
    if (caps.voiceRecognition) items.push('识别');
    if (caps.displayText) items.push('文字');
    return items.join(',') || '-';
}

function formatMemory(bytes) {
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

function getTimestamp() {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
}

function displayWidth(str) {
    let width = 0;
    for (const ch of str) {
        const code = ch.codePointAt(0);
        if (code >= 0x1100 && (
            code <= 0x115F ||
            code === 0x2329 || code === 0x232A ||
            (code >= 0x2E80 && code <= 0xA4CF && code !== 0x303F) ||
            (code >= 0xAC00 && code <= 0xD7A3) ||
            (code >= 0xF900 && code <= 0xFAFF) ||
            (code >= 0xFE10 && code <= 0xFE19) ||
            (code >= 0xFE30 && code <= 0xFE6F) ||
            (code >= 0xFF01 && code <= 0xFF60) ||
            (code >= 0xFFE0 && code <= 0xFFE6) ||
            (code >= 0x1F300 && code <= 0x1F9FF) ||
            (code >= 0x20000 && code <= 0x2FFFD) ||
            (code >= 0x30000 && code <= 0x3FFFD)
        )) {
            width += 2;
        } else {
            width += 1;
        }
    }
    return width;
}

function padEndDisplay(str, targetWidth) {
    const currentWidth = displayWidth(str);
    const padding = Math.max(0, targetWidth - currentWidth);
    return str + ' '.repeat(padding);
}

const LEVEL_MAP = {
    '错误': 'error', '断开': 'warn', '静音': 'warn',
    '连接': 'info', '语音': 'info', 'TTS': 'info', '提醒': 'info',
    '设备': 'info', '能力': 'info', '系统': 'info', '子显示端': 'info',
    'AASC': 'info', '媒体库': 'info', '整点报时': 'info',
    'Chat': 'info', 'Commands': 'info', '配置': 'debug', '内存': 'debug'
};

class ServerTUI {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        if (!this.enabled) return;

        this.maxLogLines = options.maxLogLines || 500;
        this.refreshTimer = null;
        this.renderPending = false;
        this.logBuffer = [];
        this.maxLogBuffer = 2000;
        this.systemStats = null;

        this.filterMode = 'level';
        this.filterModes = ['level', 'category'];
        this.levelFilter = 'all';
        this.levelFilterOptions = ['all', 'error', 'warn', 'info', 'debug'];
        this.levelFilterLabels = { all: '全部', error: '错误', warn: '警告', info: '信息', debug: '调试' };
        this.categoryFilter = 'all';
        this.categoryFilterOptions = ['all'];
        this.categoryFilterLabels = { all: '全部' };
        this.knownCategories = new Set();

        this._logCount = 0;
        this._trimTimer = null;

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
            height: '50%',
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
            height: '50%',
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
            top: '50%+1',
            left: 0,
            width: '100%',
            height: '50%-2',
            label: ' 事件日志 [级别:全部] ',
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
        this.screen.append(this.statusBox);
        this.screen.append(this.deviceTable);
        this.screen.append(this.logBox);

        this.logBox.focus();

        this.screen.key(['q', 'C-c'], () => {
            this.destroy();
            process.exit(0);
        });

        this.screen.key(['left'], () => {
            if (this.filterMode === 'level') {
                const idx = this.levelFilterOptions.indexOf(this.levelFilter);
                const newIdx = (idx - 1 + this.levelFilterOptions.length) % this.levelFilterOptions.length;
                this.setLevelFilter(this.levelFilterOptions[newIdx]);
            } else {
                const idx = this.categoryFilterOptions.indexOf(this.categoryFilter);
                const newIdx = (idx - 1 + this.categoryFilterOptions.length) % this.categoryFilterOptions.length;
                this.setCategoryFilter(this.categoryFilterOptions[newIdx]);
            }
        });
        this.screen.key(['right'], () => {
            if (this.filterMode === 'level') {
                const idx = this.levelFilterOptions.indexOf(this.levelFilter);
                const newIdx = (idx + 1) % this.levelFilterOptions.length;
                this.setLevelFilter(this.levelFilterOptions[newIdx]);
            } else {
                const idx = this.categoryFilterOptions.indexOf(this.categoryFilter);
                const newIdx = (idx + 1) % this.categoryFilterOptions.length;
                this.setCategoryFilter(this.categoryFilterOptions[newIdx]);
            }
        });
        this.screen.key(['tab'], () => {
            const idx = this.filterModes.indexOf(this.filterMode);
            this.filterMode = this.filterModes[(idx + 1) % this.filterModes.length];
            this._updateLogLabel();
        });

        this._bindScrollKeys();

        this.screen.render();
        this._startTrimTimer();
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

        if (data.llmApiUrl) {
            lines.push('');
            lines.push('{bold}── LLM ──{/bold}');
            lines.push(` {bold}配置:{/bold} ${data.llmProfile || '-'}`);
            lines.push(` {bold}API:{/bold} ${data.llmApiUrl}`);
            lines.push(` {bold}模型:{/bold} ${data.llmModel || '-'}`);
        }

        if (this.systemStats) {
            const cpu = this.systemStats.cpu || {};
            const mem = this.systemStats.memory || {};
            const cpuUsage = parseFloat(cpu.usage || 0);
            const memUsage = parseFloat(mem.usagePercent || 0);
            const cpuColor = cpuUsage > 80 ? 'red' : cpuUsage > 50 ? 'yellow' : 'green';
            const memColor = memUsage > 80 ? 'red' : memUsage > 50 ? 'yellow' : 'green';

            lines.push('');
            lines.push('{bold}── 系统监控 ──{/bold}');
            lines.push(` {bold}CPU:{/bold} {${cpuColor}-fg}${cpuUsage}%{/${cpuColor}-fg} (${cpu.count || '-'}核)`);
            lines.push(` {bold}内存:{/bold} {${memColor}-fg}${memUsage}%{/${memColor}-fg} (${formatMemory(mem.used)}/${formatMemory(mem.total)})`);
            lines.push(` {bold}系统运行:{/bold} ${formatUptime(this.systemStats.uptime?.system || 0)}`);
            lines.push(` {bold}负载:{/bold} ${(cpu.loadAvg?.['1m'] || 0).toFixed(2)} ${(cpu.loadAvg?.['5m'] || 0).toFixed(2)} ${(cpu.loadAvg?.['15m'] || 0).toFixed(2)}`);
        }

        this.statusBox.setContent(lines.join('\n'));
        this._scheduleRender();
    }

    updateSystemStats(stats) {
        if (!this.enabled) return;
        this.systemStats = stats;
    }

    updateDeviceList(devices) {
        if (!this.enabled) return;
        if (!devices || !Array.isArray(devices)) {
            this.deviceTable.setContent(' ID         IP              类型       能力');
            this._scheduleRender();
            return;
        }

        const header = ' ID         IP              类型       能力';
        const filteredDevices = devices.filter(d => d != null);
        const rows = filteredDevices.map((d) => {
            const typeStr = d.isSubDisplay ? '子显示' : '显示端';
            const caps = d.capabilities || {};
            const id = (d.id != null && d.id !== undefined) ? String(d.id) : '-';
            const ip = (d.ip != null && d.ip !== undefined) ? String(d.ip) : '-';

            return [
                padEndDisplay(id, 10),
                padEndDisplay(ip, 15),
                padEndDisplay(typeStr, 10),
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
        const level = LEVEL_MAP[category] || 'info';

        this.logBuffer.push({ timestamp, category, message, level, color, tag });
        if (this.logBuffer.length > this.maxLogBuffer) {
            this.logBuffer.splice(0, this.logBuffer.length - this.maxLogBuffer);
        }

        if (!this.knownCategories.has(category)) {
            this.knownCategories.add(category);
            this.categoryFilterOptions = ['all', ...Array.from(this.knownCategories).sort()];
            this.categoryFilterLabels = { all: '全部' };
            this.categoryFilterOptions.forEach(c => {
                if (c !== 'all') this.categoryFilterLabels[c] = c;
            });
        }

        if (this._matchesFilter(level, category)) {
            this.logBox.log(`{${color}-fg}${timestamp} ${tag}{/${color}-fg} ${message}`);
            this._scheduleRender();
        }

        this._logCount++;
        if (this._logCount % 200 === 0) {
            this._trimLogBox();
        }
    }

    _matchesFilter(level, category) {
        if (this.levelFilter !== 'all' && this.levelFilter !== level) return false;
        if (this.categoryFilter !== 'all' && this.categoryFilter !== category) return false;
        return true;
    }

    setLevelFilter(filter) {
        if (!this.enabled) return;
        if (!this.levelFilterOptions.includes(filter)) return;
        this.levelFilter = filter;
        this._reapplyFilter();
    }

    setCategoryFilter(filter) {
        if (!this.enabled) return;
        if (!this.categoryFilterOptions.includes(filter)) return;
        this.categoryFilter = filter;
        this._reapplyFilter();
    }

    _reapplyFilter() {
        this.logBox.setContent('');
        const recentBuffer = this.logBuffer.slice(-this.maxLogLines);
        const filtered = recentBuffer.filter(e => this._matchesFilter(e.level, e.category));
        filtered.forEach(e => {
            this.logBox.log(`{${e.color}-fg}${e.timestamp} ${e.tag}{/${e.color}-fg} ${e.message}`);
        });
        this._updateLogLabel();
        this._scheduleRender();
    }

    _updateLogLabel() {
        const modeLabel = this.filterMode === 'level' ? '级别' : '类别';
        let valueLabel;
        if (this.filterMode === 'level') {
            valueLabel = this.levelFilterLabels[this.levelFilter] || '全部';
        } else {
            valueLabel = this.categoryFilterLabels[this.categoryFilter] || '全部';
        }
        this.logBox.setLabel(` 事件日志 [${modeLabel}:${valueLabel}] `);
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
            if (this._matchesFilter(e.level, e.category)) {
                this.logBox.log(`{${e.color}-fg}${e.timestamp} ${e.tag}{/${e.color}-fg} ${e.message}`);
            }
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
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
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
        this.statusBox = null;
        this.deviceTable = null;
        this.logBox = null;
        this.screen = null;
        this.enabled = false;
    }
}

module.exports = ServerTUI;
