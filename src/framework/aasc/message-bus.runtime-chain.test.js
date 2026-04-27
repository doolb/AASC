const assert = require('assert');
const { MessageBus } = require('./message-bus');

async function runTests() {
    console.log('\n🧪 MessageBus 跨设备链路测试\n');

    const bus = new MessageBus({ localDeviceId: 'server' });
    bus.registerRuntime('runtime-main', { deviceId: 'server' });

    let capturedEnvelope = null;
    let receivedPayload = null;

    bus.registerDeviceTransport('device-1', (envelope) => {
        capturedEnvelope = envelope;
        return true;
    });

    bus.subscribeRuntime('runtime-main', 'device.event', (message) => {
        receivedPayload = message.payload?.data;
    }, 'test-subscriber');

    await bus.publishRuntime('runtime-main', 'device.event', { from: 'runtime', ok: true }, {
        targetDeviceId: 'device-1'
    });

    assert.ok(capturedEnvelope, '应通过 transport 转发 runtime 消息');
    assert.strictEqual(capturedEnvelope.targetDeviceId, 'device-1');

    await bus.receiveRemoteRuntimeMessage({
        ...capturedEnvelope,
        sourceDeviceId: 'device-1',
        targetDeviceId: 'server'
    });

    assert.deepStrictEqual(receivedPayload, { from: 'runtime', ok: true });

    console.log('✅ MessageBus 跨设备链路测试通过\n');
    return true;
}

module.exports = { runTests };

if (require.main === module) {
    runTests()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ MessageBus 跨设备链路测试失败:', err.message);
            process.exit(1);
        });
}
