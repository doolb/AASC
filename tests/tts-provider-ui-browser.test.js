'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { listQwenAudio31Voices } = require('../src/apps/server/modules/chat2api/chat2api-qwen-audio-voices');
const { normalizeSettings, redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const read = file => fs.readFileSync(path.join(publicDir, file), 'utf8');

test('真实控制端保存等待/失败/断线/重连、音色保留、模板继承及自测模块', { timeout: 45000 }, async () => {
    const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), '/usr/bin/chromium'].find(file => file && fs.existsSync(file));
    assert.ok(executablePath, '浏览器验证需要可用Chromium');
    // 与手动播放回归一致，隔离浏览器临时存储以避开/tmp用户配额。
    const temporaryDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '..'), '.tmp-tts-browser-'));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true, timeout: 15000,
            userDataDir: path.join(temporaryDir, 'profile'), args: ['--no-sandbox', '--disable-dev-shm-usage'],
            env: { ...process.env, TMPDIR: temporaryDir } });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const upload = read('upload.html');
        const start = upload.indexOf('<section class="panel" id="panel-voiceprint"');
        const end = upload.indexOf('</section>', start);
        const markup = upload.slice(start, end + 10);
        assert.ok(markup.includes('ttsProviderFields'));
        await page.setViewport({ width: 360, height: 800 });
        await page.setContent(`<html><head><style>${read('css/theme.css')} ${read('css/upload.css')}</style></head><body>
            <main class="content">${markup}<div hidden><input id="newTemplateName"><textarea id="newTemplateContent"></textarea>
            <select id="templatePermissionProfile"><option value="readonly">readonly</option></select>
            ${upload.slice(upload.indexOf('<select id="templateTtsProvider"'), upload.indexOf('<button class="chat-add-btn"'))}
            </div></main></body></html>`);
        await page.evaluate(() => {
            document.getElementById('panel-voiceprint').style.display = 'block';
            window.sent = [];
            window.WebSocketManager = { ws: { readyState: 1, send: raw => window.sent.push(JSON.parse(raw)) } };
            window.showToast = () => {};
        });
        await page.addScriptTag({ content: read('js/tts-provider-settings.js') });
        const config = redactSettings(normalizeSettings({ providers: { 'qwen-api': { credential: 'server-secret', defaultVoice: 'custom-saved' },
            'qwen-chat': { chat2apiAccountId: 'saved-missing' } } }));
        // 模拟旧服务回填过时私有字段；页面不得渲染或再次发送这些值。
        Object.assign(config.providers['qwen-api'], { credential: 'legacy-hidden-secret', endpoint: 'https://legacy.invalid/private-endpoint', resourceId: 'legacy-private-resource' });
        await page.evaluate(value => window.TtsProviderSettings.handleConfig({ type: 'ttsProviderConfig', config: value }), config);
        const visibleValues = await page.$eval('#ttsProviderFields', node => [...node.querySelectorAll('input')].map(input => input.value).join(' '));
        assert.doesNotMatch(visibleValues, /legacy-hidden-secret|legacy\.invalid|legacy-private-resource/u);
        assert.equal((await page.$$('#ttsProviderFields input[data-tts-shared-field="defaultSpeed"]')).length, 0);
        assert.equal((await page.$$('#ttsProviderFields input[data-tts-shared-field="defaultVolume"]')).length, 1);
        assert.equal((await page.$$('#ttsProviderFields details input[data-tts-field="defaultSpeed"]')).length, 4);
        assert.equal((await page.$$('#ttsProviderFields details:last-of-type input[data-tts-field="defaultSpeed"]')).length, 0);
        assert.equal((await page.$$('#ttsProviderFields input[type="password"]')).length, 0);
        for (const number of [2, 3, 4, 5]) {
            assert.match(await page.$eval(`#ttsProviderFields details:nth-of-type(${number})`, node => node.textContent), /Chat2API/u);
        }
        assert.equal(await page.evaluate(() => window.sent.length), 0);
        await page.evaluate(() => {
            const selection=document.querySelector('#ttsProviderFields > div select');selection.value='doubao-chat';
            selection.dispatchEvent(new Event('change',{bubbles:true}));
            document.getElementById('templateTtsProvider').value='doubao-chat';
            document.getElementById('templateTtsProvider').dispatchEvent(new Event('change',{bubbles:true}));
        });
        assert.equal(await page.$eval('#ttsProviderFields > div input',input=>input.readOnly),false);
        assert.equal(await page.$eval('#templateTtsVoice',input=>input.readOnly),false);
        assert.ok(await page.$eval('#ttsProviderFields details:last-of-type',node=>node.textContent.includes('实验性')));
        assert.equal(await page.$$eval('#ttsProviderFields input[type="checkbox"]', nodes => nodes.length), 0);
        assert.equal(await page.$eval('#ttsProviderFields details:last-of-type',node=>node.querySelectorAll('input[type="password"]').length),0);
        assert.equal(await page.$eval('input[data-tts-upstream-concurrency="doubao-chat"]',node=>node.value),'3');
        assert.equal(await page.$eval('input[data-tts-upstream-concurrency="doubao-chat"]',node=>node.min+':'+node.max+':'+node.step),'1:8:1');
        assert.equal(await page.$eval('#ttsProviderFields > div:nth-of-type(2) select',node=>[...node.options].some(o=>o.value==='doubao-chat')),false);
        assert.equal(await page.evaluate(()=>window.sent.length),0);
        // 权威广播从豆包切回其它来源时，保留服务端音色并原样保存。
        const switchedConfig=structuredClone(config);
        switchedConfig.aiReplyDefault={provider:'qwen-api',voice:'Cherry'};
        await page.evaluate(value=>window.TtsProviderSettings.handleConfig({type:'ttsProviderConfig',config:value}),switchedConfig);
        assert.equal(await page.$eval('#ttsProviderFields > div input',input=>input.value),'Cherry');
        assert.equal(await page.$eval('#ttsProviderFields > div input',input=>input.readOnly),false);
        await page.click('#ttsProviderSaveBtn');
        const switchedRequest=await page.evaluate(()=>window.sent.at(-1));
        assert.equal(switchedRequest.config.aiReplyDefault.voice,'Cherry');
        await page.evaluate(value=>window.TtsProviderSettings.handleConfig({type:'ttsProviderConfig',requestId:value.requestId,success:true,config:value.config}),switchedRequest);
        await page.evaluate(value=>window.TtsProviderSettings.handleConfig({type:'ttsProviderConfig',config:value}),config);
        await page.evaluate(()=>{
            document.getElementById('templateTtsProvider').value='';
            document.getElementById('templateTtsProvider').dispatchEvent(new Event('change',{bubbles:true}));
        });
        assert.equal(await page.$eval('#ttsProviderFields details:nth-of-type(1)', node => node.querySelectorAll('input[type="checkbox"], input[list], button').length), 0);
        assert.equal(await page.$eval('#ttsProviderFields > div input', input => input.disabled), true);
        assert.equal(await page.$eval('#templateTtsVoice', input => input.hidden), true);
        assert.equal(await page.$eval('#templateTtsVoice', input => getComputedStyle(input).display), 'none');
        assert.equal(await page.$eval('#ttsProviderFields > div input', input => getComputedStyle(input.parentElement).display), 'none');
        assert.equal(await page.$eval('#ttsProviderFields details:nth-of-type(2)', node => node.querySelectorAll('input[type="password"]').length), 0);
        assert.deepEqual(await page.$eval('#ttsProviderModels-qwen-chat', node => [...node.options].map(option => option.value)), ['QUARK_VOICE', 'MINI_MAX']);
        assert.equal(await page.$eval('#ttsProviderFields details:nth-of-type(2) input[data-tts-field="model"]', node => node.value), 'QUARK_VOICE');
        assert.match(await page.$eval('#ttsProviderFields details:nth-of-type(2)', node => node.textContent), /qwen3-tts-flash 请使用 Qwen API/u);
        assert.ok(!(await page.$eval('#ttsProviderFields', node => node.textContent)).includes('Chrome'));
        assert.equal(await page.evaluate(() => document.getElementById('ttsProviderChat2ApiAccount')), null);
        const state = () => page.evaluate(() => ({ disabled: document.getElementById('ttsProviderSaveBtn').disabled,
            status: document.getElementById('ttsProviderStatus').textContent }));
        assert.equal((await state()).disabled, false);
        // 实际输入控件和按钮走正式模块；不重写保存/查询动作。
        await page.evaluate(() => {
            document.querySelector('input[data-tts-upstream-concurrency="doubao-chat"]').value='5';
            const groups = document.querySelectorAll('#ttsProviderFields > div');
            groups[0].querySelector('select').value = 'qwen-api';
            const qwen = [...document.querySelectorAll('#ttsProviderFields details')].find(node => node.querySelector('summary').textContent.startsWith('Qwen API'));
            qwen.open = true;
            const model = qwen.querySelector('input[data-tts-field="model"]');
            model.value = 'qwen3-tts-flash';
            model.dispatchEvent(new Event('input', { bubbles: true }));
            const speed = qwen.querySelector('input[data-tts-field="defaultSpeed"]');
            window.unsupportedSpeedHidden = speed.disabled && speed.parentElement.hidden;
            model.value = 'qwen-audio-3.1-tts-flash';
            model.dispatchEvent(new Event('input', { bubbles: true }));
            qwen.querySelector('input[data-tts-field="defaultSpeed"]').value = '4';
        });
        assert.equal(await page.evaluate(() => window.unsupportedSpeedHidden), true);
        assert.equal(await page.$eval('#ttsProviderFields details:nth-of-type(3) input[data-tts-field="defaultSpeed"]', node => node.disabled), false);
        await page.click('#ttsProviderSaveBtn');
        assert.equal((await state()).disabled, true);
        const request = await page.evaluate(() => window.sent.at(-1));
        assert.equal(request.config.upstreamConcurrency['doubao-chat'], '5');
        assert.equal(request.type, 'setTtsProviderConfig');
        assert.equal(request.config.providers['qwen-api'].model, 'qwen-audio-3.1-tts-flash');
        assert.ok(!Object.hasOwn(request.config, 'defaultSpeed'));
        assert.equal(request.config.defaultVolume, '100');
        assert.equal(request.config.providers['qwen-api'].defaultSpeed, '4');
        assert.ok(!Object.hasOwn(request.config.providers['qwen-api'], 'defaultVolume'));
        assert.ok(!Object.hasOwn(request.config.providers['doubao-chat'], 'defaultSpeed'));
        for (const id of ['qwen-chat', 'qwen-api', 'doubao-api', 'doubao-chat']) {
            for (const name of ['enabled', 'credential', 'clearCredential', 'endpoint', 'resourceId', 'chat2apiAccountId']) {
                assert.ok(!Object.hasOwn(request.config.providers[id], name), `${id} 不发送账号管理字段 ${name}`);
            }
        }
        assert.ok(!Object.hasOwn(request.config.providers['qwen-chat'], 'chat2apiAccountId'));
        assert.ok(!Object.hasOwn(request.config.providers.system, 'enabled'));
        assert.ok(!Object.hasOwn(request.config.providers.system, 'defaultVoice'));
        assert.ok(!Object.hasOwn(request.config.providers['qwen-chat'], 'credential'));
        assert.ok(!Object.hasOwn(request.config.providers['qwen-chat'], 'clearCredential'));
        assert.equal(request.config.providers['qwen-chat'].model, 'QUARK_VOICE');
        const saved = redactSettings(normalizeSettings(request.config, normalizeSettings({ providers: { 'qwen-api': { credential: 'server-secret' } } })));
        await page.evaluate(value => window.TtsProviderSettings.handleConfig(value), { type: 'ttsProviderConfig', requestId: request.requestId, success: true, config: saved });
        assert.equal((await state()).disabled, false);
        assert.match((await state()).status, /已保存/u);
        assert.equal((await page.$$('#ttsProviderFields input[type="password"]')).length, 0);
        await page.evaluate(() => window.TtsProviderSettings.loadVoices('qwen-api'));
        const query = await page.evaluate(() => window.sent.at(-1));
        await page.evaluate(value => window.TtsProviderSettings.handleVoices(value), { ...query, type: 'ttsProviderVoices', success: false, message: '权限不足' });
        assert.equal(await page.$eval('#ttsProviderFields details:nth-of-type(3) input[list]', input => input.value), 'custom-saved');
        await page.evaluate(() => window.TtsProviderSettings.loadVoices('qwen-api'));
        const query2 = await page.evaluate(() => window.sent.at(-1));
        await page.evaluate(value => window.TtsProviderSettings.handleVoices(value), { ...query2, type: 'ttsProviderVoices', success: true, voices: [{ id: 'Cherry', name: '<script>unsafe</script>' }] });
        assert.equal(await page.$eval('#ttsProviderFields details:nth-of-type(3) input[list]', input => input.value), 'custom-saved');
        assert.equal(await page.$eval('#ttsProviderVoices-qwen-api option', option => option.textContent), '<script>unsafe</script>');
        await page.evaluate(() => window.TtsProviderSettings.loadVoices('qwen-api'));
        const realQuery = await page.evaluate(() => window.sent.at(-1));
        await page.evaluate(value => window.TtsProviderSettings.handleVoices(value), { ...realQuery, type: 'ttsProviderVoices', success: true, voices: listQwenAudio31Voices() });
        assert.equal(await page.$$eval('#ttsProviderVoices-qwen-api option', nodes => nodes.length), 68);
        assert.equal(await page.$eval('#ttsProviderVoices-qwen-api option[value="Emily_v3.1"]', node => node.textContent), 'Emily');
        await page.click('#ttsProviderSaveBtn');
        const failedRequest = await page.evaluate(() => window.sent.at(-1));
        await page.evaluate(value => window.TtsProviderSettings.handleConfig(value), { type: 'ttsProviderConfig', requestId: failedRequest.requestId, success: false, config, message: '磁盘保存失败' });
        assert.equal((await state()).disabled, false);
        assert.match((await state()).status, /保存失败/u);
        await page.evaluate(() => {
            const realSend = window.WebSocketManager.ws.send;
            window.WebSocketManager.ws.send = () => { throw new Error('发送失败'); };
            window.TtsProviderSettings.save();
            window.WebSocketManager.ws.send = realSend;
        });
        assert.equal((await state()).disabled, false);
        assert.match((await state()).status, /发送失败/u);
        await page.evaluate(() => {
            const realTimeout = window.setTimeout;
            let expire;
            window.setTimeout = callback => { expire = callback; return 777; };
            window.TtsProviderSettings.save();
            window.setTimeout = realTimeout;
            expire();
        });
        assert.equal((await state()).disabled, false);
        assert.match((await state()).status, /未收到保存确认/u);
        await page.click('#ttsProviderSaveBtn');
        assert.equal((await state()).disabled, true);
        await page.evaluate(() => { window.WebSocketManager.ws.readyState = 3; window.TtsProviderSettings.handleDisconnected(); });
        assert.equal((await state()).disabled, true);
        await page.evaluate(value => { window.WebSocketManager.ws.readyState = 1; window.TtsProviderSettings.handleConfig({ config: value }); }, saved);
        assert.equal((await state()).disabled, false);
        assert.equal(await page.evaluate(() => window.sent.filter(message => message.type === 'getTtsProviderAccounts').length), 0);
        await page.addScriptTag({ content: read('js/chat.js') });
        const templateResults = await page.evaluate(async () => {
            const bodies = [];
            window.fetch = async (url, options) => { bodies.push(JSON.parse(options.body)); return { json: async () => ({ status: 'success', templates: [] }) }; };
            Chat.render = () => {};
            Chat.renderTemplateList = () => {};
            document.getElementById('newTemplateName').value = '测试助手';
            document.getElementById('newTemplateContent').value = '请回答';
            document.getElementById('templateTtsProvider').value = '';
            Chat.addTemplate();
            await new Promise(resolve => setTimeout(resolve, 0));
            document.getElementById('newTemplateName').value = '明确原生';
            document.getElementById('newTemplateContent').value = '请回答';
            document.getElementById('templateTtsProvider').value = 'system';
            document.getElementById('templateTtsVoice').value = 'unsupported-native-id';
            document.getElementById('templateTtsProvider').dispatchEvent(new Event('change'));
            Chat.addTemplate();
            await new Promise(resolve => setTimeout(resolve, 0));
            return bodies;
        });
        assert.deepEqual(templateResults.map(body => body.tts), [{ voice: null }, { provider: 'system', voice: null }]);
        await page.addScriptTag({ content: read('js/self-test.js') });
        // 非AI业务可保存国内千问，权威回填和重连后自测仍合法且不请求上游。
        for (const group of [2, 3]) {
            const values = await page.$eval(`#ttsProviderFields > div:nth-of-type(${group}) select`, node => [...node.options].map(option => option.value));
            assert.ok(values.includes('qwen-chat'));
            assert.ok(!values.includes('doubao-chat'));
        }
        await page.evaluate(() => {
            for (const group of [2, 3]) {
                const select = document.querySelector(`#ttsProviderFields > div:nth-of-type(${group}) select`);
                select.value = 'qwen-chat';
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await page.click('#ttsProviderSaveBtn');
        const qwenRequest = await page.evaluate(() => window.sent.at(-1));
        assert.equal(qwenRequest.config.textMedia.provider, 'qwen-chat');
        assert.equal(qwenRequest.config.systemBroadcast.provider, 'qwen-chat');
        const qwenSaved = redactSettings(normalizeSettings(qwenRequest.config));
        await page.evaluate(value => window.TtsProviderSettings.handleConfig({ type: 'ttsProviderConfig', success: true, config: value }), qwenSaved);
        await page.evaluate(() => window.TtsProviderSettings.handleDisconnected());
        await page.evaluate(value => window.TtsProviderSettings.handleConfig({ type: 'ttsProviderConfig', config: value }), qwenSaved);
        const sentBeforeSelfTest = await page.evaluate(() => window.sent.length);
        const selfTest = await page.evaluate(() => SelfTest.tests.find(test => test.id === 'tts_provider_config').run());
        assert.equal(selfTest.success, true);
        assert.equal(await page.evaluate(() => window.sent.length), sentBeforeSelfTest);
        await page.$eval('#ttsProviderFields', element => {
            for (const node of element.querySelectorAll('details')) node.open = /^(系统原生|国内千问)/u.test(node.querySelector('summary').textContent);
        });
        await page.$eval('#ttsProviderFields', element => element.closest('.voiceprint-card').scrollIntoView());
        const card = await page.$('#ttsProviderFields');
        await card.screenshot({ path: path.join(temporaryDir, 'aasc-tts-provider-settings.png') });
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        fs.rmSync(temporaryDir, { recursive: true, force: true });
    }
});
