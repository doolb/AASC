const { runTests: runLogBrainUnitTests } = require('../framework/observability/log-brain.test');
const { runTests: runLogBrainApiIntegrationTests } = require('../apps/server/api/log-brain-api.integration.test');
const { runTests: runRuntimeChainTests } = require('../aasc/message-bus.runtime-chain.test');

async function runAll() {
    const results = [];

    results.push({ name: 'log-brain-unit', ok: runLogBrainUnitTests() });
    results.push({ name: 'log-brain-api-integration', ok: await runLogBrainApiIntegrationTests() });
    results.push({ name: 'runtime-device-chain', ok: await runRuntimeChainTests() });

    const failed = results.filter(item => !item.ok);
    if (failed.length > 0) {
        console.error('\n❌ 自动化测试失败:');
        failed.forEach(item => {
            console.error(`- ${item.name}`);
        });
        process.exit(1);
    }

    console.log('\n✅ 所有日志大脑相关测试通过');
}

runAll().catch((err) => {
    console.error('\n❌ 测试执行异常:', err.message);
    process.exit(1);
});
