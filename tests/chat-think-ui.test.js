'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ChatMarkdown = require('../src/apps/web-mediacenter/ui/public/js/chat-markdown.js');
const CHAT_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat.js'),
    'utf8'
);

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/gu, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function createChatHarness(history) {
    const sentMessages = [];
    const messagesContainer = {
        innerHTML: '',
        scrollTop: 0,
        scrollHeight: 0,
        querySelector: () => null
    };
    const thinkModal = {
        classList: {
            values: new Set(),
            add(value) { this.values.add(value); },
            remove(value) { this.values.delete(value); }
        }
    };
    const thinkModalBody = { innerHTML: '' };
    const elements = new Map([
        ['chatMessages', messagesContainer],
        ['chatThinkModal', thinkModal],
        ['chatThinkModalBody', thinkModalBody]
    ]);
    const document = {
        getElementById: (id) => elements.get(id) || null,
        createElement: () => {
            let textContent = '';
            return {
                set textContent(value) { textContent = String(value); },
                get innerHTML() { return escapeHtml(textContent); }
            };
        }
    };
    const window = {
        currentDisplayId: 'display-1',
        WebSocketManager: {
            ws: {
                readyState: 1,
                send: (message) => sentMessages.push(message)
            }
        },
        DisplayList: { selectionMode: 'single' }
    };
    const context = { window, document, ChatMarkdown, WebSocket: { OPEN: 1 }, console };
    vm.runInNewContext(CHAT_SOURCE, context, { filename: 'chat.js' });

    const chat = window.Chat;
    chat.history = history;
    chat.renderHistory();

    return { chat, messagesContainer, thinkModal, thinkModalBody, sentMessages };
}

test('控制端历史气泡只内联回答，并可在 Think 弹窗查看 reasoning', () => {
    const reasoning = '检查条件后再回答 **重点** <script>alert(1)</script>';
    const { chat, messagesContainer, thinkModal, thinkModalBody } = createChatHarness([{
        role: 'assistant',
        name: '小爱',
        content: '这是最终回答。',
        reasoning,
        speech: '检查条件后再回答重点这是最终回答。',
        mode: 'group'
    }]);
    const markup = messagesContainer.innerHTML;
    const content = markup.match(/<div class="chat-message-content">([\s\S]*?)<\/div>/u)?.[1] || '';

    assert.match(content, /这是最终回答/u);
    assert.doesNotMatch(content, /检查条件后再回答/u);
    assert.match(markup, /class="chat-think-btn"/u);
    assert.match(markup, /onclick="Chat\.showThinkModal\(this\)"/u);

    chat.showThinkModal({ dataset: { reasoning } });

    assert.equal(thinkModal.classList.values.has('active'), true);
    assert.match(thinkModalBody.innerHTML, /检查条件后再回答/u);
    assert.match(thinkModalBody.innerHTML, /<strong>重点<\/strong>/u);
    assert.match(thinkModalBody.innerHTML, /&lt;script&gt;/u);
    assert.doesNotMatch(thinkModalBody.innerHTML, /<script>/u);
});

test('控制端历史消息回放使用无标签 speech，并兼容没有 speech 的旧记录', () => {
    const speech = '先检查一下。最终回答。';
    const { chat, sentMessages } = createChatHarness([{
        role: 'assistant',
        content: '最终回答。',
        reasoning: '先检查一下。',
        speech,
        mode: 'group'
    }]);

    chat.noInterruptMode = false;
    chat.playMessage(0);
    chat.history.push({ role: 'assistant', content: '旧消息。', mode: 'group' });
    chat.playMessage(1);

    assert.deepEqual(sentMessages.map((message) => JSON.parse(message).text), [speech, '旧消息。']);
});
