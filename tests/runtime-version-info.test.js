'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getRuntimeVersionInfo } = require('../src/apps/server/modules/aasc/runtime-version-info');

function createProjectRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-runtime-version-'));
}

test('版本信息优先读取 Offline active-release 指针', () => {
    const projectRoot = createProjectRoot();
    try {
        fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        fs.mkdirSync(path.join(projectRoot, 'updates'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'offline-update-client.json'), JSON.stringify({
            codeVersion: 13,
            dependencyVersion: 4
        }));
        fs.writeFileSync(path.join(projectRoot, 'updates', 'active-release.json'), JSON.stringify({
            codeVersion: 17,
            dependencyVersion: 4
        }));

        assert.deepEqual(getRuntimeVersionInfo({
            projectRoot,
            serverVersion: 'apk-0.2.24-offline-min',
            displayVersion: 12345
        }), {
            apk: 'apk-0.2.24-offline-min',
            code: 'v17',
            dependencies: 'v4',
            display: '12345',
            codePath: projectRoot,
            dependenciesPath: path.join(projectRoot, 'node_modules'),
            dependencySource: 'active-release'
        });
    } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('没有热更新指针时回退到完整 APK 的服务基线', () => {
    const projectRoot = createProjectRoot();
    try {
        fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        fs.writeFileSync(path.join(projectRoot, 'offline-update-client.json'), JSON.stringify({
            codeVersion: 13,
            dependencyVersion: 4
        }));

        assert.deepEqual(getRuntimeVersionInfo({ projectRoot }), {
            apk: '1.0.0',
            code: 'v13',
            dependencies: 'v4',
            display: '未提供',
            codePath: projectRoot,
            dependenciesPath: path.join(projectRoot, 'node_modules'),
            dependencySource: 'bundled-baseline'
        });
    } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('版本信息返回实际代码路径、依赖路径和兼容来源', () => {
    const projectRoot = createProjectRoot();
    const codeRoot = path.join(projectRoot, 'updates', 'code', 'code-v18');
    const nodeModulesRoot = path.join(projectRoot, 'updates', 'dependencies', 'dependencies-v4', 'node_modules');
    try {
        fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        fs.mkdirSync(path.join(projectRoot, 'updates'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'updates', 'active-release.json'), JSON.stringify({
            codeVersion: 18,
            dependencyVersion: 4,
            legacyDependencies: true
        }));

        assert.deepEqual(getRuntimeVersionInfo({
            projectRoot,
            codeRoot,
            nodeModulesRoot
        }), {
            apk: '1.0.0',
            code: 'v18',
            dependencies: 'v4',
            display: '未提供',
            codePath: codeRoot,
            dependenciesPath: nodeModulesRoot,
            dependencySource: 'legacy-root'
        });
    } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
});
