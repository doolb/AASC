const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGomokuGameService, parseGameTag, extractGameTags, stripGameTags } =
    require('../src/apps/server/modules/game/gomoku-game-service');
const { runGameAwareChat, filterGameProtocolText } = require('../src/apps/server/modules/game/game-chat-bridge');
const { createGomokuDisplayDemoService, isLoopbackAddress } =
    require('../src/apps/server/modules/game/gomoku-display-demo-service');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-gomoku-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const events = [];
    const options = { filePath: path.join(directory, 'gomoku.json'), onUpdate: (_, message) => events.push(message) };
    return { game: createGomokuGameService(options), events, options };
}

function call(actor, operation, ...args) {
    return parseGameTag(`<Game:五子棋,${actor},${operation}${args.length ? ',' + args.join(',') : ''}>`);
}

test('位置参数标签严格解析且可从正文移除', () => {
    assert.deepEqual(call('User', '落子', 'H8').args, ['H8']);
    assert.equal(call('GM', '落子', 'H8'), null);
    assert.deepEqual(call('AI', '开局', '12').args, ['12']);
    assert.equal(parseGameTag('<Game:五子棋,AI,落子,H8,多余>'), null);
    assert.equal(extractGameTags('请看 <Game:五子棋,AI,落子,G8>')[0].call.actor, 'AI');
    assert.equal(stripGameTags('请看 <Game:五子棋,AI,落子,G8>'), '请看');
});

test('落子只发送增量，按显示端保存与恢复快照', t => {
    const { game, events, options } = fixture(t);
    const opened = game.apply('display-a', call('User', '开局'));
    assert.equal(opened.ok, true);
    assert.equal(events[0].type, 'gameSnapshot');
    assert.equal(events[0].board.split('/').length, 15);
    const moved = game.apply('display-a', call('User', '落子', 'H8'), { expectedVersion: 1, source: 'displayClick' });
    assert.equal(moved.ok, true);
    assert.equal(events[1].type, 'gameDelta');
    assert.equal(Object.hasOwn(events[1], 'board'), false);
    assert.match(events[1].tag, /^<Game:五子棋,Game,落子,/);
    assert.match(moved.gm, /^<Game:五子棋,GM,落子,/);
    assert.equal(game.apply('display-a', call('AI', '落子', 'H8')).code, '位置已占用');
    assert.equal(game.apply('display-a', call('AI', '落子', 'G8'), { expectedVersion: 1 }).code, '版本过期');
    assert.equal(game.snapshot('display-b'), null);
    const restored = createGomokuGameService(options).snapshot('display-a');
    assert.equal(restored.revision, 2);
    assert.equal(restored.board.split('/')[7][7], 'X');
});

test('AI 不能替用户编造坐标，中文数字坐标可通过', t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    assert.equal(game.apply('d', call('User', '落子', 'H8'), { userText: '我想下 C3' }).code,
        '用户未指定该坐标');
    assert.equal(game.apply('d', call('User', '落子', 'A1'), { userText: 'A一。' }).ok, true);
});

test('横向五子获胜且中途尺寸变更必须确认', t => {
    const { game, events } = fixture(t);
    game.apply('d', call('User', '开局', '9'));
    assert.equal(game.apply('d', call('AI', '落子', 'A1')).code, '未轮到该方');
    for (let x = 0; x < 5; x += 1) {
        const user = game.apply('d', call('User', '落子', `${String.fromCharCode(65 + x)}2`), { source: 'displayClick' });
        assert.equal(user.ok, true);
        if (x < 4) assert.equal(game.apply('d', call('AI', '落子', `${String.fromCharCode(65 + x)}1`)).ok, true);
    }
    assert.equal(game.snapshot('d').result, 'User胜');
    assert.equal(game.apply('d', call('AI', '落子', 'F1')).code, '棋局已结束');
    assert.equal(game.apply('d', call('AI', '提议尺寸', '11')).ok, true);
    assert.equal(game.apply('d', call('User', '确认尺寸', '11'), { userText: '改成11' }).code, '需要用户确认');
    assert.equal(game.apply('d', call('User', '确认尺寸', '11'), { userText: '确认改成11' }).ok, true);
    assert.equal(events.at(-1).type, 'gameSnapshot');
    assert.equal(game.snapshot('d').size, 11);
    assert.equal(game.snapshot('d').result, '进行中');
});

test('已有棋局不能用开局绕过尺寸确认或擅自重置', t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局', '9'));
    const gameId = game.snapshot('d').gameId;
    assert.equal(game.apply('d', call('User', '开局', '11'), { userText: '重新开始11路' }).code,
        '请先提议尺寸并等待用户确认');
    assert.equal(game.apply('d', call('User', '开局', '9'), { userText: '继续玩' }).code,
        '棋局进行中，需要用户明确要求重新开局');
    assert.equal(game.snapshot('d').gameId, gameId);
    assert.equal(game.apply('d', call('User', '开局'), { userText: '重新开始' }).ok, true);
    assert.equal(game.snapshot('d').size, 9);
    assert.notEqual(game.snapshot('d').gameId, gameId);
});

test('语音用户落子由 AI 标签调用，GM 增量之后 AI 自己落子', async t => {
    const { game, events } = fixture(t);
    game.apply('d', call('User', '开局'));
    const prompts = [];
    const answers = [
        '<Game:五子棋,User,落子,H8>',
        '<Game:五子棋,AI,落子,G8>',
        '我下在 G8，轮到你了。'
    ];
    const systemPrompts = [];
    const fakeChat = {
        splitIntoSentences: text => [text],
        async chatStream(prompt, options) {
            prompts.push(prompt);
            systemPrompts.push(options.systemPrompt);
            return { success: true, message: answers.shift(), speech: '', reasoning: '', history: [] };
        }
    };
    const chunks = [];
    const sentences = [];
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我下在 H8', options: { systemPrompt: '原角色' }, callbacks: {
            onChunk: chunk => chunks.push(chunk), onSentence: text => sentences.push(text)
        } });
    assert.equal(result.message, '我下在 G8，轮到你了。');
    assert.deepEqual(events.slice(1).map(event => event.actor), ['User', 'AI']);
    assert.match(prompts[0], /GM,快照/);
    assert.match(prompts[1], /GM,落子/);
    assert.match(systemPrompts[0], /不使用 JSON/);
    assert.deepEqual(chunks, ['我下在 G8，轮到你了。']);
    assert.deepEqual(sentences, ['我下在 G8，轮到你了。']);
    const followup = [];
    await runGameAwareChat({ chat: { ...fakeChat, async chatStream(prompt) {
        followup.push(prompt);
        return { success: true, message: '请继续。', history: [] };
    } }, gameService: game, displayId: 'd', content: '我再看看棋盘',
    options: { systemPrompt: '原角色' }, callbacks: {} });
    assert.equal(followup[0].includes('GM,快照'), false);
});

test('点击先直接提交，再把 GM 增量交给 AI', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const click = game.apply('d', call('User', '落子', 'C3'), { expectedVersion: 1, source: 'displayClick' });
    const prompts = [];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(prompt) {
        prompts.push(prompt);
        return { success: true, message: prompts.length === 1 ? '<Game:五子棋,AI,落子,D3>' : '已落子。', history: [] };
    } };
    await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd', content: click.gm,
        internalSignal: true, options: {}, callbacks: {} });
    assert.match(prompts[0], /GM,落子/);
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[2][3], 'O');
});

test('是否开局只由 AI 标签决定，不按用户关键词补发指令', async t => {
    const { game } = fixture(t);
    const prompts = [];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(prompt, options) {
        prompts.push({ prompt, systemPrompt: options.systemPrompt });
        return { success: true, message: prompts.length === 1 ? '我们可以聊聊规则。'
            : prompts.length === 2 ? '<Game:五子棋,User,开局>' : '棋盘已经打开。', history: [] };
    } };
    const first = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我们来玩五子棋', options: {}, callbacks: {} });
    assert.equal(first.message, '我们可以聊聊规则。');
    assert.equal(game.snapshot('d'), null);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].systemPrompt, /游戏操作/);
    const second = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '开始吧', options: {}, callbacks: {} });
    assert.equal(second.message, '棋盘已经打开。');
    assert.equal(game.snapshot('d').size, 15);
});

test('普通回复仍流式输出，游戏标签片段不会混入可见消息', async t => {
    const { game } = fixture(t);
    const chunks = [];
    const sentences = [];
    const fakeChat = { async chatStream(_prompt, _options, callbacks) {
        for (const message of ['今', '今天', '今天好']) {
            callbacks.onChunk?.(message.at(-1), message, '');
        }
        callbacks.onSentence?.('今天好', '今天好', '', '今天好', 'answer');
        return { success: true, message: '今天好', speech: '今天好', history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '天气', options: {}, callbacks: { onChunk: chunk => chunks.push(chunk),
            onSentence: sentence => sentences.push(sentence) } });
    assert.deepEqual(chunks, ['今', '天', '好']);
    assert.deepEqual(sentences, ['今天好']);
    assert.equal(result.message, '今天好');
    assert.equal(game.snapshot('d'), null);
    assert.equal(filterGameProtocolText('你好 <Ga'), '你好 ');
    assert.equal(filterGameProtocolText('你好 <Ga', true), '你好 <Ga');
    assert.equal(filterGameProtocolText('你好 <Game:五子棋,AI,落子,H8>。'), '你好 。');
});

test('流式游戏标签先缓冲，执行后只显示 AI 的最终叙述', async t => {
    const { game } = fixture(t);
    const chunks = [];
    let round = 0;
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(_prompt, _options, callbacks) {
        round += 1;
        if (round === 1) {
            for (const message of ['<', '<Game:', '<Game:五子棋,User,开局>']) {
                callbacks.onChunk?.(message.at(-1), message, '');
            }
            return { success: true, message: '<Game:五子棋,User,开局>', history: [] };
        }
        return { success: true, message: '开始下棋吧。', history: [] };
    } };
    await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '开始', options: {}, callbacks: { onChunk: chunk => chunks.push(chunk) } });
    assert.deepEqual(chunks, ['开始下棋吧。']);
    assert.equal(game.snapshot('d').size, 15);
});

test('普通流里夹带的游戏标签不执行也不传给字幕和语音', async t => {
    const { game } = fixture(t);
    const chunks = [];
    const sentences = [];
    const raw = '你好<Game:五子棋,User,开局>';
    const fakeChat = { async chatStream(_prompt, _options, callbacks) {
        callbacks.onChunk?.('你好', '你好', '');
        callbacks.onChunk?.('<Game:', '你好<Game:', '');
        callbacks.onChunk?.('完', raw, '');
        callbacks.onSentence?.(raw, raw, '', raw, 'answer');
        return { success: true, message: raw, speech: raw, history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '打招呼', options: {}, callbacks: { onChunk: chunk => chunks.push(chunk),
            onSentence: sentence => sentences.push(sentence) } });
    assert.equal(result.message, '你好');
    assert.deepEqual(chunks, ['你好']);
    assert.deepEqual(sentences, ['你好']);
    assert.equal(game.snapshot('d'), null);
});

test('显示端演示只发送临时画面，结束或断线恢复权威棋盘', t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const original = game.snapshot('d');
    const events = [];
    const timers = [];
    const owner = {};
    const demo = createGomokuDisplayDemoService({
        getSnapshot: id => game.snapshot(id), isOnline: id => id === 'd',
        sendToDisplay: (_, message) => { events.push(message); return true; },
        schedule: callback => { const timer = { callback, cancelled: false }; timers.push(timer); return timer; },
        cancel: timer => { timer.cancelled = true; }
    });
    assert.equal(isLoopbackAddress('127.0.0.1'), true);
    assert.equal(isLoopbackAddress('192.168.1.2'), false);
    assert.equal(demo.start(owner, 'd').ok, true);
    assert.equal(events[0].type, 'gameSnapshot');
    assert.equal(events[0].demo, true);
    timers[0].callback();
    timers[1].callback();
    assert.deepEqual(events.slice(1, 3).map(message => message.actor), ['User', 'AI']);
    assert.equal(game.snapshot('d').revision, original.revision);
    assert.equal(game.snapshot('d').board, original.board);
    demo.stopForControl(owner);
    assert.equal(events.at(-1).gameId, original.gameId);
    assert.equal(events.at(-1).type, 'gameSnapshot');
    assert.equal(demo.start(owner, 'd').ok, true);
    assert.equal(demo.cancelForRealUpdate('d'), true);
    assert.equal(timers.slice(-2).every(timer => timer.cancelled), true);
    const emptyEvents = [];
    const emptyDemo = createGomokuDisplayDemoService({
        getSnapshot: () => null, isOnline: () => true,
        sendToDisplay: (_, message) => { emptyEvents.push(message); return true; }
    });
    assert.equal(emptyDemo.start(owner, 'empty').ok, true);
    emptyDemo.stopForControl(owner);
    assert.equal(emptyEvents.at(-1).type, 'gameDemoEnd');
});
