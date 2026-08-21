'use strict';

const http = require('node:http');
const https = require('node:https');
const {
    resolveServerUrl,
    buildRestartUrl,
    buildRequestOptions
} = require('./restart-server-config');

const REQUEST_TIMEOUT_MS = 10000;

function requestRestart(restartUrl) {
    const client = restartUrl.protocol === 'https:' ? https : http;
    const options = buildRequestOptions(restartUrl, REQUEST_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
        const request = client.request(options, (response) => {
            const chunks = [];
            response.setEncoding('utf8');
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const body = chunks.join('');
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`服务器返回 HTTP ${response.statusCode}: ${body || '无响应内容'}`));
                    return;
                }

                try {
                    resolve(body ? JSON.parse(body) : {});
                } catch (error) {
                    resolve({ message: body });
                }
            });
        });

        request.once('timeout', () => {
            request.destroy(new Error(`请求服务器重启接口超时（${REQUEST_TIMEOUT_MS}ms）`));
        });
        request.once('error', reject);
        request.end('{}');
    });
}

async function main(commandArguments = process.argv.slice(2), environment = process.env) {
    try {
        const serverUrl = resolveServerUrl(environment, commandArguments);
        const restartUrl = buildRestartUrl(serverUrl);
        console.log(`正在请求服务器重启: ${restartUrl.origin}`);
        const result = await requestRestart(restartUrl);
        console.log(result.message || '服务器正在重启...');
        return result;
    } catch (error) {
        console.error(`服务器重启失败: ${error.message}`);
        process.exitCode = 1;
        return null;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    REQUEST_TIMEOUT_MS,
    requestRestart,
    main
};
