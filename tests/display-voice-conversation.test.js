const assert = require('assert');
const {
    createConversationState,
    parseConversationCommand,
    reduceConversationInput,
    isConversationExpired
} = require('../src/apps/server/modules/voice/display-voice-conversation');

const assistants = ['小爱', '妲己'];

function testInitialState() {
    const state = createConversationState(true);
    assert.strictEqual(state.state, 'waitingWake');
    assert.strictEqual(state.target, null);
}

function testWakeAndPrivateSwitch() {
    assert.deepStrictEqual(parseConversationCommand('你好小爱', assistants), {
        type: 'wake',
        mode: 'group',
        target: null
    });
    assert.deepStrictEqual(parseConversationCommand('小爱开始对话', assistants), {
        type: 'wake',
        mode: 'private',
        target: '小爱'
    });
    assert.deepStrictEqual(parseConversationCommand('妲己开始对话', assistants), {
        type: 'wake',
        mode: 'private',
        target: '妲己'
    });
}

function testStateTransitions() {
    let state = createConversationState(true);
    let result = reduceConversationInput(state, '小爱你好', assistants, 1000);
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.state.state, 'activeGroup');

    result = reduceConversationInput(result.state, '小爱开始对话', assistants, 2000);
    assert.strictEqual(result.state.state, 'activePrivate');
    assert.strictEqual(result.state.target, '小爱');

    result = reduceConversationInput(result.state, '结束对话', assistants, 3000);
    assert.strictEqual(result.state.state, 'waitingWake');
    assert.strictEqual(result.state.target, null);
}

function testDisabledAndExpiry() {
    const disabled = createConversationState(false);
    const ignored = reduceConversationInput(disabled, '你好小爱', assistants, 1000);
    assert.strictEqual(ignored.accepted, false);
    assert.strictEqual(ignored.state.state, 'disabled');

    const active = {
        ...createConversationState(true),
        state: 'activeGroup',
        lastValidInputAt: 1000
    };
    assert.strictEqual(isConversationExpired(active, 180999), false);
    assert.strictEqual(isConversationExpired(active, 181000), true);
}

function testBuiltinCommandBypassesWakeWithoutActivatingConversation() {
    const waiting = createConversationState(true);
    const isBuiltin = text => text.includes('现在几点');

    const builtinResult = reduceConversationInput(
        waiting,
        '现在几点？',
        assistants,
        1000,
        { isBuiltin }
    );
    assert.strictEqual(builtinResult.accepted, true);
    assert.deepStrictEqual(builtinResult.state, waiting);
    assert.deepStrictEqual(builtinResult.event, { type: 'input', bypassWake: true });

    const ordinaryResult = reduceConversationInput(
        waiting,
        '今天天气怎么样',
        assistants,
        1000,
        { isBuiltin }
    );
    assert.strictEqual(ordinaryResult.accepted, false);
    assert.strictEqual(ordinaryResult.state.state, 'waitingWake');
}

testInitialState();
testWakeAndPrivateSwitch();
testStateTransitions();
testDisabledAndExpiry();
testBuiltinCommandBypassesWakeWithoutActivatingConversation();
console.log('display-voice-conversation.test.js: 5/5 passed');
