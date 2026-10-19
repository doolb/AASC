const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGomokuGameService, parseGameTag, extractGameTags, stripGameTags } =
    require('../src/apps/server/modules/game/gomoku-game-service');
const { runGameAwareChat } = require('../src/apps/server/modules/game/game-chat-bridge');

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
