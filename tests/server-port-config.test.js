'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cheerio = require('../node_modules/cheerio');
const configService = require('../src/apps/server/modules/config/config-app-service');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const server = read('src/apps/server/boot/server-app.js');
const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
const controlSocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
const display = read('src/apps/web-mediacenter/ui/public/display.html');

test('服务器端口规范化和校验接受有效边界并拒绝非法值', () => {
    assert.equal(configService.getDefaultServerPort(), 8081);
    assert.equal(configService.normalizeServerPort(undefined), 8081);
    assert.equal(configService.normalizeServerPort(1), 1);
    assert.equal(configService.normalizeServerPort(65535), 65535);
    assert.equal(configService.normalizeServerPort(0), 8081);
    assert.equal(configService.normalizeServerPort(65536), 8081);
    assert.equal(configService.validateServerPort(1).ok, true);
    assert.equal(configService.validateServerPort(65535).ok, true);
    for (const value of [0, 65536, 8081.5, '8081', null]) {
        assert.equal(configService.validateServerPort(value).ok, false, `应拒绝 ${String(value)}`);
    }
});

test('端口设置使用控制端 WebSocket 权威配置并在变更时托管重启', () => {
    assert.match(upload, /id="serverPortInput" type="number" min="1" max="65535" step="1"/);
    assert.match(upload, /type: 'setServerPortConfig', port/);
    assert.match(upload, /mode: 'no-cors', cache: 'no-store'/);
    assert.match(upload, /window\.location\.assign\(targetUrl\.href\)/);
    assert.match(controlSocket, /serverPortConfigError/);
    assert.match(server, /'setServerPortConfig'/);
    assert.match(server, /if \(!controlClients\.has\(ws\)\) return;[\s\S]{0,500}config\.validateServerPort\(data\.port\)/);
    assert.match(server, /config\.set\('server\.port', validation\.port\)/);
    assert.match(server, /const restartRequired = validation\.port !== PORT/);
    assert.match(server, /if \(restartRequired\) requestManagedServerRestart\(1000\)/);
    assert.match(server, /if \(serverRestartScheduled\)[\s\S]{0,220}服务端正在重启，暂时不能修改端口/);
    assert.match(server, /type: 'serverPortConfig',[\s\S]{0,150}port: getServerPortConfig\(\)/);
    assert.match(server, /function broadcastServerPortConfig\(message\)[\s\S]{0,160}displayClients\.forEach/);
    assert.match(display, /if \(data\.type === 'serverPortConfig'\)[\s\S]{0,120}waitForDisplayServerPort/);
    assert.match(display, /function waitForDisplayServerPort\(port\)/);
    assert.doesNotMatch(server, /\/api\/config\/serverPort/);
});

test('控制端和显示端内联脚本可解析', () => {
    for (const [filename, html] of [['upload.html', upload], ['display.html', display]]) {
        const $ = cheerio.load(html);
        $('script:not([src])').each((index, element) => {
            const type = String($(element).attr('type') || '').toLowerCase();
            if (type && type !== 'text/javascript' && type !== 'application/javascript') return;
            const source = $(element).text();
            if (!source.trim()) return;
            assert.doesNotThrow(() => new vm.Script(source, { filename: `${filename}:inline-${index + 1}` }));
        });
    }
});
