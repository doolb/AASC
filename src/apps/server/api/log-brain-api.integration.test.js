const assert = require('assert');
const express = require('express');
const { registerLogBrainApi } = require('./log-brain-api');

async function withServer(app, fn) {
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        await fn(baseUrl);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

async function runTests() {
    console.log('\n🧪 LogBrain API 集成测试\n');

    const app = express();
    app.use(express.json());

    const mockSummary = {
        generatedAt: Date.now(),
        timeRange: '10m',
        totalEntries: 3,
        counters: {
            levels: { error: 1, warn: 1, info: 1, debug: 0 },
            categories: { 系统: 2, 断开: 1 }
        },
        topPatterns: [{ pattern: '连接失败 <num>', count: 2 }],
        timeline: [
            { time: '10:00:00', level: 'error', category: '系统', message: '连接失败 5001' }
        ],
        findings: ['检测到 1 条错误日志，优先排查错误链路。']
    };

    const mockContext = {
        question: '为什么报错',
        summary: mockSummary,
        memory: {
            sensoryMemory: mockSummary.timeline,
            metacognition: mockSummary.findings
        },
        prompt: 'diagnose prompt'
    };

    const logBrain = {
        getSummary() {
            return mockSummary;
        },
        buildJudgeContext() {
            return mockContext;
        },
        buildDiagnoseContext() {
            return mockContext;
        },
        buildFallbackDiagnosis() {
            return {
                possibleCauses: [{ reason: 'fallback', probability: 0.5 }],
                evidenceLogs: ['fallback evidence'],
                investigationSteps: ['fallback step'],
                riskLevel: 'medium'
            };
        }
    };

    const llmService = {
        async chat() {
            return {
                success: true,
                message: JSON.stringify({
                    possibleCauses: [{ reason: '网络抖动', probability: 0.82 }],
                    evidenceLogs: ['10:00:00 [error] 连接失败 5001'],
                    investigationSteps: ['检查交换机', '检查设备网络'],
                    riskLevel: 'high'
                })
            };
        }
    };

    registerLogBrainApi(app, { logBrain, llmService });

    await withServer(app, async (baseUrl) => {
        const summaryResp = await fetch(`${baseUrl}/api/logs/brain-summary?timeRange=10m&limit=100`);
        const summaryJson = await summaryResp.json();
        assert.strictEqual(summaryResp.status, 200);
        assert.strictEqual(summaryJson.status, 'ok');
        assert.strictEqual(summaryJson.summary.totalEntries, 3);

        const judgeResp = await fetch(`${baseUrl}/api/logs/brain-judge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: '为什么报错', timeRange: '10m', limit: 100 })
        });
        const judgeJson = await judgeResp.json();
        assert.strictEqual(judgeResp.status, 200);
        assert.strictEqual(judgeJson.status, 'ok');
        assert.strictEqual(judgeJson.context.question, '为什么报错');

        const diagnoseResp = await fetch(`${baseUrl}/api/logs/brain-diagnose`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: '为什么报错', timeRange: '10m', limit: 100 })
        });
        const diagnoseJson = await diagnoseResp.json();
        assert.strictEqual(diagnoseResp.status, 200);
        assert.strictEqual(diagnoseJson.status, 'ok');
        assert.strictEqual(diagnoseJson.diagnosis.riskLevel, 'high');
        assert.strictEqual(diagnoseJson.diagnosis.possibleCauses[0].reason, '网络抖动');
    });

    console.log('✅ LogBrain API 集成测试通过\n');
    return true;
}

module.exports = { runTests };

if (require.main === module) {
    runTests()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ LogBrain API 集成测试失败:', err.message);
            process.exit(1);
        });
}
