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
    assert.match(reminderSource, /generateTTS\(fullContent\)/u);
    assert.match(serverSource, /reminder\.init\(\{[\s\S]*generateTTS:\s*generateTtsWithFallback/u);
});

console.log('reminder-tts-routing.test.js: reminder TTS routing contracts passed');
