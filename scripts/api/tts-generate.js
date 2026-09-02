#!/usr/bin/env node
'use strict';

const { requestText, runCli, validateNumber } = require('./common');

function printHelp() {
    process.stdout.write(`用法：tts-generate.js --text TEXT [--voice VOICE] [--speed NUMBER]

调用 POST /api/tts/generate，成功时输出包含 audioUrl 的 JSON。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
`);
}

async function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        printHelp();
        if (argv.length === 0) process.exitCode = 2;
        return;
    }
    let text = '';
    let voice;
    let speed;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--text' || arg === '--voice' || arg === '--speed') {
            if (!argv[index + 1]) throw new Error(`${arg} 缺少参数`);
            const value = argv[++index];
            if (arg === '--text') text = value;
            if (arg === '--voice') voice = value;
            if (arg === '--speed') speed = value;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            return;
        } else {
            throw new Error(`未知参数：${arg}`);
        }
    }
    if (!text) throw new Error('必须指定 --text');
    const body = { text };
    if (voice !== undefined) body.voice = voice;
    if (speed !== undefined) {
        validateNumber(speed);
        body.speed = Number(speed);
    }
    process.stdout.write(await requestText('POST', '/api/tts/generate', { json: body }));
}

if (require.main === module) runCli(main);

module.exports = { main };
