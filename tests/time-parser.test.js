'use strict';

const assert = require('assert');
const timeParser = require('../src/core/utils/time-parser');
const voiceCommand = require('../src/apps/web-mediacenter/modules/voice/voice-command-app-service');

function dateOnly(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function tomorrowOnly() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.getTime();
}

function testChinesePeriodAndHour() {
    const result = timeParser.parseTimeForReminder('下午三点');
    const target = new Date(result.timestamp);

    assert.strictEqual(target.getHours(), 15);
    assert.strictEqual(target.getMinutes(), 0);
    assert.strictEqual(result.description, '下午3点');
}

function testRelativeDayAndChinesePeriod() {
    const result = timeParser.parseTimeForReminder('明天早上八点');
    const target = new Date(result.timestamp);

    assert.strictEqual(dateOnly(target), tomorrowOnly());
    assert.strictEqual(target.getHours(), 8);
    assert.strictEqual(target.getMinutes(), 0);
    assert.strictEqual(result.description, '明天早上8点');
}

function testReminderUsesSharedTimeParserAndRemovesTimeText() {
    const parsed = voiceCommand.parseTimeExpression('提醒我下午三点开会');
    const content = voiceCommand.extractReminderContent('提醒我下午三点开会');
    const target = new Date(parsed.targetTime);

    assert.strictEqual(target.getHours(), 15);
    assert.strictEqual(target.getMinutes(), 0);
    assert.strictEqual(parsed.timeDescription, '下午3点');
    assert.strictEqual(content, '开会');
}

function testChineseRelativeTimeIsRemovedFromReminderContent() {
    const parsed = voiceCommand.parseTimeExpression('提醒我三十分钟后喝水');
    const content = voiceCommand.extractReminderContent('提醒我三十分钟后喝水');
    const differenceMinutes = Math.round((parsed.targetTime.getTime() - Date.now()) / 60000);

    assert.ok(differenceMinutes >= 29 && differenceMinutes <= 30);
    assert.strictEqual(parsed.timeDescription, '30分钟后');
    assert.strictEqual(content, '喝水');
}

function testReminderContentRemovesRelativeDate() {
    const content = voiceCommand.extractReminderContent('提醒我明天早上八点开会');
    assert.strictEqual(content, '开会');
}

testChinesePeriodAndHour();
testRelativeDayAndChinesePeriod();
testReminderUsesSharedTimeParserAndRemovesTimeText();
testChineseRelativeTimeIsRemovedFromReminderContent();
testReminderContentRemovesRelativeDate();
console.log('time-parser.test.js: 5/5 passed');
