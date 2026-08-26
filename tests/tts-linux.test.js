'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const {
    createTtsLinuxServer,
    resolveLinuxRuntimeConfig
} = require('../3rd/tts-server/tts-linux');

function request(port, method, requestPath, body) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const request = http.request({
            host: '127.0.0.1',
            port,
            method,
            path: requestPath,
            headers: payload ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            } : undefined
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
                statusCode: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks)
            }));
        });
        request.on('error', reject);
        if (payload) request.write(payload);
        request.end();
    });
}

async function listen(server) {
    const httpServer = server.listen(0, '127.0.0.1');
    await new Promise((resolve) => httpServer.once('listening', resolve));
    return {
        port: httpServer.address().port,
        close: () => new Promise((resolve) => httpServer.close(resolve))
    };
}

test('Linux TTS 默认运行时路径不依赖 NaturalVoiceSAPIAdapter', () => {
    const config = resolveLinuxRuntimeConfig({});

    assert.equal(config.binaryPath.includes('NaturalVoiceSAPIAdapter'), false);
    assert.equal(config.modelPath.includes('NaturalVoiceSAPIAdapter'), false);
});

test('Linux TTS 拥有独立的 CLI 构建入口和源码', () => {
    const linuxRoot = path.join(__dirname, '..', '3rd', 'tts-server', 'linux');
    const cmakePath = path.join(linuxRoot, 'CMakeLists.txt');
    const sourcePath = path.join(linuxRoot, 'src', 'tts_linux.cpp');

    assert.equal(fs.existsSync(cmakePath), true);
    assert.equal(fs.existsSync(sourcePath), true);
    assert.equal(fs.readFileSync(cmakePath, 'utf8').includes('NaturalVoiceSAPIAdapter'), false);
    assert.equal(fs.readFileSync(sourcePath, 'utf8').includes('NaturalVoiceSAPIAdapter'), false);
});

test('Linux TTS HTTP 服务返回合成 WAV 并保留 voice 与 speed 参数', async () => {
    const calls = [];
    const server = createTtsLinuxServer({
        synthesize: async (params) => {
            calls.push(params);
            return Buffer.from('RIFF-test-wav');
        },
        voices: ['Microsoft Xiaoxiao']
    });
    const listener = await listen(server);

    try {
        const response = await request(listener.port, 'POST', '/api/tts', {
            text: '你好，Linux。',
            voice: 'Microsoft Xiaoxiao',
            speed: 2
        });

        assert.equal(response.statusCode, 200);
        assert.match(response.headers['content-type'], /audio\/wav/);
        assert.deepEqual(response.body, Buffer.from('RIFF-test-wav'));
        assert.deepEqual(calls, [{
            text: '你好，Linux。',
            voice: 'Microsoft Xiaoxiao',
            speed: 2
        }]);
    } finally {
        await listener.close();
    }
});

test('Linux TTS HTTP 服务拒绝空文本并提供语音列表', async () => {
    const server = createTtsLinuxServer({
        synthesize: async () => Buffer.from('unused'),
        voices: ['Microsoft Xiaoxiao']
    });
    const listener = await listen(server);

    try {
        const emptyResponse = await request(listener.port, 'POST', '/api/tts', { text: '   ' });
        assert.equal(emptyResponse.statusCode, 400);
        assert.equal(JSON.parse(emptyResponse.body.toString()).success, false);

        const voicesResponse = await request(listener.port, 'GET', '/api/voices');
        assert.equal(voicesResponse.statusCode, 200);
        assert.deepEqual(JSON.parse(voicesResponse.body.toString()), {
            success: true,
            data: ['Microsoft Xiaoxiao']
        });
    } finally {
        await listener.close();
    }
});

test('Linux TTS 队列达到上限时返回 503，并在任务完成后继续 FIFO 调度', async () => {
    const releases = [];
    const server = createTtsLinuxServer({
        runtime: { workerCount: 1, maxQueueLength: 1 },
        synthesize: () => new Promise((resolve) => releases.push(resolve))
    });
    const listener = await listen(server);

    try {
        const first = request(listener.port, 'POST', '/api/tts', { text: '第一句' });
        await new Promise((resolve) => setImmediate(resolve));
        const second = request(listener.port, 'POST', '/api/tts', { text: '第二句' });
        await new Promise((resolve) => setImmediate(resolve));
        const rejected = await request(listener.port, 'POST', '/api/tts', { text: '第三句' });

        assert.equal(rejected.statusCode, 503);
        assert.equal(releases.length, 1);

        releases.shift()(Buffer.from('first'));
        const firstResponse = await first;
        assert.equal(firstResponse.statusCode, 200);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(releases.length, 1);

        releases.shift()(Buffer.from('second'));
        const secondResponse = await second;
        assert.equal(secondResponse.statusCode, 200);
    } finally {
        await listener.close();
    }
});
