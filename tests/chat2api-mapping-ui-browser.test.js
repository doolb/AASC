'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

test('豆包Android完成后账号可见并能点击复验，独立Chromium仅使用虚构接口', { timeout: 45000 }, async () => {
    const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath()].find(file => file && fs.existsSync(file));
    assert.ok(executablePath);
    const temporaryDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '..'), '.tmp-chat2api-login-'));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: path.join(temporaryDir, 'profile'), args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent('<html><body></body></html>');
        await page.evaluate(() => {
            window.savedAccounts = [];
            window.completeCalls = 0;
            window.verifyCalls = 0;
            window.fetch = async (url, options = {}) => {
                const endpoint = new URL(url).pathname;
                const provider = { id: 'doubaochat', publicId: 'doubao', credentialFields: [{ name: 'cookie', type: 'textarea' }] };
                let body;
                if (endpoint === '/api/chat2api/oauth/complete') {
                    window.completeCalls++;
                    const input = JSON.parse(options.body);
                    if (input.credentials.cookie !== 'fictional-cookie') throw new Error('原生凭据未传递');
                    const account = { accountId: 'fictional-account', providerId: 'doubaochat', label: '测试豆包', accountInfo: { credentialVerification: 'format-only', credentialVerificationStatus: 'failed', credentialVerificationError: 'risk' } };
                    window.savedAccounts.push(account);
                    body = { account };
                } else if (endpoint === '/api/chat2api/accounts/fictional-account/verify') {
                    window.verifyCalls++;
                    window.savedAccounts[0].accountInfo = { credentialVerification: 'conversation-list' };
                    body = { account: window.savedAccounts[0] };
                } else {
                    const values = { '/api/chat2api/config': {}, '/api/chat2api/providers': [provider], '/api/chat2api/accounts': window.savedAccounts,
                        '/api/chat2api/api-keys': [], '/api/chat2api/model-mappings': [] };
                    if (!Object.hasOwn(values, endpoint)) throw new Error('意外请求');
                    body = values[endpoint];
                }
                return { ok: true, json: async () => body };
            };
        });
        await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat2api.js'), 'utf8') });
        await page.evaluate(async () => {
            const control = window.Chat2APIControl;
            await control.open();
            control.loginSession = { state: 'fictional-state', providerId: 'doubaochat' };
            await control.completeNativeLogin({ success: true, state: 'fictional-state', providerId: 'doubaochat', credentials: { cookie: 'fictional-cookie' } });
        });
        assert.equal(await page.evaluate(() => window.completeCalls), 1);
        assert.match(await page.$eval('#chat2apiAccounts', node => node.textContent), /测试豆包.*未远端验证/);
        assert.match(await page.$eval('#chat2apiMessage', node => node.textContent), /账号已保存.*接口拒绝访问/);
        await page.click('[data-chat2api-account-verify="fictional-account"]');
        await page.waitForFunction(() => document.querySelector('#chat2apiMessage').textContent.includes('会话列表访问已验证'));
        assert.equal(await page.evaluate(() => window.verifyCalls), 1);
        assert.match(await page.$eval('#chat2apiAccounts', node => node.textContent), /会话列表已验证/);
    } finally {
        if (browser) await browser.close();
        const root = path.resolve(__dirname, '..');
        assert.ok(path.resolve(temporaryDir).startsWith(root + path.sep));
        assert.ok(path.basename(temporaryDir).startsWith('.tmp-chat2api-login-'));
        fs.rmSync(temporaryDir, { recursive: true, force: true });
    }
});

test('模型映射编辑保存保留 TTS 默认值、账号偏好和旧文字映射', { timeout: 45000 }, async () => {
    const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath()].find(file => file && fs.existsSync(file));
    assert.ok(executablePath, '浏览器验证需要可用 Chromium');
    const temporaryDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '..'), '.tmp-chat2api-mapping-'));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: path.join(temporaryDir, 'profile'), args: ['--no-sandbox'] });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<html><body></body></html>');
        await page.evaluate(() => {
            const providers = [
                { id: 'qwen', publicId: 'qwen', name: 'qwen', credentialFields: [{ name: 'token', type: 'password' }] },
                { id: 'qwen-api', publicId: 'qwen-api', name: 'qwen-api', credentialFields: [{ name: 'apiKey', type: 'password' }, { name: 'endpoint', type: 'text', helpText: '留空使用官方默认端点' }] },
                { id: 'doubaochat', publicId: 'doubao', name: 'doubao', credentialFields: [{ name: 'cookie', type: 'textarea' }] },
                { id: 'doubaapi', publicId: 'doubaapi', name: 'doubaapi', credentialFields: [{ name: 'apiKey', type: 'password' }, { name: 'endpoint', type: 'text' }, { name: 'resourceId', type: 'text', helpText: '留空使用默认资源' }] },
            ];
            window.savedMappings = [];
            window.manualAccounts = [];
            window.importedConfigs = [];
            window.confirm = () => true;
            window.NativeControl = { openChat2ApiLogin: () => { throw new Error('API 账号不得启动网页登录'); }, saveDownloadFile: (name, mime, encoded) => {
                window.exportedConfig = JSON.parse(atob(encoded));
                return JSON.stringify({ ok: true });
            } };
            window.mappings = [
                { model: 'qiaoxiaojiao', actualModel: 'qwen-api/qwen-audio-3.1-tts-flash', preferredProviderId: 'qwen-api', preferredAccountId: 'api-account', application: 'tts', parameters: { voice: 'qiaoxiaojiao_v3.1', speed: 1.25, volume: 70, format: 'wav' } },
                { model: 'qwen3.6flash', actualModel: 'qwen3.6-flash', preferredProviderId: 'qwen', preferredAccountId: 'web-account' },
                { model: 'unavailable-voice', actualModel: 'qwen-chat', preferredProviderId: 'unavailable-provider', preferredAccountId: 'unavailable-account', application: 'tts' },
            ];
            window.fetch = async (url, options = {}) => {
                const endpoint = new URL(url).pathname;
                let body;
                if (endpoint === '/api/chat2api/export') {
                    return { ok: true, blob: async () => new Blob([JSON.stringify({ modelMappings: window.mappings })], { type: 'application/json' }) };
                }
                if (endpoint === '/api/chat2api/import/preview') {
                    body = { counts: { modelMappings: JSON.parse(options.body).modelMappings.length } };
                } else if (endpoint === '/api/chat2api/import/merge') {
                    const imported = JSON.parse(options.body);
                    window.importedConfigs.push(imported.data);
                    window.mappings = imported.data.modelMappings;
                    body = { counts: { modelMappings: window.mappings.length } };
                } else if (endpoint === '/api/chat2api/accounts/manual') {
                    window.manualAccounts.push(JSON.parse(options.body));
                    body = { accountId: 'api-account', providerId: 'qwen-api', accountInfo: { credentialVerification: 'format-only' } };
                } else if (endpoint.endsWith('/model-mappings') && options.method === 'POST') {
                    body = JSON.parse(options.body);
                    window.savedMappings.push(body);
                    window.mappings = [...window.mappings.filter(row => row.model !== body.model), body];
                } else {
                    const values = {
                        '/api/chat2api/config': {}, '/api/chat2api/providers': providers,
                        '/api/chat2api/accounts': [{ accountId: 'api-account', providerId: 'qwen-api', enabled: true, accountInfo: { credentialVerification: 'format-only' } }, { accountId: 'web-account', providerId: 'qwen', enabled: true }],
                        '/api/chat2api/api-keys': [], '/api/chat2api/model-mappings': window.mappings,
                    };
                    if (!Object.hasOwn(values, endpoint)) throw new Error(`意外管理请求 ${endpoint}`);
                    body = values[endpoint];
                }
                return { ok: true, json: async () => body };
            };
        });
        await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat2api.js'), 'utf8') });
        await page.evaluate(() => window.Chat2APIControl.open());
        assert.deepEqual(await page.$$eval('#chat2apiProvider option', nodes => nodes.map(node => node.textContent)), ['qwen', 'qwen-api', 'doubao', 'doubaapi']);
        await page.click('[data-chat2api-mapping-edit="qiaoxiaojiao"]');
        const values = await page.evaluate(() => Object.fromEntries(['Application', 'Voice', 'Speed', 'Volume', 'Format'].map(name => [name, document.getElementById(`chat2apiMapping${name}`)?.value ?? null])));
        assert.deepEqual(values, { Application: 'tts', Voice: 'qiaoxiaojiao_v3.1', Speed: '1.25', Volume: '70', Format: 'wav' });
        assert.match(await page.$eval('#chat2apiAccounts', node => node.textContent), /未远端验证/u);
        await page.evaluate(() => window.Chat2APIControl.saveModelMapping());
        assert.deepEqual(await page.evaluate(() => window.savedMappings.at(-1)), {
            model: 'qiaoxiaojiao', actualModel: 'qwen-api/qwen-audio-3.1-tts-flash', preferredProviderId: 'qwen-api', preferredAccountId: 'api-account', application: 'tts', parameters: { voice: 'qiaoxiaojiao_v3.1', speed: 1.25, volume: 70, format: 'wav' },
        });
        assert.match(await page.$eval('[data-chat2api-mapping-edit="qiaoxiaojiao"]', node => node.closest('.chat2api-mapping-row').textContent), /tts.*qiaoxiaojiao_v3\.1/u);
        await page.click('[data-chat2api-mapping-edit="qwen3.6flash"]');
        assert.deepEqual(await page.evaluate(() => ['Application', 'Voice', 'Speed', 'Volume', 'Format'].map(name => document.getElementById(`chat2apiMapping${name}`).value)), ['', '', '', '', '']);
        await page.evaluate(() => window.Chat2APIControl.saveModelMapping());
        assert.deepEqual(await page.evaluate(() => window.savedMappings.at(-1)), { model: 'qwen3.6flash', actualModel: 'qwen3.6-flash', preferredProviderId: 'qwen', preferredAccountId: 'web-account' });
        await page.click('[data-chat2api-mapping-edit="unavailable-voice"]');
        await page.evaluate(() => window.Chat2APIControl.saveModelMapping());
        assert.deepEqual(await page.evaluate(() => window.savedMappings.at(-1)), { model: 'unavailable-voice', actualModel: 'qwen-chat', preferredProviderId: 'unavailable-provider', preferredAccountId: 'unavailable-account', application: 'tts' });
        await page.click('[data-chat2api-mapping-edit="qiaoxiaojiao"]');
        await page.$eval('#chat2apiMappingSpeed', node => { node.value = '0'; });
        await page.evaluate(() => window.Chat2APIControl.saveModelMapping());
        assert.equal(await page.evaluate(() => window.savedMappings.length), 3);
        assert.match(await page.$eval('#chat2apiMessage', node => node.textContent), /语速/u);
        await page.evaluate(() => window.Chat2APIControl.exportConfig());
        const exported = await page.evaluate(() => window.exportedConfig);
        assert.deepEqual(exported.modelMappings.find(row => row.model === 'qiaoxiaojiao'), {
            model: 'qiaoxiaojiao', actualModel: 'qwen-api/qwen-audio-3.1-tts-flash', preferredProviderId: 'qwen-api', preferredAccountId: 'api-account', application: 'tts', parameters: { voice: 'qiaoxiaojiao_v3.1', speed: 1.25, volume: 70, format: 'wav' },
        });
        await page.evaluate(value => window.Chat2APIControl.importConfigFile(new File([JSON.stringify(value)], 'mapping.json', { type: 'application/json' })), exported);
        assert.deepEqual(await page.evaluate(() => window.importedConfigs.at(-1)), exported);
        await page.click('[data-chat2api-mapping-edit="qiaoxiaojiao"]');
        assert.equal(await page.$eval('#chat2apiMappingVoice', input => input.value), 'qiaoxiaojiao_v3.1');
        await page.select('#chat2apiProvider', 'qwen-api');
        assert.equal(await page.$eval('#chat2apiOpenLogin', button => button.hidden), true);
        assert.match(await page.$eval('#chat2apiManualHint', node => node.textContent), /格式/u);
        await page.type('[data-chat2api-credential="apiKey"]', 'fictional-api-key');
        await page.type('[data-chat2api-credential="endpoint"]', 'https://test.invalid/tts');
        await page.evaluate(() => window.Chat2APIControl.addManualAccount());
        assert.deepEqual(await page.evaluate(() => window.manualAccounts.at(-1).credentials), { apiKey: 'fictional-api-key', endpoint: 'https://test.invalid/tts' });
        assert.match(await page.$eval('#chat2apiMessage', node => node.textContent), /尚未.*远端验证/u);
        assert.equal(await page.$$eval('[data-chat2api-credential]', inputs => inputs.every(input => input.value === '')), true);
        await page.select('#chat2apiProvider', 'doubaapi');
        await page.type('[data-chat2api-credential="apiKey"]', 'fictional-doubao-key');
        await page.type('[data-chat2api-credential="resourceId"]', 'seed-tts-2.0');
        await page.evaluate(() => window.Chat2APIControl.addManualAccount());
        assert.deepEqual(await page.evaluate(() => window.manualAccounts.at(-1).credentials), { apiKey: 'fictional-doubao-key', resourceId: 'seed-tts-2.0' });
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        fs.rmSync(temporaryDir, { recursive: true, force: true });
    }
});
