'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const reminder = require('../src/apps/web-mediacenter/modules/reminder/reminder-app-service');
const reminderSource = fs.readFileSync(
    require.resolve('../src/apps/web-mediacenter/modules/reminder/reminder-app-service'),
    'utf8'
);
const serverSource = fs.readFileSync(
    require.resolve('../src/apps/server/boot/server-app'),
    'utf8'
);

test('单条提醒测试使用注入的统一 TTS 生成器', async () => {
    const generatedTexts = [];
    const sentMessages = [];

    reminder.init({
        generateTTS: async (text) => {
            generatedTexts.push(text);
            return '/tmp/tts-reminder-test.wav';
        }
    });

    await reminder.testReminder(
        { content: '统一路由测试', methods: ['voice'], repeatCount: 1 },
        'display-1',
        (displayId, message) => sentMessages.push({ displayId, message })
    );

    assert.equal(generatedTexts.length, 1);
    assert.match(generatedTexts[0], /统一路由测试/u);
    assert.deepEqual(sentMessages, [{
        displayId: 'display-1',
        message: {
            type: 'reminder',
            action: 'voice',
            audioUrl: '/uploads/tts/tts-reminder-test.wav',
            text: generatedTexts[0],
            repeatIndex: 1,
            totalRepeat: 1
        }
    }]);
});

test('提醒模块和服务器入口使用统一 TTS 路由', () => {
    assert.doesNotMatch(reminderSource, /tts\.generateTTS\(/u);
    assert.match(reminderSource, /generateTTS\(segment\)/u);
    assert.match(serverSource, /reminder\.init\(\{[\s\S]*generateTTS:\s*generateTtsWithFallback/u);
});

test('长提醒逐段生成并按顺序进入显示端队列', async () => {
    const generated = [];
    const delivered = [];
    reminder.init({ generateTTS: async (text) => {
        generated.push(text);
        return `/tmp/segment-${generated.length}.wav`;
    } });
    const content = '甲'.repeat(150) + '。' + '乙'.repeat(150) + '。';
    await reminder.testReminder({ content, methods: ['voice', 'popup'] }, 'display-1',
        (displayId, message) => delivered.push(message));
    assert.equal(generated.length, 2);
    assert.equal(generated.join(''), `${delivered[1].text}${delivered[2].text}`);
    assert.match(generated.join(''), new RegExp(content));
    assert.deepEqual(delivered.map(message => message.action), ['popup', 'voice', 'voice']);
    assert.deepEqual(delivered.slice(1).map(message => message.audioUrl), [
        '/uploads/tts/segment-1.wav', '/uploads/tts/segment-2.wav'
    ]);
});

console.log('reminder-tts-routing.test.js: reminder TTS routing contracts passed');

test('Markdown提醒先变为可朗读正文，字幕仍保留格式且不读链接地址', async () => {
    const generated = [], delivered = [];
    reminder.init({ generateTTS: async text => { generated.push(text); return '/tmp/markdown-reminder.wav'; } });
    await reminder.testReminder({ content: '**喝水。**[帮助](https://example.com)', methods: ['voice'] }, 'display',
        (_display, message) => delivered.push(message));
    assert.ok(generated.every(text => !text.includes('https://') && !text.includes('**')));
    assert.ok(delivered.every(message => message.subtitle.markdown.includes('**喝水。**')));
    assert.equal(delivered.at(-1).text, '帮助');
});
