const LogBrainViewer = {
    HISTORY_STORAGE_KEY: 'logBrainDiagnosisHistory',
    AUTO_REFRESH_STORAGE_KEY: 'logBrainAutoRefresh',
    AUTO_REFRESH_INTERVAL_STORAGE_KEY: 'logBrainAutoRefreshIntervalMs',

    state: {
        summary: null,
        diagnosis: null,
        diagnosisHistory: [],
        isPanelActive: false,
        autoRefreshEnabled: false,
        autoRefreshIntervalMs: 15000,
        autoRefreshTimer: null
    },

    init() {
        const timeRange = document.getElementById('brainTimeRange');
        if (timeRange) {
            timeRange.addEventListener('change', () => {
                this.refreshSummary();
            });
        }

        const autoRefreshInput = document.getElementById('brainAutoRefresh');
        if (autoRefreshInput) {
            autoRefreshInput.addEventListener('change', () => {
                this.setAutoRefreshEnabled(autoRefreshInput.checked);
            });
        }

        const intervalSelect = document.getElementById('brainRefreshInterval');
        if (intervalSelect) {
            intervalSelect.addEventListener('change', () => {
                this.setAutoRefreshInterval(parseInt(intervalSelect.value, 10));
            });
        }

        this._loadSettings();
        this._loadHistory();
        this._renderHistory();
        this._renderAutoRefreshStatus();
    },

    setActive(active) {
        this.state.isPanelActive = !!active;
        if (this.state.isPanelActive) {
            this.refreshSummary();
            this._startAutoRefresh();
            return;
        }
        this._stopAutoRefresh();
    },

    setAutoRefreshEnabled(enabled) {
        this.state.autoRefreshEnabled = !!enabled;
        this._saveSettings();
        this._renderAutoRefreshStatus();
        if (this.state.isPanelActive) {
            this._startAutoRefresh();
        }
    },

    setAutoRefreshInterval(intervalMs) {
        const nextInterval = Number.isFinite(intervalMs) && intervalMs >= 2000 ? intervalMs : 15000;
        this.state.autoRefreshIntervalMs = nextInterval;
        this._saveSettings();
        this._renderAutoRefreshStatus();
        if (this.state.isPanelActive && this.state.autoRefreshEnabled) {
            this._startAutoRefresh();
        }
    },

    async refreshSummary() {
        const timeRange = this._getTimeRange();
        try {
            const response = await fetch(`/api/logs/brain-summary?timeRange=${encodeURIComponent(timeRange)}&limit=300`);
            const data = await response.json();
            if (data.status !== 'ok') {
                throw new Error(data.message || '加载日志大脑摘要失败');
            }
            this.state.summary = data.summary;
            this._renderSummary(data.summary);
            this._renderTimeline(data.summary?.timeline || []);
            this._renderAutoRefreshStatus();
        } catch (err) {
            this._renderError(err.message || '加载失败');
        }
    },

    async runDiagnose() {
        const button = document.getElementById('brainDiagnoseBtn');
        const questionInput = document.getElementById('brainQuestion');
        const payload = {
            question: questionInput?.value?.trim() || '请判断当前系统异常的主要原因',
            timeRange: this._getTimeRange(),
            limit: 300
        };

        try {
            if (button) {
                button.disabled = true;
                button.textContent = '诊断中...';
            }

            const response = await fetch('/api/logs/brain-diagnose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.status !== 'ok') {
                throw new Error(data.message || '诊断失败');
            }

            this.state.diagnosis = data.diagnosis;
            this.state.summary = data.context?.summary || this.state.summary;
            if (this.state.summary) {
                this._renderSummary(this.state.summary, data.diagnosis?.riskLevel);
                this._renderTimeline(this.state.summary.timeline || []);
            }
            this._renderDiagnosis(data.diagnosis);
            this._appendDiagnosisHistory(payload.question, data.diagnosis);
        } catch (err) {
            this._renderError(err.message || '诊断失败');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = '开始诊断';
            }
        }
    },

    _renderSummary(summary, riskLevel) {
        const levels = summary?.counters?.levels || {};
        const patternCount = Array.isArray(summary?.topPatterns) ? summary.topPatterns.length : 0;
        const nextRiskLevel = riskLevel || this._inferRiskLevel(summary);

        this._setText('brainErrorCount', String(levels.error || 0));
        this._setText('brainWarnCount', String(levels.warn || 0));
        this._setText('brainPatternCount', String(patternCount));
        this._setText('brainRiskLevel', this._formatRiskLevel(nextRiskLevel));
    },

    _renderTimeline(timeline) {
        const container = document.getElementById('brainTimeline');
        if (!container) return;

        if (!Array.isArray(timeline) || timeline.length === 0) {
            container.innerHTML = '<div class="log-empty">暂无时间线数据</div>';
            return;
        }

        container.innerHTML = timeline
            .slice(-80)
            .map(item => {
                const level = this._escapeHtml(item.level || 'info');
                const category = this._escapeHtml(item.category || 'unknown');
                const time = this._escapeHtml(item.time || '--:--:--');
                const message = this._escapeHtml(item.message || '');
                return (
                    `<div class="brain-timeline-item level-${level}">` +
                    `<span class="timeline-time">${time}</span>` +
                    `<span class="timeline-level">${level}</span>` +
                    `<span class="timeline-category">[${category}]</span>` +
                    `<span class="timeline-message">${message}</span>` +
                    `</div>`
                );
            })
            .join('');
    },

    _renderDiagnosis(diagnosis) {
        const container = document.getElementById('brainDiagnosisResult');
        if (!container) return;

        const causes = Array.isArray(diagnosis?.possibleCauses) ? diagnosis.possibleCauses : [];
        const evidence = Array.isArray(diagnosis?.evidenceLogs) ? diagnosis.evidenceLogs : [];
        const steps = Array.isArray(diagnosis?.investigationSteps) ? diagnosis.investigationSteps : [];

        const causesHtml = causes.length > 0
            ? `<ul>${causes.map(item => `<li>${this._escapeHtml(item.reason)} (${Math.round((item.probability || 0) * 100)}%)</li>`).join('')}</ul>`
            : '<div class="brain-result-empty">暂无可能原因</div>';

        const evidenceHtml = evidence.length > 0
            ? `<ul>${evidence.map(item => `<li>${this._escapeHtml(item)}</li>`).join('')}</ul>`
            : '<div class="brain-result-empty">暂无证据日志</div>';

        const stepsHtml = steps.length > 0
            ? `<ol>${steps.map(item => `<li>${this._escapeHtml(item)}</li>`).join('')}</ol>`
            : '<div class="brain-result-empty">暂无排查步骤</div>';

        container.innerHTML =
            `<div class="brain-result-block">` +
            `<div class="brain-result-title">风险级别</div>` +
            `<div class="brain-risk-badge risk-${this._escapeHtml(diagnosis?.riskLevel || 'medium')}">${this._formatRiskLevel(diagnosis?.riskLevel)}</div>` +
            `</div>` +
            `<div class="brain-result-block"><div class="brain-result-title">可能原因（概率排序）</div>${causesHtml}</div>` +
            `<div class="brain-result-block"><div class="brain-result-title">证据日志</div>${evidenceHtml}</div>` +
            `<div class="brain-result-block"><div class="brain-result-title">排查步骤</div>${stepsHtml}</div>`;
    },

    _renderError(message) {
        const container = document.getElementById('brainDiagnosisResult');
        if (!container) return;
        container.innerHTML = `<div class="brain-result-empty">${this._escapeHtml(message)}</div>`;
    },

    _renderHistory() {
        const container = document.getElementById('brainDiagnosisHistory');
        if (!container) return;

        if (!Array.isArray(this.state.diagnosisHistory) || this.state.diagnosisHistory.length === 0) {
            container.innerHTML = '<div class="brain-result-empty">暂无诊断历史</div>';
            return;
        }

        container.innerHTML = this.state.diagnosisHistory
            .map((item, index) => {
                const timeText = this._formatTime(item.timestamp);
                const riskText = this._formatRiskLevel(item.riskLevel);
                const causeText = this._escapeHtml(item.topCause || '无');
                const questionText = this._escapeHtml(item.question || '未记录问题');
                return (
                    `<div class="brain-history-item">` +
                    `<div class="brain-history-main">` +
                    `<div class="brain-history-time">${timeText}</div>` +
                    `<div class="brain-history-question">${questionText}</div>` +
                    `<div class="brain-history-meta">风险: ${riskText} | 首要原因: ${causeText}</div>` +
                    `</div>` +
                    `<div class="brain-history-actions">` +
                    `<button class="control-btn" onclick="LogBrainViewer.useHistoryQuestion(${index})">载入</button>` +
                    `</div>` +
                    `</div>`
                );
            })
            .join('');
    },

    useHistoryQuestion(index) {
        const item = this.state.diagnosisHistory[index];
        if (!item) return;
        const input = document.getElementById('brainQuestion');
        if (input) {
            input.value = item.question || '';
            input.focus();
        }
    },

    clearHistory() {
        this.state.diagnosisHistory = [];
        this._saveHistory();
        this._renderHistory();
    },

    _appendDiagnosisHistory(question, diagnosis) {
        const item = {
            timestamp: Date.now(),
            question: question || '请判断当前系统异常的主要原因',
            riskLevel: diagnosis?.riskLevel || 'medium',
            topCause: Array.isArray(diagnosis?.possibleCauses) && diagnosis.possibleCauses[0]
                ? diagnosis.possibleCauses[0].reason
                : ''
        };
        this.state.diagnosisHistory.unshift(item);
        if (this.state.diagnosisHistory.length > 20) {
            this.state.diagnosisHistory = this.state.diagnosisHistory.slice(0, 20);
        }
        this._saveHistory();
        this._renderHistory();
    },

    _loadHistory() {
        try {
            const raw = localStorage.getItem(this.HISTORY_STORAGE_KEY);
            if (!raw) {
                this.state.diagnosisHistory = [];
                return;
            }
            const parsed = JSON.parse(raw);
            this.state.diagnosisHistory = Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            this.state.diagnosisHistory = [];
        }
    },

    _saveHistory() {
        try {
            localStorage.setItem(this.HISTORY_STORAGE_KEY, JSON.stringify(this.state.diagnosisHistory));
        } catch (err) {
        }
    },

    _loadSettings() {
        try {
            const autoRefreshRaw = localStorage.getItem(this.AUTO_REFRESH_STORAGE_KEY);
            this.state.autoRefreshEnabled = autoRefreshRaw === 'true';

            const intervalRaw = parseInt(localStorage.getItem(this.AUTO_REFRESH_INTERVAL_STORAGE_KEY), 10);
            if (!Number.isNaN(intervalRaw) && intervalRaw >= 2000) {
                this.state.autoRefreshIntervalMs = intervalRaw;
            }
        } catch (err) {
            this.state.autoRefreshEnabled = false;
            this.state.autoRefreshIntervalMs = 15000;
        }

        const autoRefreshInput = document.getElementById('brainAutoRefresh');
        if (autoRefreshInput) {
            autoRefreshInput.checked = this.state.autoRefreshEnabled;
        }

        const intervalSelect = document.getElementById('brainRefreshInterval');
        if (intervalSelect) {
            intervalSelect.value = String(this.state.autoRefreshIntervalMs);
        }
    },

    _saveSettings() {
        try {
            localStorage.setItem(this.AUTO_REFRESH_STORAGE_KEY, String(this.state.autoRefreshEnabled));
            localStorage.setItem(this.AUTO_REFRESH_INTERVAL_STORAGE_KEY, String(this.state.autoRefreshIntervalMs));
        } catch (err) {
        }
    },

    _startAutoRefresh() {
        this._stopAutoRefresh();
        if (!this.state.autoRefreshEnabled || !this.state.isPanelActive) {
            this._renderAutoRefreshStatus();
            return;
        }

        this.state.autoRefreshTimer = setInterval(() => {
            this.refreshSummary();
        }, this.state.autoRefreshIntervalMs);
        this._renderAutoRefreshStatus();
    },

    _stopAutoRefresh() {
        if (this.state.autoRefreshTimer) {
            clearInterval(this.state.autoRefreshTimer);
            this.state.autoRefreshTimer = null;
        }
        this._renderAutoRefreshStatus();
    },

    _renderAutoRefreshStatus() {
        const statusEl = document.getElementById('brainAutoRefreshStatus');
        if (!statusEl) return;
        if (!this.state.autoRefreshEnabled) {
            statusEl.textContent = '自动刷新: 关闭';
            return;
        }
        const sec = Math.floor(this.state.autoRefreshIntervalMs / 1000);
        const runningText = this.state.autoRefreshTimer ? '运行中' : '待命';
        statusEl.textContent = `自动刷新: ${runningText} (${sec}s)`;
    },

    _getTimeRange() {
        const select = document.getElementById('brainTimeRange');
        return select?.value || '10m';
    },

    _inferRiskLevel(summary) {
        const error = summary?.counters?.levels?.error || 0;
        const warn = summary?.counters?.levels?.warn || 0;
        if (error >= 3) return 'high';
        if (error > 0 || warn >= 20) return 'medium';
        return 'low';
    },

    _formatRiskLevel(level) {
        const map = {
            low: '低',
            medium: '中',
            high: '高',
            critical: '严重'
        };
        return map[level] || '中';
    },

    _setText(id, value) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = value;
        }
    },

    _formatTime(timestamp) {
        const time = Number(timestamp);
        if (!Number.isFinite(time) || time <= 0) {
            return '--';
        }
        const date = new Date(time);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${mm}:${s}`;
    },

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text || '');
        return div.innerHTML;
    }
};

window.LogBrainViewer = LogBrainViewer;
