const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePayload } = require('../src/apps/server/modules/llm/llm-gateway-service');

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

test('Chat Completions 规范化 enable_thinking 和 image_url', () => {
    const result = normalizePayload('chat.completions', {
        model: 'qwen3.5',
        enable_thinking: false,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: '描述图片' },
                { type: 'image_url', image_url: { url: IMAGE } }
            ]
        }]
    });

    assert.equal(result.payload.enable_thinking, false);
    assert.equal(result.payload.messages[0].content[1].image_url.url, IMAGE);
});

test('Responses 规范化 input_image 并保留 output_text 历史', () => {
    const result = normalizePayload('responses', {
        model: 'qwen3.5',
        input: [{
            type: 'message',
            role: 'user',
            content: [
                { type: 'input_text', text: '这是什么' },
                { type: 'input_image', image_url: IMAGE }
            ]
        }, {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '上一轮回答' }]
        }]
    });

    assert.equal(result.payload.input[0].content[1].image_url, IMAGE);
    assert.equal(result.payload.input[1].content[0].text, '上一轮回答');
});

test('LLM 图片拒绝远程 URL、无效字段和超出数量', () => {
    assert.throws(
        () => normalizePayload('chat.completions', {
            model: 'qwen3.5',
            messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }]
        }),
        (error) => error.code === 'LLM_IMAGE_UNSUPPORTED'
    );

    assert.throws(
        () => normalizePayload('chat.completions', {
            model: 'qwen3.5',
            enable_thinking: 'false',
            messages: [{ role: 'user', content: 'test' }]
        }),
        (error) => error.code === 'LLM_THINKING_INVALID'
    );

    assert.throws(
        () => normalizePayload('chat.completions', {
            model: 'qwen3.5',
            messages: [{
                role: 'user',
                content: Array.from({ length: 5 }, () => ({ type: 'image_url', image_url: { url: IMAGE } }))
            }]
        }),
        (error) => error.code === 'LLM_IMAGE_INVALID'
    );
});
