function toPositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function extractJsonText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return '';
    }

    const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch && fencedMatch[1]) {
        return fencedMatch[1].trim();
    }

    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return rawText.slice(firstBrace, lastBrace + 1).trim();
    }

    return rawText.trim();
}

function normalizeRiskLevel(value) {
    const valid = new Set(['low', 'medium', 'high', 'critical']);
    const normalized = String(value || '').toLowerCase();
    if (valid.has(normalized)) {
        return normalized;
    }
    return 'medium';
}

function normalizeDiagnosis(parsed) {
    const causes = Array.isArray(parsed?.possibleCauses) ? parsed.possibleCauses : [];
    const possibleCauses = causes
        .map(item => ({
            reason: String(item?.reason || '').trim(),
            probability: Number(item?.probability)
        }))
        .filter(item => item.reason)
        .map(item => ({
            reason: item.reason,
            probability: Number.isFinite(item.probability)
                ? Math.max(0, Math.min(1, item.probability))
                : 0.5
        }))
        .sort((a, b) => b.probability - a.probability);

    const evidenceLogs = Array.isArray(parsed?.evidenceLogs)
        ? parsed.evidenceLogs.map(item => String(item || '').trim()).filter(Boolean)
        : [];

    const investigationSteps = Array.isArray(parsed?.investigationSteps)
        ? parsed.investigationSteps.map(item => String(item || '').trim()).filter(Boolean)
        : [];

    return {
        possibleCauses,
        evidenceLogs,
        investigationSteps,
        riskLevel: normalizeRiskLevel(parsed?.riskLevel)
    };
}

function parseDiagnosisFromText(text) {
    const jsonText = extractJsonText(text);
    if (!jsonText) {
        return null;
    }

    try {
        const parsed = JSON.parse(jsonText);
        return normalizeDiagnosis(parsed);
    } catch (err) {
        return null;
    }
}

function createLogBrainApiHandlers(options) {
    const logBrain = options?.logBrain;
    const llmService = options?.llmService;

    if (!logBrain) {
        throw new Error('logBrain is required');
    }

    function handleBrainSummary(req, res) {
        try {
            const summary = logBrain.getSummary({
                timeRange: req.query.timeRange,
                limit: toPositiveInt(req.query.limit, 200)
            });
            res.json({
                status: 'ok',
                summary
            });
        } catch (err) {
            res.status(500).json({ status: 'error', message: err.message });
        }
    }

    function handleBrainJudge(req, res) {
        try {
            const context = logBrain.buildJudgeContext(req.body?.question, {
                timeRange: req.body?.timeRange,
                limit: toPositiveInt(req.body?.limit, 160)
            });
            res.json({
                status: 'ok',
                context
            });
        } catch (err) {
            res.status(500).json({ status: 'error', message: err.message });
        }
    }

    async function handleBrainDiagnose(req, res) {
        try {
            const context = (typeof logBrain.buildDiagnoseContext === 'function'
                ? logBrain.buildDiagnoseContext(req.body?.question, {
                    timeRange: req.body?.timeRange,
                    limit: toPositiveInt(req.body?.limit, 200)
                })
                : logBrain.buildJudgeContext(req.body?.question, {
                    timeRange: req.body?.timeRange,
                    limit: toPositiveInt(req.body?.limit, 200)
                }));

            const llmEnabled = llmService && typeof llmService.chat === 'function';
            let diagnosis = null;
            let llmError = null;
            let llmRawMessage = '';

            if (llmEnabled) {
                const llmResponse = await llmService.chat(context.prompt, {
                    systemPrompt: '你是日志故障诊断专家，请遵守输出 JSON 结构并优先给出可执行排查建议。'
                });
                if (llmResponse && llmResponse.success && llmResponse.message) {
                    llmRawMessage = llmResponse.message;
                    diagnosis = parseDiagnosisFromText(llmResponse.message);
                    if (diagnosis && diagnosis.possibleCauses.length === 0 && diagnosis.evidenceLogs.length === 0) {
                        diagnosis = null;
                    }
                } else {
                    llmError = llmResponse?.error || 'llm response invalid';
                }
            } else {
                llmError = 'llm service unavailable';
            }

            if (!diagnosis) {
                diagnosis = logBrain.buildFallbackDiagnosis(context, llmError || 'llm parse failed');
            }

            res.json({
                status: 'ok',
                diagnosis,
                context,
                llm: {
                    enabled: llmEnabled,
                    error: llmError,
                    rawMessage: llmRawMessage
                }
            });
        } catch (err) {
            res.status(500).json({ status: 'error', message: err.message });
        }
    }

    return {
        handleBrainSummary,
        handleBrainJudge,
        handleBrainDiagnose
    };
}

function registerLogBrainApi(app, options) {
    const handlers = createLogBrainApiHandlers(options);
    app.get('/api/logs/brain-summary', handlers.handleBrainSummary);
    app.post('/api/logs/brain-judge', handlers.handleBrainJudge);
    app.post('/api/logs/brain-diagnose', handlers.handleBrainDiagnose);
    return handlers;
}

module.exports = {
    createLogBrainApiHandlers,
    registerLogBrainApi,
    parseDiagnosisFromText,
    normalizeDiagnosis
};
