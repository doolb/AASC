#!/usr/bin/env node
'use strict';

const { requestText, runCli } = require('./common');

function printHelp() {
    process.stdout.write('用法：health.js\n\n调用 GET /api/status，成功时输出服务器 JSON 状态。\n环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS\n');
}

async function main(argv = process.argv.slice(2)) {
    if (argv[0] === '--help' || argv[0] === '-h') {
        printHelp();
        return;
    }
    if (argv.length > 0) throw new Error(`未知参数：${argv[0]}`);
    process.stdout.write(await requestText('GET', '/api/status'));
}

if (require.main === module) runCli(main);

module.exports = { main };
