#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { URL } = require('node:url');

const DEFAULT_URL = 'https://127.0.0.1:8081';
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 5;

class ApiError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = details.statusCode || 0;
        this.body = details.body || '';
        this.code = details.code || '';
        this.exitCode = details.exitCode || 1;
    }
}

function apiUrl(route, baseUrl = process.env.AASC_URL || DEFAULT_URL) {
    const routeText = String(route || '');
    if (/^https?:\/\//iu.test(routeText)) return new URL(routeText);
    const base = String(baseUrl).replace(/\/+$/u, '');
    return new URL(`${base}/${routeText.replace(/^\/+/u, '')}`);
}

function requireFile(filePath) {
    const resolvedPath = path.resolve(String(filePath || ''));
    try {
        const stat = fs.statSync(resolvedPath);
        fs.accessSync(resolvedPath, fs.constants.R_OK);
        if (!stat.isFile()) throw new Error('不是文件');
    } catch (error) {
        throw new ApiError(`文件不存在或不可读：${filePath}`, { code: 'API_FILE_INVALID' });
    }
    return resolvedPath;
}

function parseKeyValue(value, optionName) {
    const separator = String(value || '').indexOf('=');
    if (separator <= 0) throw new ApiError(`${optionName} 格式必须是 KEY=VALUE`, { code: 'API_ARGUMENT_INVALID' });
    return {
        key: String(value).slice(0, separator),
        value: String(value).slice(separator + 1)
    };
}

function parseHeader(value) {
    const separator = String(value || '').indexOf(':');
    if (separator <= 0) throw new ApiError('--header 格式必须是 Name: Value', { code: 'API_ARGUMENT_INVALID' });
    return {
        key: String(value).slice(0, separator).trim(),
        value: String(value).slice(separator + 1).trim()
    };
}

function hasHeader(headers, name) {
    const target = name.toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function escapeHeaderValue(value) {
    return String(value).replace(/[\r\n"]/gu, '_');
}

function buildMultipartBody(fields = [], files = []) {
    const boundary = `----AascApiBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const chunks = [];
    const appendField = (name, value) => {
        chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${escapeHeaderValue(name)}"\r\n\r\n${String(value)}\r\n`,
            'utf8'
        ));
    };
    for (const field of fields) appendField(field.key, field.value);
    for (const file of files) {
        const filename = escapeHeaderValue(file.filename || path.basename(file.path));
        const contentType = file.contentType || 'application/octet-stream';
        chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${escapeHeaderValue(file.key)}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
            'utf8'
        ));
        chunks.push(fs.readFileSync(file.path));
        chunks.push(Buffer.from('\r\n', 'utf8'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return {
        body: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`
    };
}

function requestApi(method, route, options = {}) {
    const url = apiUrl(route, options.baseUrl);
    const headers = { ...(options.headers || {}) };
    let body = null;

    if (options.json !== undefined) {
        body = Buffer.from(typeof options.json === 'string' ? options.json : JSON.stringify(options.json), 'utf8');
        if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    } else if ((Array.isArray(options.fields) && options.fields.length > 0)
        || (Array.isArray(options.files) && options.files.length > 0)) {
        const multipart = buildMultipartBody(options.fields || [], options.files || []);
        body = multipart.body;
        if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = multipart.contentType;
    } else if (options.body !== undefined && options.body !== null) {
        body = Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body), 'utf8');
    }

    if (body && !hasHeader(headers, 'content-length')) headers['Content-Length'] = body.length;
    const timeoutSeconds = Number(options.timeoutSeconds || process.env.AASC_TIMEOUT_SECONDS || DEFAULT_TIMEOUT_SECONDS);
    const connectTimeoutSeconds = Number(options.connectTimeoutSeconds || process.env.AASC_CONNECT_TIMEOUT_SECONDS || DEFAULT_CONNECT_TIMEOUT_SECONDS);
    const transport = url.protocol === 'https:' ? https : http;
    const requestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: String(method).toUpperCase(),
        headers,
        rejectUnauthorized: process.env.AASC_INSECURE === '0'
    };

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(maxTimer);
            callback(value);
        };
        const request = transport.request(requestOptions, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('error', (error) => finish(reject, error));
            response.on('end', () => finish(resolve, {
                statusCode: response.statusCode || 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8')
            }));
        });
        const maxTimer = setTimeout(() => {
            const error = new ApiError(`请求超时（${timeoutSeconds}s）`, { code: 'API_TIMEOUT' });
            request.destroy(error);
            finish(reject, error);
        }, Math.max(1, timeoutSeconds) * 1000);
        request.on('socket', (socket) => {
            let socketConnected = false;
            socket.setTimeout(Math.max(1, connectTimeoutSeconds) * 1000);
            socket.once('connect', () => {
                socketConnected = true;
                socket.setTimeout(Math.max(1, timeoutSeconds) * 1000);
            });
            socket.on('timeout', () => {
                const error = new ApiError(
                    socketConnected ? `请求超时（${timeoutSeconds}s）` : `连接超时（${connectTimeoutSeconds}s）`,
                    { code: socketConnected ? 'API_TIMEOUT' : 'API_CONNECT_TIMEOUT' }
                );
                request.destroy(error);
                finish(reject, error);
            });
        });
        request.on('error', (error) => finish(reject, error));
        request.end(body);
    });
}

async function requestText(method, route, options = {}) {
    const response = await requestApi(method, route, options);
    if (response.statusCode >= 400) {
        throw new ApiError(response.body || `HTTP ${response.statusCode}`, {
            statusCode: response.statusCode,
            body: response.body,
            exitCode: 22
        });
    }
    return response.body;
}

function jsonString(value) {
    return JSON.stringify(String(value));
}

function validateNumber(value) {
    if (!/^-?[0-9]+(?:\.[0-9]+)?$/u.test(String(value))) {
        throw new ApiError(`数值参数无效：${value}`, { code: 'API_ARGUMENT_INVALID' });
    }
}

function validateShortSide(value) {
    const number = Number(value);
    if (!/^\d+$/u.test(String(value)) || (number !== 0 && (number < 256 || number > 2048))) {
        throw new ApiError('OCR 短边必须为 0 或 256..2048 的整数', { code: 'API_ARGUMENT_INVALID' });
    }
}

function isDangerousRoute(method, route) {
    const normalizedMethod = String(method).toUpperCase();
    const normalizedRoute = String(route);
    if (normalizedMethod === 'DELETE') return true;
    if (normalizedMethod !== 'POST') return false;
    return [
        '/api/restart',
        '/api/chat/clear',
        '/api/chat/round',
        '/api/ai-roles/stop-all',
        '/api/chat/history/import',
        '/api/aasc-user/import',
        '/api/voiceprint/remove'
    ].some((prefix) => normalizedRoute.startsWith(prefix));
}

function requireConfirmation(method, route, confirmed = false) {
    if (isDangerousRoute(method, route) && !confirmed && process.env.API_CONFIRM !== '1') {
        throw new ApiError(`操作“${String(method).toUpperCase()} ${route}”有副作用，请设置 API_CONFIRM=1 或传入 --confirm`, {
            code: 'API_CONFIRMATION_REQUIRED'
        });
    }
}

function runCli(main) {
    Promise.resolve()
        .then(main)
        .catch((error) => {
            const output = error.body || error.message || String(error);
            process.stderr.write(`${output}${output.endsWith('\n') ? '' : '\n'}`);
            process.exitCode = error.exitCode || 1;
        });
}

module.exports = {
    ApiError,
    apiUrl,
    buildMultipartBody,
    isDangerousRoute,
    jsonString,
    parseHeader,
    parseKeyValue,
    requestApi,
    requestText,
    requireConfirmation,
    requireFile,
    runCli,
    validateNumber,
    validateShortSide
};
