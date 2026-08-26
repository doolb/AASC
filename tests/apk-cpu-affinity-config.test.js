'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configService = require('../src/apps/server/modules/config/config-app-service');

const SERVER = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');

const DEFAULT_CPU_AFFINITY = {
    asr: { bigCoreCount: 1, littleCoreCount: 1, preferBigCores: false },
    tts: { bigCoreCount: 1, littleCoreCount: 1, preferBigCores: false }
};

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

test('CPU 配置默认值为 ASR/TTS 各 1 大核 1 小核，并对缺失字段回填默认值', () => {
    assert.deepEqual(configService.normalizeCpuAffinityConfig(undefined), DEFAULT_CPU_AFFINITY);
    assert.deepEqual(
        configService.normalizeCpuAffinityConfig({
            asr: { bigCoreCount: 2 },
            tts: { littleCoreCount: 3 }
        }),
        {
            asr: { bigCoreCount: 2, littleCoreCount: 1, preferBigCores: false },
            tts: { bigCoreCount: 1, littleCoreCount: 3, preferBigCores: false }
        }
    );
    assert.deepEqual(
        configService.normalizeCpuAffinityConfig({
            asr: { bigCoreCount: 0, littleCoreCount: 0 },
            tts: { bigCoreCount: 0, littleCoreCount: 2, preferBigCores: false }
        }),
        {
            asr: DEFAULT_CPU_AFFINITY.asr,
            tts: { bigCoreCount: 0, littleCoreCount: 2, preferBigCores: false }
        }
    );
});

test('CPU 配置接口拒绝负数和小数，且不产生持久化或广播副作用', () => {
    const writes = [];
    const controlBroadcasts = [];
    const displayBroadcasts = [];

    const invalidNegative = configService.applyCpuAffinityConfigUpdate({
        body: {
            asr: { bigCoreCount: -1, littleCoreCount: 0 },
            tts: { bigCoreCount: 1, littleCoreCount: 0 }
        },
        setConfig: (key, value) => writes.push({ key, value }),
        broadcastToControls: (message) => controlBroadcasts.push(message),
        broadcastCpuConfig: (message) => displayBroadcasts.push(message)
    });

    const invalidDecimal = configService.applyCpuAffinityConfigUpdate({
        body: {
            asr: { bigCoreCount: 1.5, littleCoreCount: 0 },
            tts: { bigCoreCount: 1, littleCoreCount: 0 }
        },
        setConfig: (key, value) => writes.push({ key, value }),
        broadcastToControls: (message) => controlBroadcasts.push(message),
        broadcastCpuConfig: (message) => displayBroadcasts.push(message)
    });

    assert.equal(invalidNegative.statusCode, 400);
    assert.equal(invalidDecimal.statusCode, 400);
    assert.equal(writes.length, 0);
    assert.equal(controlBroadcasts.length, 0);
    assert.equal(displayBroadcasts.length, 0);
});

test('CPU 配置接口拒绝非布尔的优先大核开关，且不产生副作用', () => {
    const writes = [];
    const broadcasts = [];
    const result = configService.applyCpuAffinityConfigUpdate({
        body: {
            asr: { bigCoreCount: 1, littleCoreCount: 1, preferBigCores: 'true' },
            tts: { bigCoreCount: 1, littleCoreCount: 1, preferBigCores: false }
        },
        setConfig: (key, value) => writes.push({ key, value }),
        broadcastToControls: (message) => broadcasts.push(message),
        broadcastCpuConfig: (message) => broadcasts.push(message)
    });

    assert.equal(result.statusCode, 400);
    assert.match(result.body.message, /preferBigCores/);
    assert.equal(writes.length, 0);
    assert.equal(broadcasts.length, 0);
});

test('CPU 配置接口拒绝任一引擎为 0/0，且不产生持久化或广播副作用', () => {
    const writes = [];
    const controlBroadcasts = [];
    const displayBroadcasts = [];

    const invalidAsrZero = configService.applyCpuAffinityConfigUpdate({
        body: {
            asr: { bigCoreCount: 0, littleCoreCount: 0 },
            tts: { bigCoreCount: 1, littleCoreCount: 0 }
        },
        setConfig: (key, value) => writes.push({ key, value }),
        broadcastToControls: (message) => controlBroadcasts.push(message),
        broadcastCpuConfig: (message) => displayBroadcasts.push(message)
    });

    const invalidTtsZero = configService.applyCpuAffinityConfigUpdate({
        body: {
            asr: { bigCoreCount: 1, littleCoreCount: 0 },
            tts: { bigCoreCount: 0, littleCoreCount: 0 }
        },
        setConfig: (key, value) => writes.push({ key, value }),
        broadcastToControls: (message) => controlBroadcasts.push(message),
        broadcastCpuConfig: (message) => displayBroadcasts.push(message)
    });

    assert.equal(invalidAsrZero.statusCode, 400);
    assert.equal(invalidTtsZero.statusCode, 400);
    assert.match(invalidAsrZero.body.message, /asr/);
    assert.match(invalidTtsZero.body.message, /tts/);
    assert.equal(writes.length, 0);
    assert.equal(controlBroadcasts.length, 0);
    assert.equal(displayBroadcasts.length, 0);
});

test('CPU 配置接口对缺失字段回填默认值，并广播规范化配置', () => {
    const writes = [];
    const controlBroadcasts = [];
    const displayBroadcasts = [];

    const result = configService.applyCpuAffinityConfigUpdate({
        body: {
            asr: { bigCoreCount: 2 },
            tts: { littleCoreCount: 3 }
        },
        setConfig: (key, value) => writes.push({ key, value }),
        broadcastToControls: (message) => controlBroadcasts.push(message),
        broadcastCpuConfig: (message) => displayBroadcasts.push(message)
    });

    const expected = {
        asr: { bigCoreCount: 2, littleCoreCount: 1, preferBigCores: false },
        tts: { bigCoreCount: 1, littleCoreCount: 3, preferBigCores: false }
    };

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
        status: 'success',
        cpuAffinity: expected
    });
    assert.deepEqual(writes, [{ key: 'cpuAffinity', value: expected }]);
    assert.deepEqual(controlBroadcasts, [{
        type: 'cpuAffinityChanged',
        cpuAffinity: expected
    }]);
    assert.deepEqual(displayBroadcasts, [{
        type: 'cpuConfig',
        asr: expected.asr,
        tts: expected.tts
    }]);
});

test('显示端连接初始化路径会下发 cpuConfig 消息', () => {
    const server = read(SERVER);

    assert.match(server, /app\.get\('\/api\/config\/cpuAffinity'/);
    assert.match(server, /app\.post\('\/api\/config\/cpuAffinity'/);
    assert.match(server, /broadcastCpuConfig:\s*sendCpuConfigToAllDisplays/);
    assert.match(server, /config\.createCpuConfigMessage\(config\.getCpuAffinityConfig\(\)\)/);
    assert.match(
        server,
        /type:\s*'ttsConfig'[\s\S]*config\.createCpuConfigMessage\(config\.getCpuAffinityConfig\(\)\)[\s\S]*type:\s*'voiceprintConfig'/
    );
});

test('cpuConfig 消息不会把任一引擎重新发成 0/0', () => {
    assert.deepEqual(
        configService.createCpuConfigMessage({
            asr: { bigCoreCount: 0, littleCoreCount: 0 },
            tts: { bigCoreCount: 2, littleCoreCount: 0, preferBigCores: false }
        }),
        {
            type: 'cpuConfig',
            asr: DEFAULT_CPU_AFFINITY.asr,
            tts: { bigCoreCount: 2, littleCoreCount: 0, preferBigCores: false }
        }
    );
});
