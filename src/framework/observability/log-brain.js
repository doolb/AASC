'use strict';

class LogBrain {
    constructor(options = {}) {
        this.logSource = options.logSource;
        this.statsSource = options.statsSource;
        this.maxContextEntries = options.maxContextEntries || 300;
        this.thresholds = {
            errorThreshold: this._normalizeThreshold(options.errorThreshold, 1),
            warnThreshold: this._normalizeThreshold(options.warnThreshold, 20),
            memoryWarningThreshold: this._normalizeThreshold(options.memoryWarningThreshold, 85),
            defaultTimeRange: options.defaultTimeRange || '10m'
        };
        this.recentEntries = [];
    }

    ingest(entry) {
        if (!entry) {
            return;
        }
        this.recentEntries.push(entry);
        if (this.recentEntries.length > this.maxContextEntries) {
            this.recentEntries.shift();
        }
    }

    getSummary(options = {}) {
        const timeRange = options.timeRange || this.thresholds.defaultTimeRange;
        const limit = this._normalizeLimit(options.limit, 200);
        const entries = this._fetchEntries(timeRange, limit);
        const stats = this._getSystemStats();

        const counters = this._buildCounters(entries);
        const patterns = this._buildPatterns(entries);
        const findings = this._buildFindings(counters, patterns, stats);

        return {
            generatedAt: Date.now(),
            timeRange,
            totalEntries: entries.length,
            counters,
            topPatterns: patterns,
            timeline: this._buildTimeline(entries, 60),
            findings,
            system: stats,
            thresholds: { ...this.thresholds }
        };
    }

    buildJudgeContext(question, options = {}) {
        const summary = this.getSummary(options);
        const entries = this._fetchEntries(summary.timeRange, this._normalizeLimit(options.limit, 120));
        const timeline = entries.slice(-40).map(e => ({
            time: e.time,
            level: e.level,
            category: e.category,
            message: e.message
        }));

        const memory = {
            sensoryMemory: timeline,
            workingMemory: {
                totalEntries: summary.totalEntries,
                levelCounters: summary.counters.levels,
                categoryCounters: summary.counters.categories
            },
            episodicMemory: summary.topPatterns,
            metacognition: summary.findings
        };

        const prompt = this._buildPrompt(question, summary, memory);
        return {
            generatedAt: Date.now(),
            question: question || '请根据日志判断系统问题',
            summary,
            memory,
            prompt
        };
    }

    buildDiagnoseContext(question, options = {}) {
        const context = this.buildJudgeContext(question, options);
        return {
            ...context,
            prompt: this._buildDiagnosePrompt(context)
        };
    }

    buildFallbackDiagnosis(context, reason = '') {
        const summary = context?.summary || this.getSummary({});
        const memory = context?.memory || {
            sensoryMemory: summary.timeline || [],
            metacognition: summary.findings || []
        };

        const findings = Array.isArray(memory.metacognition) ? memory.metacognition : [];
        const possibleCauses = findings.slice(0, 3).map((item, index) => ({
            reason: item,
            probability: Number((0.85 - index * 0.15).toFixed(2))
        }));

        if (possibleCauses.length === 0) {
            possibleCauses.push({
                reason: '日志特征不足，建议先扩展时间窗口并增加业务埋点。',
                probability: 0.4
            });
        }

        const evidenceLogs = (memory.sensoryMemory || [])
            .filter(item => item && (item.level === 'error' || item.level === 'warn'))
            .slice(-8)
            .map(item => `${item.time || '--:--:--'} [${item.level || 'info'}] [${item.category || 'unknown'}] ${item.message || ''}`);

        const investigationSteps = [
            '先按时间线复现最新错误，确认是否稳定复现。',
            '对照高频模式检查网络、依赖服务和设备在线状态。',
            '若持续波动，扩大时间窗口并补充调用链 trace 与关键业务日志。'
        ];

        return {
            possibleCauses,
            evidenceLogs,
            investigationSteps,
            riskLevel: this._inferRiskLevel(summary),
            modelUsed: 'fallback-rule-engine',
            fallbackReason: reason || 'LLM unavailable'
        };
    }

    _fetchEntries(timeRange, limit) {
        if (this.logSource && typeof this.logSource.getEntries === 'function') {
            return this.logSource.getEntries({
                timeRange,
                limit: this._normalizeLimit(limit, 200)
            });
        }

        const now = Date.now();
        const rangeMs = this._parseTimeRange(timeRange);
        const filtered = this.recentEntries.filter(entry => {
            if (rangeMs === 0) {
                return true;
            }
            return (entry.timestamp || 0) >= now - rangeMs;
        });

        const normalizedLimit = this._normalizeLimit(limit, 200);
        return filtered.slice(-normalizedLimit);
    }

    _getSystemStats() {
        if (this.statsSource && typeof this.statsSource.getStats === 'function') {
            return this.statsSource.getStats();
        }
        return null;
    }

    _normalizeLimit(value, fallback) {
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
            return fallback;
        }
        return Math.min(parsed, this.maxContextEntries);
    }

    _normalizeThreshold(value, fallback) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return fallback;
        }
        return parsed;
    }

    _parseTimeRange(range) {
        const map = {
            '10s': 10 * 1000,
            '30s': 30 * 1000,
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '10m': 10 * 60 * 1000,
            '30m': 30 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '6h': 6 * 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            'all': 0
        };
        return map[range] !== undefined ? map[range] : map['10m'];
    }

    _buildCounters(entries) {
        const levels = { error: 0, warn: 0, info: 0, debug: 0 };
        const categories = {};

        for (const entry of entries) {
            const level = entry.level || 'info';
            if (!levels[level]) {
                levels[level] = 0;
            }
            levels[level] += 1;

            const category = entry.category || 'unknown';
            categories[category] = (categories[category] || 0) + 1;
        }

        return { levels, categories };
    }

    _buildPatterns(entries) {
        const patternMap = new Map();
        for (const entry of entries) {
            const normalized = this._normalizeMessage(entry.message || '');
            if (!normalized) {
                continue;
            }
            const prev = patternMap.get(normalized) || 0;
            patternMap.set(normalized, prev + 1);
        }

        return Array.from(patternMap.entries())
            .map(([pattern, count]) => ({ pattern, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
    }

    _buildTimeline(entries, limit) {
        return entries
            .slice(-(limit || 60))
            .map(entry => ({
                time: entry.time,
                level: entry.level,
                category: entry.category,
                device: entry.device,
                message: entry.message,
                timestamp: entry.timestamp
            }));
    }

    _normalizeMessage(message) {
        return message
            .replace(/\d{4,}/g, '<num>')
            .replace(/[a-f0-9]{8,}/gi, '<id>')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _buildFindings(counters, patterns, stats) {
        const findings = [];
        const errorCount = counters.levels.error || 0;
        const warnCount = counters.levels.warn || 0;
        const disconnectCount = counters.categories['断开'] || 0;
        const reconnectSignals = patterns.filter(p => /重连|连接失败|超时/.test(p.pattern)).length;

        if (errorCount >= this.thresholds.errorThreshold) {
            findings.push(`检测到 ${errorCount} 条错误日志，优先排查错误链路。`);
        }

        if (warnCount >= this.thresholds.warnThreshold || disconnectCount > 5 || reconnectSignals > 1) {
            findings.push('连接稳定性存在波动，可能有网络或设备抖动问题。');
        }

        if (stats && stats.memory && stats.memory.usagePercent) {
            const usage = parseFloat(stats.memory.usagePercent);
            if (!Number.isNaN(usage) && usage >= this.thresholds.memoryWarningThreshold) {
                findings.push(`系统内存使用率 ${usage}% 偏高，可能影响实时处理。`);
            }
        }

        if (findings.length === 0) {
            findings.push('当前日志未出现明显高风险信号，可结合业务上下文继续判断。');
        }

        return findings;
    }

    _buildPrompt(question, summary, memory) {
        return [
            '你是系统诊断助手，请根据日志和系统状态给出问题判断。',
            `问题: ${question || '请判断当前系统是否存在异常'}`,
            `时间窗口: ${summary.timeRange}`,
            `日志总量: ${summary.totalEntries}`,
            `错误数: ${summary.counters.levels.error || 0}, 告警数: ${summary.counters.levels.warn || 0}`,
            '请输出：',
            '1) 最可能的 3 个问题原因（按概率排序）',
            '2) 每个原因的证据日志模式',
            '3) 可执行的排查步骤（从低成本到高成本）',
            '4) 若信息不足，明确缺失数据项',
            `记忆体(JSON): ${JSON.stringify(memory)}`
        ].join('\n');
    }

    _buildDiagnosePrompt(context) {
        const summary = context.summary;
        return [
            '你是日志故障诊断助手。',
            `诊断问题: ${context.question || '请判断当前系统异常原因'}`,
            `时间窗口: ${summary.timeRange}`,
            `日志总量: ${summary.totalEntries}`,
            `错误数: ${summary.counters.levels.error || 0}, 告警数: ${summary.counters.levels.warn || 0}`,
            '请严格输出 JSON，不要附加 markdown 或解释。',
            'JSON 结构：',
            '{',
            '  "possibleCauses": [{"reason": "string", "probability": 0.0-1.0}],',
            '  "evidenceLogs": ["string"],',
            '  "investigationSteps": ["string"],',
            '  "riskLevel": "low|medium|high|critical"',
            '}',
            `上下文(JSON): ${JSON.stringify(context.memory)}`
        ].join('\n');
    }

    _inferRiskLevel(summary) {
        const errorCount = summary?.counters?.levels?.error || 0;
        const warnCount = summary?.counters?.levels?.warn || 0;
        const memoryUsage = Number(summary?.system?.memory?.usagePercent || 0);

        if (errorCount >= this.thresholds.errorThreshold * 3 || memoryUsage >= 95) {
            return 'critical';
        }
        if (errorCount >= this.thresholds.errorThreshold || memoryUsage >= this.thresholds.memoryWarningThreshold) {
            return 'high';
        }
        if (warnCount >= this.thresholds.warnThreshold) {
            return 'medium';
        }
        return 'low';
    }
}

module.exports = LogBrain;
