const LogViewer = {
    entries: [],
    filteredEntries: [],
    categories: [],
    autoScroll: true,
    maxDisplayEntries: 500,
    _correlationStacks: new Map(),

    filters: {
        search: '',
        levels: [],
        devices: [],
        categories: [],
        timeRange: 'all'
    },

    LEVEL_OPTIONS: [
        { value: 'error', label: '错误', color: '#ef4444' },
        { value: 'warn', label: '警告', color: '#f59e0b' },
        { value: 'info', label: '信息', color: '#3b82f6' },
        { value: 'debug', label: '调试', color: '#6b7280' }
    ],

    DEVICE_OPTIONS: [
        { value: 'server', label: '服务端' },
        { value: 'display', label: '显示端' },
        { value: 'control', label: '控制端' }
    ],

    TIME_RANGE_OPTIONS: [
        { value: 'all', label: '全部' },
        { value: '10s', label: '10秒' },
        { value: '30s', label: '30秒' },
        { value: '1m', label: '1分钟' },
        { value: '5m', label: '5分钟' },
        { value: '10m', label: '10分钟' },
        { value: '30m', label: '30分钟' },
        { value: '1h', label: '1小时' }
    ],

    init() {
        this._bindEvents();
        this._renderFilterBar();
    },

    _bindEvents() {
        const searchInput = document.getElementById('logSearchInput');
        if (searchInput) {
            let debounceTimer;
            searchInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this.filters.search = searchInput.value;
                    this.applyFilters();
                }, 300);
            });
        }

        const logContainer = document.getElementById('logEntries');
        if (logContainer) {
            logContainer.addEventListener('scroll', () => {
                const el = logContainer;
                this.autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
                const autoScrollBtn = document.getElementById('logAutoScrollBtn');
                if (autoScrollBtn) {
                    autoScrollBtn.classList.toggle('active', this.autoScroll);
                }
            });
        }
    },

    _renderFilterBar() {
        this._renderLevelFilters();
        this._renderDeviceFilters();
        this._renderCategoryFilters();
        this._renderTimeRangeFilter();
    },

    _renderLevelFilters() {
        const container = document.getElementById('logLevelFilters');
        if (!container) return;
        container.innerHTML = this.LEVEL_OPTIONS.map(opt =>
            `<button class="log-filter-btn log-filter-level" data-value="${opt.value}" style="--filter-color: ${opt.color}" onclick="LogViewer.toggleFilter('levels', '${opt.value}')">${opt.label}</button>`
        ).join('');
    },

    _renderDeviceFilters() {
        const container = document.getElementById('logDeviceFilters');
        if (!container) return;
        container.innerHTML = this.DEVICE_OPTIONS.map(opt =>
            `<button class="log-filter-btn log-filter-device" data-value="${opt.value}" onclick="LogViewer.toggleFilter('devices', '${opt.value}')">${opt.label}</button>`
        ).join('');
    },

    _renderCategoryFilters() {
        const container = document.getElementById('logCategoryFilters');
        if (!container) return;
        if (this.categories.length === 0) {
            container.innerHTML = '<span class="log-filter-hint">等待日志数据...</span>';
            return;
        }
        container.innerHTML = this.categories.map(cat =>
            `<button class="log-filter-btn log-filter-category" data-value="${cat}" onclick="LogViewer.toggleFilter('categories', '${cat}')">[${cat}]</button>`
        ).join('');
    },

    _renderTimeRangeFilter() {
        const select = document.getElementById('logTimeRange');
        if (!select) return;
        select.innerHTML = this.TIME_RANGE_OPTIONS.map(opt =>
            `<option value="${opt.value}">${opt.label}</option>`
        ).join('');
        select.addEventListener('change', () => {
            this.filters.timeRange = select.value;
            this.applyFilters();
        });
    },

    toggleFilter(filterType, value) {
        const idx = this.filters[filterType].indexOf(value);
        if (idx >= 0) {
            this.filters[filterType].splice(idx, 1);
        } else {
            this.filters[filterType].push(value);
        }
        this._updateFilterButtons(filterType);
        this.applyFilters();
    },

    _updateFilterButtons(filterType) {
        const classMap = {
            levels: 'log-filter-level',
            devices: 'log-filter-device',
            categories: 'log-filter-category'
        };
        const className = classMap[filterType];
        if (!className) return;
        document.querySelectorAll(`.${className}`).forEach(btn => {
            const value = btn.dataset.value;
            btn.classList.toggle('active', this.filters[filterType].includes(value));
        });
    },

    addEntry(entry) {
        this.entries.push(entry);
        if (this.entries.length > this.maxDisplayEntries * 2) {
            this.entries = this.entries.slice(-this.maxDisplayEntries);
        }
        if (!this.categories.includes(entry.category)) {
            this.categories.push(entry.category);
            this.categories.sort();
            this._renderCategoryFilters();
        }
        if (this._matchesFilters(entry)) {
            this.filteredEntries.push(entry);
            if (this.filteredEntries.length > this.maxDisplayEntries) {
                this.filteredEntries.shift();
            }
            this._appendEntry(entry);
        }
        this._updateCount();
    },

    addHistory(entries, categories) {
        this.entries = entries.slice(-this.maxDisplayEntries);
        if (categories && categories.length > 0) {
            this.categories = categories.sort();
            this._renderCategoryFilters();
        }
        this.applyFilters();
    },

    applyFilters() {
        this.filteredEntries = this.entries.filter(entry => this._matchesFilters(entry));
        if (this.filteredEntries.length > this.maxDisplayEntries) {
            this.filteredEntries = this.filteredEntries.slice(-this.maxDisplayEntries);
        }
        this._resetCorrelationStacks();
        this._renderEntries();
        this._updateCount();
    },

    _matchesFilters(entry) {
        if (this.filters.search) {
            const searchLower = this.filters.search.toLowerCase();
            if (!entry.message.toLowerCase().includes(searchLower) &&
                !entry.category.toLowerCase().includes(searchLower)) {
                return false;
            }
        }
        if (this.filters.levels.length > 0 && !this.filters.levels.includes(entry.level)) {
            return false;
        }
        if (this.filters.devices.length > 0 && !this.filters.devices.includes(entry.device)) {
            return false;
        }
        if (this.filters.categories.length > 0 && !this.filters.categories.includes(entry.category)) {
            return false;
        }
        if (this.filters.timeRange && this.filters.timeRange !== 'all') {
            const now = Date.now();
            const rangeMs = this._parseTimeRange(this.filters.timeRange);
            if (rangeMs > 0 && entry.timestamp < now - rangeMs) {
                return false;
            }
        }
        return true;
    },

    _parseTimeRange(range) {
        const map = {
            '10s': 10 * 1000,
            '30s': 30 * 1000,
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '10m': 10 * 60 * 1000,
            '30m': 30 * 60 * 1000,
            '1h': 60 * 60 * 1000
        };
        return map[range] || 0;
    },

    _renderEntries() {
        const container = document.getElementById('logEntries');
        if (!container) return;

        if (this.filteredEntries.length === 0) {
            container.innerHTML = '<div class="log-empty">暂无日志</div>';
            return;
        }

        const fragment = document.createDocumentFragment();
        this.filteredEntries.forEach(entry => {
            fragment.appendChild(this._createEntryElement(entry));
        });
        container.innerHTML = '';
        container.appendChild(fragment);

        if (this.autoScroll) {
            container.scrollTop = container.scrollHeight;
        }
    },

    _appendEntry(entry) {
        const container = document.getElementById('logEntries');
        if (!container) return;

        const emptyEl = container.querySelector('.log-empty');
        if (emptyEl) emptyEl.remove();

        container.appendChild(this._createEntryElement(entry));

        while (container.children.length > this.maxDisplayEntries) {
            container.removeChild(container.firstChild);
        }

        if (this.autoScroll) {
            container.scrollTop = container.scrollHeight;
        }
    },

    _resetCorrelationStacks() {
        this._correlationStacks.clear();
    },

    _createEntryElement(entry) {
        const div = document.createElement('div');
        const indentClass = this._getIndentClass(entry);
        div.className = `log-entry log-level-${entry.level}${indentClass}`;
        div.dataset.level = entry.level;
        div.dataset.device = entry.device;
        div.dataset.category = entry.category;
        if (entry.source) div.dataset.source = entry.source;
        if (entry.targetId) div.dataset.targetId = entry.targetId;
        if (entry.correlationId) div.dataset.correlationId = entry.correlationId;

        const levelClass = `log-level-badge log-level-badge-${entry.level}`;
        const deviceLabel = this._getDeviceLabel(entry.device);
        const arrowMsg = this._getArrowMessage(entry);

        div.innerHTML =
            `<span class="log-time">${this._escapeHtml(entry.time)}</span>` +
            `<span class="${levelClass}">${this._getLevelLabel(entry.level)}</span>` +
            `<span class="log-category">[${this._escapeHtml(entry.category)}]</span>` +
            `<span class="log-device">${deviceLabel}</span>` +
            `<span class="log-message">${arrowMsg}</span>`;

        return div;
    },

    _getLevelLabel(level) {
        const map = { error: '错误', warn: '警告', info: '信息', debug: '调试' };
        return map[level] || level;
    },

    _getIdLabel(id) {
        if (!id) return '';
        const labelMap = { server: '服务端', control: '控制端', 'all-control': '控制端' };
        if (labelMap[id]) return labelMap[id];
        const colonIdx = id.indexOf(':');
        const clean = colonIdx > 0 ? id.slice(colonIdx + 1) : id;
        const dotIdx = clean.lastIndexOf('.');
        return dotIdx > 0 ? clean.slice(dotIdx + 1) : clean;
    },

    _getArrowHtml(entry) {
        const src = this._getIdLabel(entry.source);
        const tgt = this._getIdLabel(entry.targetId);
        if (!src && !tgt) return '';
        if (src && tgt) {
            return `${this._escapeHtml(src)} <span class="log-arrow-sym">⇒</span> ${this._escapeHtml(tgt)}`;
        }
        return src ? `[${this._escapeHtml(src)}]` : `→ ${this._escapeHtml(tgt)}`;
    },

    _getIndentClass(entry) {
        if (!entry.correlationId) return '';
        if (!entry.source && !entry.targetId) return '';

        let stack = this._correlationStacks.get(entry.correlationId);
        if (!stack) {
            stack = [];
            this._correlationStacks.set(entry.correlationId, stack);
        }

        if (stack.length === 0) {
            stack.push({ source: entry.source, target: entry.targetId });
            return '';
        }

        const last = stack[stack.length - 1];
        if (entry.source === last.target) {
            const depth = Math.min(stack.length, 4);
            stack.push({ source: entry.source, target: entry.targetId });
            return ` log-indent-${depth}`;
        }

        for (let i = stack.length - 2; i >= 0; i--) {
            if (entry.source === stack[i].target) {
                stack.splice(i + 1);
                const depth = Math.min(i + 1, 4);
                stack.push({ source: entry.source, target: entry.targetId });
                return ` log-indent-${depth}`;
            }
        }

        stack.length = 0;
        stack.push({ source: entry.source, target: entry.targetId });
        return '';
    },

    _getArrowMessage(entry) {
        const arrow = this._getArrowHtml(entry);
        const escapedMsg = this._highlightSearch(this._escapeHtml(entry.message));
        if (!arrow) return escapedMsg;
        const src = this._getIdLabel(entry.source);
        const tgt = this._getIdLabel(entry.targetId);
        if (src && tgt) {
            return `<span class="log-arrow">${arrow}:</span> ${escapedMsg}`;
        }
        if (src) {
            return `<span class="log-arrow">${arrow}</span> ${escapedMsg}`;
        }
        return `<span class="log-arrow">${arrow}:</span> ${escapedMsg}`;
    },

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    _highlightSearch(text) {
        if (!this.filters.search) return text;
        const search = this.filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(new RegExp(`(${search})`, 'gi'), '<mark>$1</mark>');
    },

    _updateCount() {
        const countEl = document.getElementById('logCount');
        if (countEl) {
            countEl.textContent = `${this.filteredEntries.length}/${this.entries.length}`;
        }
    },

    toggleAutoScroll() {
        this.autoScroll = !this.autoScroll;
        const btn = document.getElementById('logAutoScrollBtn');
        if (btn) btn.classList.toggle('active', this.autoScroll);
        if (this.autoScroll) {
            const container = document.getElementById('logEntries');
            if (container) container.scrollTop = container.scrollHeight;
        }
    },

    clearLogs() {
        this.entries = [];
        this.filteredEntries = [];
        this._correlationStacks.clear();
        const container = document.getElementById('logEntries');
        if (container) container.innerHTML = '<div class="log-empty">暂无日志</div>';
        this._updateCount();
    },

    clearFilters() {
        this.filters = {
            search: '',
            levels: [],
            devices: [],
            categories: [],
            timeRange: 'all'
        };
        const searchInput = document.getElementById('logSearchInput');
        if (searchInput) searchInput.value = '';
        const timeRange = document.getElementById('logTimeRange');
        if (timeRange) timeRange.value = 'all';
        document.querySelectorAll('.log-filter-btn').forEach(btn => btn.classList.remove('active'));
        this.applyFilters();
    },

    updateSystemStats(stats) {
        const container = document.getElementById('systemStats');
        if (!container) return;

        const cpu = stats.cpu || {};
        const mem = stats.memory || {};
        const uptime = stats.uptime || {};

        container.innerHTML =
            `<div class="stat-item">` +
                `<span class="stat-label">CPU</span>` +
                `<span class="stat-value">${cpu.usage || 0}%</span>` +
                `<div class="stat-bar"><div class="stat-bar-fill" style="width: ${Math.min(cpu.usage || 0, 100)}%; background: ${(cpu.usage || 0) > 80 ? '#ef4444' : (cpu.usage || 0) > 50 ? '#f59e0b' : '#22c55e'}"></div></div>` +
            `</div>` +
            `<div class="stat-item">` +
                `<span class="stat-label">内存</span>` +
                `<span class="stat-value">${mem.usagePercent || 0}%</span>` +
                `<div class="stat-bar"><div class="stat-bar-fill" style="width: ${Math.min(mem.usagePercent || 0, 100)}%; background: ${(mem.usagePercent || 0) > 80 ? '#ef4444' : (mem.usagePercent || 0) > 50 ? '#f59e0b' : '#22c55e'}"></div></div>` +
            `</div>` +
            `<div class="stat-item">` +
                `<span class="stat-label">进程内存</span>` +
                `<span class="stat-value">${this._formatBytes(mem.process?.rss || 0)}</span>` +
            `</div>` +
            `<div class="stat-item">` +
                `<span class="stat-label">堆内存</span>` +
                `<span class="stat-value">${this._formatBytes(mem.process?.heapUsed || 0)} / ${this._formatBytes(mem.process?.heapTotal || 0)}</span>` +
            `</div>` +
            `<div class="stat-item">` +
                `<span class="stat-label">系统运行</span>` +
                `<span class="stat-value">${this._formatUptime(uptime.system || 0)}</span>` +
            `</div>` +
            `<div class="stat-item">` +
                `<span class="stat-label">进程运行</span>` +
                `<span class="stat-value">${this._formatUptime(uptime.process || 0)}</span>` +
            `</div>`;
    },

    _formatBytes(bytes) {
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
    },

    _formatUptime(seconds) {
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
};

window.LogViewer = LogViewer;
