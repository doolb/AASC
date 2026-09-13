const assert = require('assert');
const {
    createConversationState,
    parseConversationCommand,
    reduceConversationInput,
    isConversationExpired
} = require('../src/apps/server/modules/voice/display-voice-conversation');
const voiceCommand = require('../src/apps/web-mediacenter/modules/voice/voice-command-app-service');

const assistants = ['小爱', '妲己'];
const alternateAssistants = ['云雀', '妲己'];

function testInitialState() {
    const state = createConversationState(true);
    assert.strictEqual(state.state, 'waitingWake');
    assert.strictEqual(state.target, null);
    assert.strictEqual(parseConversationCommand('小爱', []), null);
}

function testWakeAndPrivateSwitch() {
    assert.deepStrictEqual(parseConversationCommand('你好小爱', assistants), {
        type: 'wake',
        mode: 'private',
        windowType: 'conversation',
        target: '小爱'
    });
    assert.deepStrictEqual(parseConversationCommand('小爱，你好', assistants), {
        type: 'wake',
        mode: 'private',
        windowType: 'conversation',
        target: '小爱'
    });
    assert.deepStrictEqual(parseConversationCommand('小 爱 —— 你 好', assistants), {
        type: 'wake',
        mode: 'private',
        windowType: 'conversation',
        target: '小爱'
    });
    assert.deepStrictEqual(parseConversationCommand('开始对话', assistants), {
        type: 'wake',
        mode: 'group',
        windowType: 'conversation',
        target: null
    });
    assert.deepStrictEqual(parseConversationCommand('小爱', assistants), {
        type: 'wake',
        mode: 'group',
        windowType: 'temporary',
        target: null,
        assistantName: '小爱'
    });
    assert.deepStrictEqual(parseConversationCommand('再见，小爱', assistants), {
        type: 'endPrivate',
        target: '小爱'
    });
    assert.deepStrictEqual(parseConversationCommand('再见 —— 小 爱', assistants), {
        type: 'endPrivate',
        target: '小爱'
    });
    assert.deepStrictEqual(parseConversationCommand('妲己，你好', assistants), {
        type: 'wake',
        mode: 'private',
        windowType: 'conversation',
        target: '妲己'
    });
    assert.deepStrictEqual(parseConversationCommand('云雀', alternateAssistants), {
        type: 'wake',
        mode: 'group',
        windowType: 'temporary',
        target: null,
        assistantName: '云雀'
    });
    assert.strictEqual(parseConversationCommand('小爱', alternateAssistants), null);
    assert.deepStrictEqual(parseConversationCommand('你好，云雀', alternateAssistants), {
        type: 'wake',
        mode: 'private',
        windowType: 'conversation',
        target: '云雀'
    });
    assert.deepStrictEqual(parseConversationCommand('再见，云雀', alternateAssistants), {
        type: 'endPrivate',
        target: '云雀'
    });
}

function testStateTransitions() {
    let state = createConversationState(true);
    let result = reduceConversationInput(state, '小爱', assistants, 1000);
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.state.state, 'activeGroup');
    assert.strictEqual(result.state.windowType, 'temporary');

    result = reduceConversationInput(result.state, '小爱你好', assistants, 2000);
    assert.strictEqual(result.state.state, 'activePrivate');
    assert.strictEqual(result.state.target, '小爱');

    result = reduceConversationInput(result.state, '小爱再见', assistants, 3000);
    assert.strictEqual(result.state.state, 'waitingWake');
    assert.strictEqual(result.state.target, null);

    result = reduceConversationInput(result.state, '开始对话', assistants, 4000);
    assert.strictEqual(result.state.state, 'activeGroup');
    assert.strictEqual(result.state.windowType, 'conversation');

    result = reduceConversationInput(result.state, '结束对话', assistants, 5000);
    assert.strictEqual(result.state.state, 'waitingWake');
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

    const temporary = {
        ...active,
        windowType: 'temporary'
    };
    assert.strictEqual(isConversationExpired(temporary, 30999), false);
    assert.strictEqual(isConversationExpired(temporary, 31000), true);
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

function testSystemHelpBypassesWakeWithTrailingPunctuation() {
    const waiting = createConversationState(true);
    const result = reduceConversationInput(
        waiting,
        '系统。',
        assistants,
        1000,
        { isBuiltin: voiceCommand.isBuiltinVoiceCommand }
    );
    assert.strictEqual(result.accepted, true);
    assert.deepStrictEqual(result.state, waiting);
    assert.deepStrictEqual(result.event, { type: 'input', bypassWake: true });
}

function testCustomCommandBypassesWakeWithoutActivatingConversation() {
    const waiting = createConversationState(true);
    const commandConfig = { commands: { '晚安': ['关闭报时', '静音'] } };
    const isWakeFree = text => voiceCommand.isWakeFreeVoiceCommand(text, commandConfig);
    const result = reduceConversationInput(
        waiting,
        '晚安。',
        assistants,
        1000,
        { isBuiltin: isWakeFree }
    );

    assert.strictEqual(voiceCommand.isWakeFreeVoiceCommand('晚安。', commandConfig), true);
    assert.strictEqual(result.accepted, true);
    assert.deepStrictEqual(result.state, waiting);
    assert.deepStrictEqual(result.event, { type: 'input', bypassWake: true });
}

function testConfirmationKeywordInsideOrdinarySentenceDoesNotBypassWake() {
    const waiting = createConversationState(true);
    const result = reduceConversationInput(
        waiting,
        '拒绝奖励出街注意。',
        assistants,
        1000,
        { isBuiltin: voiceCommand.isBuiltinVoiceCommand }
    );
    assert.strictEqual(result.accepted, false);
    assert.strictEqual(result.state.state, 'waitingWake');
    assert.strictEqual(result.event, null);
}

function testAddressedGroupInputIsOneShotWithoutActivatingConversation() {
    const waiting = createConversationState(true);
    const result = reduceConversationInput(
        waiting,
        '小爱，请介绍一下今天的安排',
        assistants,
        1000,
        { addressedGroupMode: 'oneShot' }
    );
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.state.state, 'waitingWake');
    assert.strictEqual(result.state.lastValidInputAt, null);
    assert.deepStrictEqual(result.event, {
        type: 'input',
        addressedAssistant: '小爱',
        oneShotGroup: true
    });
}

function testAddressedGroupInputStartsTemporaryConversationByDefault() {
    const waiting = createConversationState(true);
    const result = reduceConversationInput(
        waiting,
        '妲己，请介绍一下今天的安排',
        assistants,
        1000
    );
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.state.state, 'activeGroup');
    assert.strictEqual(result.state.windowType, 'temporary');
    assert.strictEqual(result.state.lastValidInputAt, 1000);
    assert.strictEqual(result.event.temporaryConversationStarted, true);
    assert.strictEqual(result.event.addressedAssistant, '妲己');
}

function testPureAddressedWakeDoesNotBecomeChatInput() {
    const waiting = createConversationState(true);
    const result = reduceConversationInput(waiting, '你好，小爱。', assistants, 1000);
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.state.state, 'activePrivate');
    assert.deepStrictEqual(result.event, {
        type: 'wake',
        mode: 'private',
        windowType: 'conversation',
        target: '小爱'
    });
}

testInitialState();
testWakeAndPrivateSwitch();
testStateTransitions();
testDisabledAndExpiry();
testBuiltinCommandBypassesWakeWithoutActivatingConversation();
testSystemHelpBypassesWakeWithTrailingPunctuation();
testCustomCommandBypassesWakeWithoutActivatingConversation();
testConfirmationKeywordInsideOrdinarySentenceDoesNotBypassWake();
testAddressedGroupInputIsOneShotWithoutActivatingConversation();
testAddressedGroupInputStartsTemporaryConversationByDefault();
testPureAddressedWakeDoesNotBecomeChatInput();
console.log('display-voice-conversation.test.js: 11/11 passed');
