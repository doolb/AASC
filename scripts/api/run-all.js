#!/usr/bin/env node
'use strict';

const { requestText, runCli } = require('./common');

function printHelp() {
    process.stdout.write(`用法：run-all.js

探测服务器状态、ASR、TTS、视觉、媒体和系统统计接口。
所有探测均为只读请求；成功输出 JSON Lines，任一接口失败时返回非零状态。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
`);
}

async function main(argv = process.argv.slice(2)) {
    if (argv[0] === '--help' || argv[0] === '-h') {
        printHelp();
        return;
    }
    if (argv.length > 0) throw new Error(`未知参数：${argv[0]}`);
    const probes = [
        ['server', '/api/status'],
        ['asr', '/api/asr/status'],
        ['tts', '/api/tts/config'],
        ['vision', '/api/vision/status'],
        ['media', '/media-list'],
        ['actors', '/api/actors'],
        ['system-stats', '/api/system-stats']
    ];
    let failed = false;
    for (const [name, route] of probes) {
        try {
            const response = await requestText('GET', route);
            process.stdout.write(`${JSON.stringify({ name, ok: true, response: JSON.parse(response) })}\n`);
        } catch (error) {
            failed = true;
            const message = error.body || error.message || String(error);
            process.stdout.write(`${JSON.stringify({ name, ok: false, error: message })}\n`);
        }
    }
    if (failed) process.exitCode = 1;
}

if (require.main === module) runCli(main);

module.exports = { main };
