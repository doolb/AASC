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
const { MAX_TTS_SEGMENT_CHARS } = require('../src/core/utils/sentence-splitter');

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
    const content = '甲'.repeat(MAX_TTS_SEGMENT_CHARS * 2 + 10);
    await reminder.testReminder({ content, methods: ['voice', 'popup'] }, 'display-1',
        (displayId, message) => delivered.push(message));
    assert.equal(generated.length, 3);
    assert.ok(generated.every(text => Array.from(text).length <= MAX_TTS_SEGMENT_CHARS));
    assert.equal(generated.join(''), `${delivered[1].text}${delivered[2].text}${delivered[3].text}`);
    assert.match(generated.join(''), new RegExp(content));
    assert.deepEqual(delivered.map(message => message.action), ['popup', 'voice', 'voice', 'voice']);
    assert.deepEqual(delivered.slice(1).map(message => message.audioUrl), [
        '/uploads/tts/segment-1.wav', '/uploads/tts/segment-2.wav', '/uploads/tts/segment-3.wav'
    ]);
});

console.log('reminder-tts-routing.test.js: reminder TTS routing contracts passed');
