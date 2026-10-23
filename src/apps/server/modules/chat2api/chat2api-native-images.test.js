'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createChat2ApiProviderAdapters, parseSseStream } = require('./chat2api-provider-adapters');
const { extractOutputImages } = require('../../../../core/utils/chat-output-images');
const sse = events => Readable.from(events.map(data => `data: ${JSON.stringify(data)}\n\n`));
const glmPart = { content: [{ type: 'image', image: [{ image_url: 'https://images.test/a.png' }, { image_url: 'https://images.test/b.png' }] }] };
const qwenCard = (status, display = []) => ({ data: { messages: [{ meta_data: { multi_load: [{
    type: 'ai_generate_image_list', content: { status, display_list: display }
}] } }] } });
const works = [{ image: [{ url: 'https://images.test/a.png' }], resource_infos: [{ url: 'https://images.test/thumb.png' }] },
    { watermark_image: [{ url: 'https://images.test/b.png' }] }];

for (const providerId of ['glm', 'qwen']) for (const stream of [false, true]) {
    test(`${providerId}原生仅图${stream ? '流式' : '非流式'}保留全部作品并去重`, async () => {
        let generations = 0;
        const events = providerId === 'glm' ? [{ parts: [glmPart] }, { status: 'finish', parts: [glmPart] }]
            : [qwenCard('complete', works), qwenCard('complete', works)];
        const adapters = createChat2ApiProviderAdapters({ httpClient: { async request(config) {
            if (config.url.includes('/user/refresh')) return { status: 200, data: { result: { access_token: 'synthetic' } } };
            generations += 1;
            return { status: 200, headers: { 'content-type': 'text/event-stream' }, data: sse(events) };
        } } });
        const result = await adapters[providerId]({ request: { model: providerId, messages: [{ role: 'user', content: '画猫' }], stream },
            actualModel: providerId, account: { credentials: { token: 'synthetic', ticket: 'synthetic' } },
            provider: { id: providerId, apiEndpoint: 'https://example.test', headers: {} }, responseSession: { nativeState: {} } });
        let images;
        if (stream) {
            const chunks = []; for await (const chunk of result.stream) chunks.push(chunk);
            assert.equal(chunks[0].choices[0].delta.image_generation.status, 'pending');
            images = extractOutputImages(chunks.at(-1).choices[0].delta);
        } else images = extractOutputImages(result.body.choices[0].message);
        assert.deepEqual(images.map(image => image.url), ['https://images.test/a.png', 'https://images.test/b.png']);
        assert.equal(generations, 1);
    });
}

test('GLM图片未结束时只发pending，不提交图片或把中断当成功', async () => {
    const chunks = [];
    await assert.rejects(async () => {
        for await (const chunk of parseSseStream(sse([{ parts: [glmPart] }]), 'glm', 'glm', {}, { nativeState: {} })) chunks.push(chunk);
    }, error => error.code === 'image_stream_interrupted');
    assert.equal(chunks.length, 1); assert.deepEqual(extractOutputImages(chunks[0].choices[0].delta), []);
});

test('Qwen仅沿原生成请求snap，保留请求ID和会话，不再次发起生图', async () => {
    let prepared; const snaps = [];
    const adapters = createChat2ApiProviderAdapters({ httpClient: {
        async request(config) { assert.equal(prepared, undefined); prepared = config;
            return { status: 200, headers: {}, data: sse([qwenCard('processing')]) }; },
        async post(url, data, options) { snaps.push({ url, data, options });
            return { data: `data: ${JSON.stringify(qwenCard('complete', works))}\n\n` }; }
    } });
    const result = await adapters.qwen({ request: { model: 'Qwen', messages: [{ role: 'user', content: '画猫' }], stream: true },
        actualModel: 'Qwen', account: { credentials: { ticket: 'synthetic' } },
        provider: { id: 'qwen', apiEndpoint: 'https://example.test', headers: {} } });
    const chunks = []; for await (const chunk of result.stream) chunks.push(chunk);
    assert.equal(snaps.length, 1); assert.equal(new URL(snaps[0].url).pathname, '/api/v1/chat/snap');
    assert.equal(snaps[0].data.req_id, prepared.data.req_id);
    assert.equal(snaps[0].data.session_id, prepared.data.session_id);
    assert.deepEqual(snaps[0].data.messages, prepared.data.messages);
    assert.equal(extractOutputImages(chunks.at(-1).choices[0].delta).length, 2);
});

test('取消Qwen生成后不进入snap或产生新请求', async () => {
    const controller = new AbortController(); let snapped = 0;
    const iterator = parseSseStream(sse([qwenCard('processing'), { data: { messages: [] } }]), 'qwen', 'qwen', {}, null,
        { signal: controller.signal, http: { post() { snapped += 1; } } });
    assert.equal((await iterator.next()).value.choices[0].delta.image_generation.status, 'pending');
    controller.abort(); await assert.rejects(iterator.next(), error => error.name === 'AbortError');
    assert.equal(snapped, 0);
});

test('Qwen同帧多个作品卡片必须全部完成，较早pending不遮掉最终完整快照', () => {
    const { extractQwenImages } = require('./chat2api-qwen-images');
    const pending = qwenCard('processing');
    const complete = qwenCard('complete', works);
    const mixed = { data: { messages: [...pending.data.messages, ...complete.data.messages] } };
    assert.equal(extractQwenImages([mixed]).pending, true);
    assert.equal(extractQwenImages([mixed, complete]).pending, false);
    assert.equal(extractQwenImages([mixed, complete]).images.length, 2);
});

test('普通文本和图片混合时文字逐片输出，图片在finish后一次交付', async () => {
    const events = [{ meta_data: { if_increase_push: true }, parts: [{ content: [{ type: 'text', text: '画好了' }] }] },
        { parts: [glmPart] }, { status: 'finish', parts: [glmPart] }];
    const chunks = []; for await (const chunk of parseSseStream(sse(events), 'glm', 'glm', {}, null)) chunks.push(chunk);
    assert.equal(chunks[0].choices[0].delta.content, '画好了');
    assert.equal(extractOutputImages(chunks.at(-1).choices[0].delta).length, 2);
});
