'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const run = promisify(execFile);
const mainPath = path.resolve(__dirname, '../src/apps/voice-display-node/main.js');
const mainSource = fs.readFileSync(mainPath, 'utf8');
const loaderStart = mainSource.indexOf('function loadConfig(configPath) {');
const loaderEnd = mainSource.indexOf('\n/**', loaderStart);

function loadWithReader(readFileSync, file = '/tmp/aasc-test-config.json') {
    const context = { fs: { readFileSync }, path, os, require, configPath: file };
    return vm.runInNewContext(`${mainSource.slice(loaderStart, loaderEnd)}; loadConfig(configPath);`, context);
}

test('配置文件读取/JSON/对象/服务器地址错误都携带路径和阶段，不回退默认服务器', () => {
    const invalid = [
        ['{', 'JSON解析'], ['null', '字段校验'], ['[]', '字段校验'], ['"text"', '字段校验'],
        ['{}', 'serverUrl'], ['{"serverUrl":""}', 'serverUrl'], ['{"serverUrl":3}', 'serverUrl'],
        ['{"serverUrl":"localhost:3000"}', 'HTTP/HTTPS'], ['{"serverUrl":"file:///tmp/config"}', 'HTTP/HTTPS'],
        ['{"serverUrl":"http:localhost"}', 'HTTP/HTTPS'], ['{"serverUrl":"https:/server"}', 'HTTP/HTTPS'],
        ['{"serverUrl":"not a url"}', '字段校验']
    ];
    for (const [text, expected] of invalid) {
        assert.throws(() => loadWithReader(() => text), error => {
            assert.ok(error.message.includes(path.resolve('/tmp/aasc-test-config.json')));
            assert.ok(error.message.includes(expected), error.message);
            return true;
        });
    }
    for (const code of ['ENOENT', 'EACCES']) {
        assert.throws(() => loadWithReader(() => { throw Object.assign(new Error(`${code}: fixture`), { code }); }),
            new RegExp(`读取失败：${code}`));
    }
});

test('有效配置保留显式地址和mpv，缺省声纹关闭与稳定hostname身份继续生效', () => {
    const config = loadWithReader(() => JSON.stringify({ serverUrl: '  https://10.0.0.8:8081  ',
        displayId: 'old-ignored', mediaPlayer: { enabled: true, windows: { command: 'B:\\mpv.exe' } } }));
    assert.equal(config.serverUrl, 'https://10.0.0.8:8081');
    assert.equal(config.displayId, `voice-display-node-${os.hostname()}`);
    assert.equal(config.textInput.requireVoiceprint, false);
    assert.equal(config.mediaPlayer.windows.command, 'B:\\mpv.exe');
    assert.equal(config.mediaPlayer.enabled, true);
});

test('真实启动时配置错误在TUI前写ERROR并退出1，不加载网络/录音/播放器依赖', async t => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'aasc-config-test-'));
    t.after(() => fsp.rm(directory, { recursive: true, force: true }));
    const marker = path.join(directory, 'side-effects.txt');
    const preload = path.join(directory, 'preload.cjs');
    await fsp.writeFile(preload, `const Module = require('node:module');\nconst fs = require('node:fs');\nconst original = Module._load;\nModule._load = function(name, ...args) {\n if (['ws', './tui', './audio-player', './audio-recorder-pv', './audio-recorder'].includes(name)) fs.appendFileSync(process.env.AASC_CONFIG_TEST_MARKER, name + '\\n');\n return original.call(this, name, ...args);\n};\n`);
    const badJson = path.join(directory, 'bad config.json');
    const badAddress = path.join(directory, 'bad-address.json');
    await fsp.writeFile(badJson, '{');
    await fsp.writeFile(badAddress, '{"serverUrl":"ftp://10.0.0.8"}');
    for (const args of [[badJson], ['--no-tui', badJson], [path.join(directory, 'missing.json')], [badAddress]]) {
        await assert.rejects(run(process.execPath, ['--require', preload, mainPath, ...args], {
            env: { ...process.env, AASC_CONFIG_TEST_MARKER: marker }, timeout: 5000
        }), error => {
            assert.equal(error.code, 1);
            assert.match(error.stderr, /\[ERROR\]\[配置\]/);
            assert.ok(error.stderr.includes(args.at(-1)));
            assert.match(error.stderr, /失败/);
            assert.doesNotMatch(error.stdout, /正在连接|Voice Display/);
            return true;
        });
    }
    assert.equal(fs.existsSync(marker), false);
});

test('Windows启动器在自身目录调用npm，失败暂停并保留退出码', () => {
    const batch = fs.readFileSync(path.resolve(__dirname, '../src/apps/voice-display-node/start.bat'), 'utf8');
    assert.match(batch, /cd \/d "%~dp0"/i);
    assert.match(batch, /call npm start -- %\*/i);
    assert.match(batch, /set "AASC_START_EXIT_CODE=%ERRORLEVEL%"/i);
    assert.match(batch, /if not "%AASC_START_EXIT_CODE%"=="0" pause/i);
    assert.match(batch, /exit \/b %AASC_START_EXIT_CODE%/i);
});
