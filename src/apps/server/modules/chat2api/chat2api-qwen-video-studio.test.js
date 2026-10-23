'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createQwenVideoStudio, studioAuth, studioCookie, studioVideos } = require('./chat2api-qwen-video-studio');
const { createChat2ApiVideoService } = require('./chat2api-video-service');
const account = { accountId: 'qwen-one', providerId: 'qwen', credentials: { ticket: 'private-ticket' } };
const bootstrap = '<script>window.__sm_req_token__ = {"nonceId":"page-nonce","signKey":"page-key"}</script>';
const data = value => ({ status: 200, data: { code: 0, data: value } });
const video = suffix => ({ downloadUrl: `https://media.test/${suffix}.mp4`, coverCdnUrl: `https://media.test/${suffix}.png` });
const createService = (http, extra = {}) => createChat2ApiVideoService({
    dataStore: { listAccounts: async () => [account], getAccount: async id => id === account.accountId ? account : null },
    providerRegistry: { getProvider: async () => ({ id: 'qwen', enabled: true, apiEndpoint: 'https://chat2.qianwen.com' }) },
    intervalMs: 1, http, ...extra
});

test('官网认证保留票据Cookie，以页面nonce/key和当次标识签名，拒绝无效资料', () => {
    assert.equal(studioCookie(account), 'tongyi_sso_ticket=private-ticket');
    assert.equal(studioCookie({ credentials: { cookie: 'tongyi_sso_ticket=existing; extra=1', ticket: 'other' } }), 'tongyi_sso_ticket=existing; extra=1');
    const auth = studioAuth({ nonceId: 'page-nonce', signKey: 'page-key' }, { browserId: 'browser', chid: 'request', timestamp: 1700000000000 });
    assert.equal(auth.token, createHash('md5').update('browser_page-nonce_page-key_1700000000000_request').digest('hex'));
    assert.equal(auth.product, 'ai_studio'); assert.equal(auth.platform, 'pc');
    assert.throws(() => studioAuth({ nonceId: '', signKey: 'private' }), /有效认证/);
    assert.throws(() => studioCookie({ credentials: { ticket: 'ticket\r\nCookie: bad' } }), /有效登录/);
});

test('新创作查询按finish提取完整多视频，预览和失败不算完成，任务不匹配拒绝', async () => {
    assert.deepEqual(studioVideos({ status: 'processing', resultVideos: [video('preview')] }), { videos: [], done: false });
    assert.ok(studioVideos({ status: 'fail', resultVideos: [video('preview')] }).error);
    assert.ok(studioVideos({ status: 'finish', resultVideos: [] }).error);
    assert.ok(studioVideos({ status: 'finish', resultVideos: { url: 'https://media.test/invalid.mp4' } }).error);
    const result = studioVideos({ status: 'finish', resultVideos: [video('a'), video('b')] });
    assert.equal(result.videos.length, 2); assert.equal(result.videos[0].posterUrl, 'https://media.test/a.png');
    const client = createQwenVideoStudio({ http: { request: async config => config.method === 'GET'
        ? { status: 200, data: bootstrap } : data({ status: 'finish', recordId: 'different', resultVideos: [video('wrong')] }) } });
    await assert.rejects(client.query({ recordId: 'original' }, { account }), /不匹配/);
});

test('稳定HappyHorse模型ID走新创建接口，字段对齐截留官网样本，持久化只留record定位', async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-qwen-video-test-'));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const requests = []; let polls = 0;
    const http = { request: async config => {
        requests.push(config);
        assert.equal(config.headers.Cookie, 'tongyi_sso_ticket=private-ticket');
        if (config.method === 'GET') return { status: 200, data: bootstrap };
        assert.equal(config.maxRedirects, 0);
        assert.equal(new URL(config.url).origin, 'https://ai-studio-create.qianwen.com');
        assert.equal(config.data.token, createHash('md5').update(`${config.data.browserId}_page-nonce_page-key_${config.data.timestamp}_${config.data.chid}`).digest('hex'));
        if (config.url.endsWith('/function')) {
            assert.equal(config.data.model, 'happyhorse11'); assert.equal(config.data.rootModel, 'happyhorse11');
            assert.equal(config.data.genMode, 'multi_ref'); assert.equal(config.data.prompt, '海边的白色帆布随风摆动');
            assert.equal(config.data.originPrompt, config.data.prompt);
            assert.deepEqual(config.data.params, { size: '16:9', resolution: '720P', duration: 5, attachmentType: 1, attachments: [] });
            return data({ recordId: 'own-video' });
        }
        assert.equal(config.data.recordId, 'own-video');
        return data({ recordId: 'own-video', status: ++polls === 1 ? 'processing' : 'finish', resultVideos: [video('a'), video('b')] });
    } };
    const service = createService(http, { dataStore: { rootDir, listAccounts: async () => [account], getAccount: async () => account } });
    t.after(() => service.stop());
    const job = await service.create({ model: 'qwen-happyhorse', prompt: '海边的白色帆布随风摆动' });
    const result = await service.wait(job.id);
    assert.equal(result.status, 'completed'); assert.equal(result.data.length, 2); assert.equal(polls, 2);
    assert.equal(requests.filter(r => r.url.endsWith('/function')).length, 1);
    const stored = await fs.readFile(path.join(rootDir, 'video-jobs.json'), 'utf8');
    assert.deepEqual(JSON.parse(stored)[0].upstream, { recordId: 'own-video' });
    for (const secret of ['private-ticket', 'page-nonce', 'page-key', '海边的白色帆布']) assert.equal(stored.includes(secret), false);
    assert.equal(service.listModels().find(m => m.id === 'qwen-happyhorse').name, 'HappyHorse 1.1');
});

test('创建断连不重发，未取得recordId就中断；页面不含认证时不提交', async t => {
    let submits = 0;
    const service = createService({ request: async config => {
        if (config.method === 'GET') return { status: 200, data: bootstrap };
        submits++; throw Object.assign(new Error('private-token and cookie'), { code: 'ECONNRESET' });
    } });
    t.after(() => service.stop());
    const job = await service.create({ model: 'qwen-happyhorse', prompt: '海浪拍打沙滩' });
    await assert.rejects(service.wait(job.id), error => !error.message.includes('private-token'));
    assert.equal((await service.get(job.id)).status, 'interrupted'); assert.equal(submits, 1);
    const client = createQwenVideoStudio({ http: { request: async config => { assert.equal(config.method, 'GET'); return { status: 200, data: '<script>missing</script>' }; } } });
    await assert.rejects(client.request('/api/web/ai/video/function', {}, { account }), error => error.code === 'qwen_video_auth');
});

test('账号认证和会员/额度/频率错误安全返回，不泄露原始认证响应', async () => {
    for (const [code, expected] of [[-2, 'qwen_video_auth'], [1014, 'qwen_video_auth'], [15003, 'qwen_video_membership'], [15004, 'video_quota_insufficient'], [1003, 'qwen_video_rate_limit'], [1018, 'qwen_video_rejected'], [99999, 'qwen_video_protocol']]) {
        let submitted = 0;
        const client = createQwenVideoStudio({ http: { request: async config => config.method === 'GET'
            ? { status: 200, data: bootstrap } : (++submitted, { status: 200, data: { code, msg: 'private-token' } }) } });
        await assert.rejects(client.request('/api/web/ai/video/function', {}, { account }), error => error.code === expected && !error.message.includes('private-token'));
        assert.equal(submitted, 1);
    }
    const controller = new AbortController(); controller.abort();
    for (const [status, expected] of [[401, 'qwen_video_auth'], [403, 'qwen_video_auth'], [429, 'qwen_video_rate_limit'], [500, 'qwen_video_http']]) {
        const httpClient = createQwenVideoStudio({ http: { request: async config => config.method === 'GET'
            ? { status: 200, data: bootstrap } : { status, data: 'private-token' } } });
        await assert.rejects(httpClient.query({ recordId: 'known' }, { account }), error => error.code === expected && !error.message.includes('private-token'));
    }
    const client = createQwenVideoStudio({ http: { request: () => { throw Error('cancelled request must not execute'); } } });
    await assert.rejects(client.query({ recordId: 'own' }, { account, signal: controller.signal }), error => error.name === 'AbortError');
});

test('重启恢复新record任务只查询，不创建；原生旧snap任务仍沿原session查询', async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-qwen-resume-test-'));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const id = 'video_12345678-1234-1234-1234-123456789abc';
    await fs.writeFile(path.join(rootDir, 'video-jobs.json'), JSON.stringify([{ id, providerId: 'qwen', accountId: account.accountId, model: 'qwen-happyhorse', status: 'running', created: Math.floor(Date.now() / 1000), upstream: { recordId: 'known', scene: 'hh11_t2v' }, videos: [] }]));
    const service = createService({ request: async config => {
        if (config.method === 'GET') return { status: 200, data: bootstrap };
        assert.equal(new URL(config.url).pathname, '/api/web/ai/video/record/query');
        assert.equal(config.data.recordId, 'known'); assert.equal(config.data.scene, 'hh11_t2v');
        return data({ recordId: 'known', status: 'finish', resultVideos: [video('old')] });
    } }, { dataStore: { rootDir, getAccount: async () => account } });
    t.after(() => service.stop()); await service.resume();
    assert.equal((await service.wait(id)).data.length, 1);
    const native = createService({ post: async (url, body) => {
        assert.equal(new URL(url).pathname, '/api/v1/chat/snap'); assert.equal(body.session_id, 'session'); assert.equal(body.req_id, 'request');
        return { status: 200, data: 'data: ' + JSON.stringify({ data: { messages: [{ meta_data: { multi_load: [{ type: 'ai_generate_video', content: { status: 'complete', display_list: [{ video_url: 'https://media.test/native.mp4' }] } }] } }] } }) + '\n\n' };
    } });
    t.after(() => native.stop());
    const adopted = await native.adopt({ providerId: 'qwen', account, upstream: { sessionId: 'session', reqId: 'request', parentReqId: '' } });
    assert.equal((await native.wait(adopted.id)).data.length, 1);
});
