'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
    DEFAULT_SERVER_URL,
    resolveServerUrl,
    buildRestartUrl,
    buildRequestOptions
} = require('../scripts/ops/restart-server-config');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_FILE = path.join(ROOT, 'package.json');
const SCRIPT_FILE = path.join(ROOT, 'scripts/ops/restart-server.js');

test('npm 提供 restart:server 命令并指向重启脚本', () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
    assert.strictEqual(packageJson.scripts['restart:server'], 'node scripts/ops/restart-server.js');
    assert.ok(fs.existsSync(SCRIPT_FILE), '重启脚本应存在');
});

test('默认地址、环境变量和命令行地址按优先级解析', () => {
    assert.strictEqual(resolveServerUrl({}, []), DEFAULT_SERVER_URL);
    assert.strictEqual(
        resolveServerUrl({ AASC_SERVER_URL: ' https://env.example:8081 ' }, []),
        'https://env.example:8081'
    );
    assert.strictEqual(
        resolveServerUrl({ AASC_SERVER_URL: 'https://env.example:8081' }, ['http://cli.example:8081']),
        'http://cli.example:8081'
    );
});

test('重启 URL 拼接不会产生双斜杠并清除查询参数', () => {
    assert.strictEqual(
        buildRestartUrl('https://example.test:8081///?unused=true').toString(),
        'https://example.test:8081/api/restart'
    );
});

test('请求配置使用原生协议且不设置代理 Agent', () => {
    const options = buildRequestOptions(buildRestartUrl('https://example.test:8081'));
    assert.strictEqual(options.protocol, 'https:');
    assert.strictEqual(options.method, 'POST');
    assert.strictEqual(options.rejectUnauthorized, false);
    assert.ok(!Object.hasOwn(options, 'agent'), '不应配置代理 Agent');
});
