'use strict';

const DEFAULT_SERVER_URL = 'https://192.168.1.39:8081';

function resolveServerUrl(environment = process.env, commandArguments = []) {
    const commandUrl = commandArguments.find((value) => typeof value === 'string' && value.trim());
    const environmentUrl = typeof environment.AASC_SERVER_URL === 'string'
        ? environment.AASC_SERVER_URL.trim()
        : '';
    return commandUrl ? commandUrl.trim() : (environmentUrl || DEFAULT_SERVER_URL);
}

function buildRestartUrl(serverUrl) {
    let parsed;
    try {
        parsed = new URL(serverUrl);
    } catch (error) {
        throw new Error(`服务器地址格式无效: ${serverUrl}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`服务器地址必须使用 http 或 https: ${serverUrl}`);
    }

    const basePath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${basePath}/api/restart`;
    parsed.search = '';
    parsed.hash = '';
    return parsed;
}

function buildRequestOptions(restartUrl, timeoutMs = 10000) {
    const options = {
        protocol: restartUrl.protocol,
        hostname: restartUrl.hostname,
        port: restartUrl.port || undefined,
        path: `${restartUrl.pathname}${restartUrl.search}`,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': '2'
        }
    };

    // 项目服务器使用自签名证书；Node 原生请求不会读取 HTTPS_PROXY，也不会自动使用代理。
    if (restartUrl.protocol === 'https:') {
        options.rejectUnauthorized = false;
    }

    return options;
}

module.exports = {
    DEFAULT_SERVER_URL,
    resolveServerUrl,
    buildRestartUrl,
    buildRequestOptions
};
