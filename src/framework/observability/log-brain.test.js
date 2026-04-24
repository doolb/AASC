const assert = require('assert');
const LogBrain = require('./log-brain');

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        return true;
    } catch (err) {
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${err.message}`);
        return false;
    }
}

function createEntry(level, category, message, offsetMs) {
    const timestamp = Date.now() - offsetMs;
    return {
        timestamp,
        time: new Date(timestamp).toTimeString().slice(0, 8),
        level,
        category,
        device: 'server',
        message
    };
}

function runTests() {
    console.log('\n🧪 LogBrain 单元测试\n');

    let passed = 0;
    let failed = 0;

    const entries = [
        createEntry('error', '系统', '连接失败 code=5001', 20 * 1000),
        createEntry('warn', '断开', '设备重连超时', 18 * 1000),
        createEntry('warn', '断开', '设备重连超时', 16 * 1000),
        createEntry('warn', '断开', '设备重连超时', 14 * 1000),
        createEntry('info', '心跳', 'runtime heartbeat ok', 12 * 1000)
    ];

    const brain = new LogBrain({
        maxContextEntries: 50,
        errorThreshold: 1,
        warnThreshold: 3,
        memoryWarningThreshold: 70,
        defaultTimeRange: '5m',
        logSource: {
            getEntries() {
                return entries;
            }
        },
        statsSource: {
            getStats() {
                return {
                    memory: {
                        usagePercent: 80
                    }
                };
            }
        }
    });

    if (test('默认时间窗口来自配置', () => {
        const summary = brain.getSummary({});
        assert.strictEqual(summary.timeRange, '5m');
    })) passed++; else failed++;

    if (test('摘要输出包含阈值与时间线', () => {
        const summary = brain.getSummary({});
        assert.strictEqual(summary.thresholds.warnThreshold, 3);
        assert.ok(Array.isArray(summary.timeline));
        assert.ok(summary.timeline.length > 0);
    })) passed++; else failed++;

    if (test('阈值触发风险发现', () => {
        const summary = brain.getSummary({});
        assert.ok(summary.findings.some(item => item.includes('错误日志')));
        assert.ok(summary.findings.some(item => item.includes('连接稳定性')));
        assert.ok(summary.findings.some(item => item.includes('内存使用率')));
    })) passed++; else failed++;

    if (test('诊断上下文输出 JSON 指令', () => {
        const context = brain.buildDiagnoseContext('为什么断连频繁？');
        assert.ok(context.prompt.includes('请严格输出 JSON'));
    })) passed++; else failed++;

    if (test('LLM 失败时可生成回退诊断', () => {
        const context = brain.buildDiagnoseContext('test');
        const diagnosis = brain.buildFallbackDiagnosis(context, 'mock error');
        assert.ok(Array.isArray(diagnosis.possibleCauses));
        assert.ok(Array.isArray(diagnosis.investigationSteps));
        assert.ok(['low', 'medium', 'high', 'critical'].includes(diagnosis.riskLevel));
    })) passed++; else failed++;

    console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败\n`);
    return failed === 0;
}

module.exports = { runTests };

if (require.main === module) {
    process.exit(runTests() ? 0 : 1);
}
