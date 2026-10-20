const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGomokuGameService, parseGameTag, extractGameTags, stripGameTags } =
    require('../src/apps/server/modules/game/gomoku-game-service');
const { runGameAwareChat, filterGameProtocolText, formatGameProtocolSummary } =
    require('../src/apps/server/modules/game/game-chat-bridge');
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
    const protocolActor = actor === 'User' ? 'GameUser' : actor === 'AI' ? 'GameAI' : actor;
    return parseGameTag(`Game:五子棋,${protocolActor},${operation}${args.length ? ',' + args.join(',') : ''}`);
}

test('独立协议行严格解析且可从正文移除', () => {
    assert.deepEqual(call('User', '落子', 'H8').args, ['H8']);
    assert.equal(parseGameTag('Game:目录,GameAI,列表').operation, '列表');
    assert.equal(parseGameTag('Game:五子棋,GameAI,规则').operation, '规则');
    assert.equal(call('GM', '落子', 'H8'), null);
    assert.deepEqual(call('AI', '开局', '12').args, ['12']);
    assert.equal(parseGameTag('Game:五子棋,GameAI,落子,H8,多余'), null);
    assert.equal(extractGameTags('请看 Game:五子棋,GameAI,落子,G8').length, 0);
    assert.equal(stripGameTags('请看 Game:五子棋,GameAI,落子,G8'), '请看 Game:五子棋,GameAI,落子,G8');
    assert.equal(extractGameTags('Game:五子棋,GameAI,落子,G8\n请看')[0].call.actor, 'AI');
    assert.equal(stripGameTags('Game:五子棋,GameAI,落子,G8\n请看'), '请看');
    assert.equal(parseGameTag('<Game:五子棋,GameAI,落子,G8>').operation, '落子');
    assert.equal(extractGameTags('请看 <Game:五子棋,GameAI,落子,G8>')[0].call.actor, 'AI');
    assert.equal(stripGameTags('请看 <Game:五子棋,GameAI,落子,G8>'), '请看');
    assert.equal(parseGameTag('Game:五子棋，AI，落子，G8'), null);
    assert.equal(parseGameTag('Game:五子棋,GameUser,开局来玩吧。'), null);
    assert.equal(formatGameProtocolSummary('GameAI', 'Game:五子棋,GameAI,落子,H4'), 'GameAI · 落子 H4');
    assert.equal(formatGameProtocolSummary('GameAI', '<Game:五子棋,GameAI,落子,H4>'), 'GameAI · 落子 H4');
    assert.equal(formatGameProtocolSummary('GM', 'Game:五子棋,GM,落子,1234,3,GameAI,H4,GameUser,进行中'),
        'GM · #1234 第3手 GameAI H4');
    assert.equal(formatGameProtocolSummary('GM', 'Game:五子棋,GM,状态,1234,10,9,GameUser胜'),
        'GM · #1234 状态 GameUser胜');
});

test('活动棋局才接受 GameUser/GameAI 行首简写，旧角色与行内文字不触发操作', () => {
    assert.equal(parseGameTag('Game:五子棋,User,落子,A9'), null);
    assert.equal(parseGameTag('Game:五子棋,AI,落子,F5'), null);
    assert.equal(parseGameTag('<Game:五子棋,User,落子,A9>'), null);
    assert.equal(parseGameTag('GameUser:落子,A9'), null);
    assert.deepEqual(parseGameTag('GameUser:落子,A9', '五子棋'),
        { game: '五子棋', actor: 'User', operation: '落子', args: ['A9'], raw: 'GameUser:落子,A9' });
    assert.equal(parseGameTag('GameAI:落子,F5', '五子棋').actor, 'AI');
    assert.equal(parseGameTag('GameUser:落子,A9,多余', '五子棋'), null);
    assert.equal(extractGameTags('GameUser:落子,A9').length, 0);
    assert.equal(stripGameTags('GameUser:落子,A9'), 'GameUser:落子,A9');
    assert.equal(extractGameTags('请看 GameUser:落子,A9', '五子棋').length, 0);
    assert.equal(extractGameTags('User:落子,A9\nAI:落子,F5', '五子棋').length, 0);
    assert.deepEqual(extractGameTags('GameUser:落子,A9\nGameAI:落子,F5', '五子棋')
        .map(tag => tag.call.actor), ['User', 'AI']);
    assert.equal(stripGameTags('收到啦。\nGameUser:落子,A9\nGameAI:落子,F5\n等 GM。', '五子棋'),
        '收到啦。\n等 GM。');
    assert.equal(formatGameProtocolSummary('GameAI', 'GameAI:落子,F5'), 'GameAI · 落子 F5');
    assert.equal(filterGameProtocolText('GameU', false, '五子棋'), '');
    assert.equal(filterGameProtocolText('GameUser:落子,A9\n收到', false, '五子棋'), '收到');
    assert.equal(filterGameProtocolText('GameUser:落子,A9', true), 'GameUser:落子,A9');
});

test('旧尖括号的多条查询和正文内单条调用仍可执行', async t => {
    const { game } = fixture(t);
    const inputs = [];
    const answers = ['<Game:目录,GameAI,列表>\n<Game:五子棋,GameAI,规则>',
        '请看 <Game:五子棋,GameUser,开局>棋盘已打开。'];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '开始五子棋', options: {}, callbacks: {} });
    assert.equal(inputs.length, 2);
    assert.match(inputs[1], /Game:目录,GM,列表,五子棋/);
    assert.match(inputs[1], /Game:五子棋,GM,规则,/);
    assert.equal(game.snapshot('d').revision, 1);
    assert.equal(result.message, '请看 棋盘已打开。');
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
    assert.match(events[1].tag, /^Game:五子棋,Game,落子,/);
    assert.match(moved.gm, /^Game:五子棋,GM,落子,/);
    assert.match(moved.gm, /^Game:五子棋,GM,落子,[a-f\d]{4},2,/);
    assert.equal(moved.gm.includes(opened.message.gameId), false);
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
    let terminalGm = '';
    for (let x = 0; x < 5; x += 1) {
        const user = game.apply('d', call('User', '落子', `${String.fromCharCode(65 + x)}2`), { source: 'displayClick' });
        assert.equal(user.ok, true);
        if (x === 4) terminalGm = user.gm;
        if (x < 4) assert.equal(game.apply('d', call('AI', '落子', `${String.fromCharCode(65 + x)}1`)).ok, true);
    }
    assert.equal(game.snapshot('d').result, 'User胜');
    assert.match(terminalGm, /^Game:五子棋,GM,落子,[a-f\d]{4},10,GameUser,E2$/);
    assert.match(game.apply('d', call('AI', '查看')).gm,
        /^Game:五子棋,GM,状态,[a-f\d]{4},10,9,GameUser胜$/);
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
        'Game:五子棋,GameUser,落子,H8',
        'Game:五子棋,GameAI,落子,G8',
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
    const gameTrace = [];
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我下在 H8', options: { systemPrompt: '原角色' }, callbacks: {
            onChunk: chunk => chunks.push(chunk), onSentence: text => sentences.push(text),
            onGameProtocol: entry => gameTrace.push(entry)
        } });
    assert.equal(result.message, '我下在 G8，轮到你了。');
    assert.deepEqual(events.slice(1).map(event => event.actor), ['User', 'AI']);
    assert.match(prompts[0], /GM,快照/);
    assert.match(prompts[1], /GM,落子/);
    assert.equal(prompts.some(prompt => prompt.includes('根据权威结果继续')), false);
    assert.deepEqual(gameTrace.map(entry => entry.kind), ['GM', 'GameUser', 'GM', 'GameAI', 'GM']);
    assert.equal(gameTrace.some(entry => entry.text.includes('根据权威结果继续')), false);
    assert.match(systemPrompts[0], /Game:目录,GameAI,列表/);
    assert.match(systemPrompts[0], /回复开头最多 8 条调用行，每条独占一行/);
    assert.match(systemPrompts[0], /如果该调用行需要等待确认或者数据,以及GameUser或者GameAI操作游戏需要等待状态确认时,是原子操作,等待调行回复,不能再发其他调用行/);
    assert.match(systemPrompts[0], /用户报坐标时先发 GameUser 落子行，等 GM 确认且轮到 GameAI，再决定并发 GameAI 落子行/);
    assert.match(systemPrompts[0], /自然语言另起行,每次回复都带上自然语言/);
    assert.match(systemPrompts[0], /首次需要本地游戏时先发下面的, 调用目录查询，\nGame:目录,GameAI,列表\n\n然后再发下面的按需读取规则；已有规则时按规则操作。\nGame:游戏名,GameAI,规则/);
    assert.equal(systemPrompts[0].includes('默认 15×15'), false);
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
        return { success: true, message: prompts.length === 1 ? 'Game:五子棋,GameAI,落子,D3' : '已落子。', history: [] };
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
            : prompts.length === 2 ? 'Game:五子棋,GameUser,开局' : '棋盘已经打开。', history: [] };
    } };
    const first = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我们来玩五子棋', options: {}, callbacks: {} });
    assert.equal(first.message, '我们可以聊聊规则。');
    assert.equal(game.snapshot('d'), null);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].systemPrompt, /Game:目录,GameAI,列表/);
    const second = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '开始吧', options: {}, callbacks: {} });
    assert.equal(second.message, '棋盘已经打开。');
    assert.equal(game.snapshot('d').size, 15);
});

test('已有棋局漏发标签时由模型补判用户坐标，不播出错误首答', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const answers = [
        '喵，轮到你落子。',
        'Game:目录,GameAI,列表',
        'Game:五子棋,GameAI,规则',
        'Game:五子棋,GameUser,落子,H3\n你下 H3。',
        'Game:五子棋,GameAI,落子,H4\n我下 H4。'
    ];
    const inputs = [];
    const chunks = [];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input, options, callbacks) {
        inputs.push({ input, systemPrompt: options.systemPrompt });
        const message = answers.shift();
        callbacks.onChunk?.(message, message, '');
        return { success: true, message, history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H3。', options: {}, callbacks: { onChunk: chunk => chunks.push(chunk) } });
    assert.equal(inputs.length, 5);
    assert.match(inputs[0].systemPrompt, /语音坐标也由你代发/);
    assert.match(inputs[0].systemPrompt, /NowGame:五子棋/);
    assert.match(inputs[1].input, /原话：H3。/);
    assert.equal(result.message, '你下 H3。\n我下 H4。');
    assert.deepEqual(chunks, [result.message]);
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[2][7], 'X');
    assert.equal(game.snapshot('d').board.split('/')[3][7], 'O');
});

test('已有棋局中的普通聊天重判后仍保留原回复且不改变棋盘', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const inputs = [];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        return { success: true, message: inputs.length === 1 ? '今天晴朗。' : '天气不错。', history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '今天天气怎么样？', options: {}, callbacks: {} });
    assert.equal(inputs.length, 2);
    assert.equal(result.message, '今天晴朗。');
    assert.equal(game.snapshot('d').revision, 1);
});

test('AI 按需读取当前显示端目录和五子棋规则，成功标签后的叙述不丢失', async t => {
    const { game } = fixture(t);
    const inputs = [];
    const answers = [
        'Game:目录,GameAI,列表\n我先看看可用游戏。',
        'Game:五子棋,GameAI,规则',
        'Game:五子棋,GameUser,开局\n来玩吧，你先落黑子。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input, options) {
        inputs.push({ input, systemPrompt: options.systemPrompt });
        return { success: true, message: answers.shift(), history: [] };
    } };
    const trace = [];
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我们来玩五子棋', options: { systemPrompt: '原角色设定' },
        callbacks: { onGameProtocol: entry => trace.push(entry) },
        getAvailableGames: () => ['五子棋'] });
    assert.equal(result.message, '我先看看可用游戏。\n来玩吧，你先落黑子。');
    assert.equal(inputs.length, 3);
    assert.match(inputs[1].input, /目录,GM,列表,五子棋/);
    assert.match(inputs[2].input, /五子棋,GM,规则/);
    assert.equal(inputs[0].systemPrompt.includes('横竖斜连续五子'), false);
    assert.match(inputs[0].systemPrompt, /NowGame:无/);
    assert.equal(inputs[0].systemPrompt.includes('五子棋规则:'), false);
    assert.equal(inputs[2].systemPrompt.includes('五子棋规则:'), false);
    assert.match(inputs[2].input, /Game:五子棋,GM,规则,操作：开局/);
    assert.equal(inputs[2].input.includes('位置参数标签只用英文逗号'), false);
    assert.ok(inputs[0].systemPrompt.indexOf('目录,AI,列表')
        < inputs[0].systemPrompt.indexOf('NowGame:无'));
    assert.ok(inputs[0].systemPrompt.indexOf('NowGame:无')
        < inputs[0].systemPrompt.indexOf('原角色设定'));
    assert.equal(game.snapshot('d').revision, 1);
    assert.deepEqual(trace.map(entry => entry.kind), ['GameAI', 'GM', 'GameAI', 'GM', 'GameUser', 'GM']);
    assert.deepEqual(trace.slice(0, 3).map(entry => entry.summary),
        ['GameAI · 列表', 'GM · 当前支持：五子棋', 'GameAI · 规则']);
    const rules = inputs[2].input.match(/Game:五子棋,GM,规则,([^\n]+)/)?.[1];
    assert.ok(rules);
    assert.match(rules, /GM快照字段：短编号,版本,尺寸,下一手,结果,棋盘编码/);
    assert.match(rules, /棋盘用\/从上到下分行，每行从左到右对应A至末列，第一行是第1行/);
    assert.match(rules, /\.为空位，X是用户黑棋，O是AI白棋（字母O）/);
    assert.match(rules, /落子前按行列检查目标格为\./);
    const followupPrompts = [];
    await runGameAwareChat({ chat: { splitIntoSentences: text => [text],
        async chatStream(_input, nextOptions) {
            followupPrompts.push(nextOptions.systemPrompt);
            return { success: true, message: '你先落子。', history: [] };
        } }, gameService: game, displayId: 'd', content: '继续', internalSignal: true,
    options: { systemPrompt: '原角色设定' }, callbacks: {} });
    assert.match(followupPrompts[0], /NowGame:五子棋\n五子棋规则:/);
    assert.ok(followupPrompts[0].includes(`五子棋规则:${rules}`));
    assert.equal(followupPrompts[0].includes('位置参数标签只用英文逗号'), false);
});

test('五子棋快照的第五行 E 格能按规则识别为 AI 已占用', t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局', '9'));
    game.apply('d', call('User', '落子', 'A1'), { source: 'displayClick' });
    game.apply('d', call('AI', '落子', 'E5'));
    game.apply('d', call('User', '落子', 'I9'), { source: 'displayClick' });
    game.apply('d', call('AI', '落子', 'E6'));
    const fields = game.gmSnapshot('d').split(',');
    assert.deepEqual(fields.slice(0, 3), ['Game:五子棋', 'GM', '快照']);
    assert.match(fields[3], /^[a-f\d]{4}$/);
    assert.deepEqual(fields.slice(4, 8), ['5', '9', 'GameUser', '进行中']);
    const rows = fields[8].split('/');
    assert.equal(rows.length, 9);
    assert.equal(rows[4][4], 'O');
    assert.equal(rows[5][4], 'O');
    assert.equal(rows[8][0], '.');
});

test('未声明游戏能力的显示端目录为空，不能读取五子棋规则', async t => {
    const { game } = fixture(t);
    const prompts = [];
    const answers = ['Game:目录,GameAI,列表', 'Game:五子棋,GameAI,规则', '这个显示端暂不支持五子棋。'];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        prompts.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '玩五子棋', options: {}, callbacks: {}, getAvailableGames: () => [] });
    assert.match(prompts[1], /目录,GM,列表,无/);
    assert.match(prompts[2], /当前显示端不支持五子棋/);
    assert.equal(game.snapshot('d'), null);
    assert.match(result.message, /暂不支持/);
});

test('成功的连续用户和 AI 落子保留两次模型叙述且不添加冗长续接语', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const prompts = [];
    const answers = ['Game:五子棋,GameUser,落子,H8\n收到 H8。', 'Game:五子棋,GameAI,落子,G8\n我下 G8。'];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        prompts.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H8', options: {}, callbacks: {} });
    assert.equal(result.message, '收到 H8。\n我下 G8。');
    assert.equal(prompts.length, 2);
    assert.equal(prompts.some(input => input.includes('根据权威结果继续')), false);
});

test('GameUser 与 GameAI 简写经 GM 确认后执行一轮 A9、F5', async t => {
    const { game } = fixture(t);
    assert.equal(game.apply('d', call('User', '开局', '9')).ok, true);
    const prompts = [];
    const trace = [];
    const spoken = [];
    const answers = [
        '好嘞，收到你的 A9。\nGameUser:落子,A9\n等 GM 确认。',
        'GameAI:落子,F5\n我下 F5，轮到你啦。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        prompts.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我下 A9。我继续下散子，你尽量连五获胜。', options: {},
        callbacks: { onGameProtocol: entry => trace.push(entry), onSentence: sentence => spoken.push(sentence) } });
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[8][0], 'X');
    assert.equal(game.snapshot('d').board.split('/')[4][5], 'O');
    assert.match(prompts[1], /GM,落子,[^\n]*,GameUser,A9,GameAI,进行中/);
    assert.equal(result.message, '好嘞，收到你的 A9。\n等 GM 确认。\n我下 F5，轮到你啦。');
    assert.deepEqual(spoken, [result.message]);
    assert.deepEqual(trace.map(entry => entry.kind), ['GM', 'GameUser', 'GM', 'GameAI', 'GM']);
    assert.equal(trace[1].text, 'GameUser:落子,A9');
    assert.equal(trace[1].summary, 'GameUser · 落子 A9');
    assert.equal(trace[3].summary, 'GameAI · 落子 F5');
});

test('同一回复中的 GameUser 与 GameAI 简写不抢跑', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局', '9'));
    const trace = [];
    const inputs = [];
    const answers = [
        'GameUser:落子,A9\nGameAI:落子,E7\n两颗都下好了。',
        'GameAI:落子,F5\n我下 F5。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我下 A9。', options: {}, callbacks: { onGameProtocol: entry => trace.push(entry) } });
    assert.match(inputs[1], /GM,落子,[^\n]*,GameUser,A9,GameAI,进行中/);
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[6][4], '.');
    assert.equal(game.snapshot('d').board.split('/')[4][5], 'O');
    assert.equal(result.message, '我下 F5。');
    assert.deepEqual(trace.filter(entry => entry.kind !== 'GM').map(entry => entry.text),
        ['GameUser:落子,A9', 'GameAI:落子,F5']);
});

for (const terminal of [
    { actor: 'User', userMoves: ['A2', 'B2', 'C2', 'D2'],
        aiMoves: ['A1', 'B1', 'C1', 'D1'], coordinate: 'E2', result: 'User胜',
        content: '我下 E2', first: '你赢了！', final: 'GM 确认，黑棋五连。' },
    { actor: 'AI', userMoves: ['A1', 'I9', 'A9', 'I1', 'A5'],
        aiMoves: ['E5', 'E6', 'E7', 'E8'], coordinate: 'E9', result: 'AI胜',
        content: '继续', first: '我下 E9，接下来该你。', final: 'GM 确认我获胜，本局结束。' }
]) {
    test(`${terminal.result}终局回送 GM 落子与状态，并保留前后两段叙述`, async t => {
        const { game } = fixture(t);
        assert.equal(game.apply('d', call('User', '开局', '9')).ok, true);
        for (const [index, coordinate] of terminal.userMoves.entries()) {
            assert.equal(game.apply('d', call('User', '落子', coordinate),
                { source: 'displayClick' }).ok, true);
            if (terminal.aiMoves[index]) {
                assert.equal(game.apply('d', call('AI', '落子', terminal.aiMoves[index])).ok, true);
            }
        }
        const inputs = [];
        const trace = [];
        const chunks = [];
        const spoken = [];
        const answers = [
            `Game:五子棋,Game${terminal.actor},落子,${terminal.coordinate}\n${terminal.first}`,
            terminal.final
        ];
        const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
            inputs.push(input);
            return { success: true, message: answers.shift(), history: [] };
        } };
        const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
            content: terminal.content, internalSignal: terminal.actor === 'AI', options: {},
            callbacks: { onGameProtocol: entry => trace.push(entry), onChunk: chunk => chunks.push(chunk),
                onSentence: text => spoken.push(text) } });
        assert.equal(inputs.length, 2);
        assert.match(inputs[1], new RegExp(`GM,落子,[^\\n]*,Game${terminal.actor},${terminal.coordinate}\\nGame:五子棋,GM,状态,`));
        assert.match(inputs[1], new RegExp(`GM,状态,[^\\n]*,9,Game${terminal.result}$`));
        assert.equal(game.snapshot('d').result, terminal.result);
        assert.equal(result.message, `${terminal.first}\n${terminal.final}`);
        assert.deepEqual(chunks, [result.message]);
        assert.deepEqual(spoken, [result.message]);
        assert.equal(trace.filter(entry => entry.text.includes(',GM,状态,')).length, 1);
    });
}

test('第七次模型回复产生终局时仍可再读取一次 GM 最终状态', async t => {
    const { game } = fixture(t);
    assert.equal(game.apply('d', call('User', '开局', '9')).ok, true);
    for (const coordinate of ['A2', 'B2', 'C2', 'D2']) {
        assert.equal(game.apply('d', call('User', '落子', coordinate),
            { source: 'displayClick' }).ok, true);
        assert.equal(game.apply('d', call('AI', '落子', `${coordinate[0]}1`)).ok, true);
    }
    const inputs = [];
    const answers = [
        ...Array(6).fill('Game:目录,GameAI,列表\n我先看一下。'),
        'Game:五子棋,GameUser,落子,E2\n第五颗已下。',
        'GM 确认你赢了。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我下 E2', options: {}, callbacks: {} });
    assert.equal(inputs.length, 8);
    assert.match(inputs[7], /GM,状态,.*GameUser胜/);
    assert.match(result.message, /第五颗已下。\nGM 确认你赢了。$/);
});

test('同一回复预写 User 与 AI 落子时，先等 User 的 GM 回执再让模型落 AI 子', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const trace = [];
    const chunks = [];
    const sentences = [];
    const prompts = [];
    const answers = [
        'Game:五子棋,GameUser,落子,H3\n收到 H3，我下 H4。\nGame:五子棋,GameAI,落子,H4\n轮到你啦。',
        'Game:五子棋,GameAI,落子,H4\n我下 H4，轮到你啦。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input, options, callbacks) {
        prompts.push({ input, systemPrompt: options.systemPrompt });
        const message = answers.shift();
        callbacks.onChunk?.(message, message, '');
        return { success: true, message, history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H3。', options: { systemPrompt: '原角色设定' }, callbacks: {
            onChunk: chunk => chunks.push(chunk), onSentence: sentence => sentences.push(sentence),
            onGameProtocol: entry => trace.push(entry)
        } });
    assert.equal(prompts.length, 2);
    assert.match(prompts[0].systemPrompt, /^本地游戏调用行：/);
    assert.ok(prompts[0].systemPrompt.indexOf('目录,AI,列表') < prompts[0].systemPrompt.indexOf('原角色设定'));
    assert.match(prompts[1].input, /GM,落子,.*GameUser,H3,GameAI,进行中/);
    assert.equal(result.message, '我下 H4，轮到你啦。');
    assert.deepEqual(chunks, [result.message]);
    assert.deepEqual(sentences, [result.message]);
    assert.deepEqual(trace.slice(1).map(entry => entry.kind), ['GameUser', 'GM', 'GameAI', 'GM']);
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[2][7], 'X');
    assert.equal(game.snapshot('d').board.split('/')[3][7], 'O');
});

test('A9 与 E7 抢跑时只确认 User 棋步，AI 漏调用后要求其重新落子', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局', '9'));
    for (const [user, ai] of [['A1', 'E5'], ['I9', 'E6']]) {
        game.apply('d', call('User', '落子', user), { source: 'displayClick' });
        game.apply('d', call('AI', '落子', ai));
    }
    const inputs = [];
    const revisions = [];
    const answers = [
        'Game:五子棋,GameUser,落子,A9\nGame:五子棋,GameAI,落子,E7\nA9 和 E7 都下好了。',
        'GM 确认啦，A9 和 E7 都成功落下，现在轮到你。',
        'Game:五子棋,GameAI,落子,E7\n我下 E7，轮到你了。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        revisions.push(game.snapshot('d').revision);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我下 A9。我继续下散子，你尽量连五获胜。', options: {}, callbacks: {} });
    assert.deepEqual(revisions, [5, 6, 6]);
    assert.match(inputs[1], /GM,落子,.*GameUser,A9,GameAI,进行中/);
    assert.match(inputs[2], /GM,错误,轮到GameAI落子/);
    assert.equal(result.message, '我下 E7，轮到你了。');
    assert.equal(game.snapshot('d').board.split('/')[6][4], 'O');
});

test('叙述隔开的多条查询标签都执行，下一次模型输入收到每条 GM 回执', async t => {
    const { game } = fixture(t);
    const inputs = [];
    const trace = [];
    const answers = [
        'Game:目录,GameAI,列表\n先查看游戏。\nGame:五子棋,GameAI,规则\n再看玩法。',
        '可以开始五子棋。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '有什么本地游戏', options: {}, callbacks: { onGameProtocol: entry => trace.push(entry) } });
    assert.equal(inputs.length, 2);
    assert.match(inputs[1], /Game:目录,GM,列表,五子棋/);
    assert.match(inputs[1], /Game:五子棋,GM,规则,/);
    assert.deepEqual(trace.map(entry => entry.kind), ['GameAI', 'GM', 'GameAI', 'GM']);
    assert.equal(result.message.replace(/\n{2,}/g, '\n'), '先查看游戏。\n再看玩法。\n可以开始五子棋。');
});

test('批次第二条失败时停止后续标签，回送已有 GM 并丢弃预写叙述', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const inputs = [];
    const answers = [
        'Game:五子棋,GameAI,查看\n棋局还在。\nGame:五子棋,GameUser,落子,H3\n收到 H3。\nGame:五子棋,GameUser,落子,H2\n你又下 H2。',
        'Game:五子棋,GameAI,落子,H4\n我改下 H4。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const trace = [];
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H3。', options: {}, callbacks: { onGameProtocol: entry => trace.push(entry) } });
    assert.equal(inputs.length, 2);
    assert.match(inputs[1], /GM,落子,.*GameUser,H3,GameAI,进行中/);
    assert.match(inputs[1], /GM,错误,未轮到该方/);
    assert.equal(result.message, '我改下 H4。');
    assert.deepEqual(trace.slice(1).map(entry => entry.kind),
        ['GameAI', 'GM', 'GameUser', 'GM', 'GameUser', 'GM', 'GameAI', 'GM']);
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[1][7], '.');
});

test('GM 拒绝落子后只查看不能宣称棋步成功，未获确认时返回权威提示', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const inputs = [];
    const answers = [
        'Game:五子棋,GameUser,落子,H4\n收到 H4。',
        'Game:五子棋,GameAI,查看\n你下 H3，我下 H4。',
        'H3 和 H4 已经下好了。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H3。', options: {}, callbacks: {} });
    assert.equal(inputs.length, 3);
    assert.match(inputs[1], /GM,错误,用户未指定该坐标/);
    assert.match(inputs[2], /GM,状态,.*1,15,GameUser,进行中/);
    assert.match(result.message, /棋盘未变化/);
    assert.equal(result.message.includes('H4 已经下好'), false);
    assert.equal(game.snapshot('d').revision, 1);
});

test('GM 拒绝落子后模型改发合法标签，按确认的棋步继续', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const answers = [
        'Game:五子棋,GameUser,落子,H4\n收到 H4。',
        'Game:五子棋,GameUser,落子,H3',
        'Game:五子棋,GameAI,落子,H4\n我下 H4，该你啦。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream() {
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H3。', options: {}, callbacks: {} });
    assert.equal(result.message, '我下 H4，该你啦。');
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[2][7], 'X');
    assert.equal(game.snapshot('d').board.split('/')[3][7], 'O');
});

test('其他成功命令不能代替 GM 确认被拒绝的落子', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const answers = [
        'Game:五子棋,GameUser,落子,H4\n收到 H4。',
        'Game:五子棋,GameAI,提议尺寸,11\nH3 已落子。',
        '我已经下好 H4。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream() {
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H3。', options: {}, callbacks: {} });
    assert.match(result.message, /未全部完成/);
    assert.equal(result.message.includes('H4'), false);
    assert.equal(game.snapshot('d').board.split('/')[2][7], '.');
});

test('轮到 AI 时自然语言自称落子不进入聊天或 TTS', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const answers = [
        'Game:五子棋,GameUser,落子,H3\n你下 H3。',
        '我下 H4 啦。',
        '白子已经落在 H4。',
        '轮到你下啦，我走 H4。'
    ];
    const spoken = [];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream() {
        return { success: true, message: answers.shift(), speech: '', history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H3。', options: {}, callbacks: { onSentence: text => spoken.push(text) } });
    assert.match(result.message, /AI 落子尚未得到 GM 确认/);
    assert.equal(result.message.includes('H4'), false);
    assert.equal(spoken.join('').includes('H4'), false);
    assert.equal(game.snapshot('d').revision, 2);
    assert.equal(game.snapshot('d').turn, 'AI');
});

test('协议行数量或语法错误仍拒绝，修正后可完成', async t => {
    const { game } = fixture(t);
    const inputs = [];
    const answers = [
        'Game:五子棋,GM,开局\nGame:五子棋,GameUser,落子,H3\n先开局再落子。',
        Array(9).fill('Game:目录,GameAI,列表').join('\n'),
        'Game:五子棋,GameUser,开局\nGame:五子棋,GameAI,落子,H8,多余',
        'Game:五子棋,GameUser,开局\n来玩吧。'
    ];
    const observedRevisions = [];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        observedRevisions.push(game.snapshot('d')?.revision || null);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我们来玩五子棋', options: {}, callbacks: {} });
    assert.equal(inputs.length, 4);
    assert.match(inputs[1], /GM,错误,调用行格式无效/);
    assert.match(inputs[2], /GM,错误,调用行格式无效/);
    assert.match(inputs[3], /GM,错误,调用行格式无效/);
    assert.deepEqual(observedRevisions, [null, null, null, null]);
    assert.match(result.message, /未全部完成/);
    assert.equal(result.message.includes('来玩吧'), false);
    assert.equal(game.snapshot('d').revision, 1);
});

test('有显示端的普通回复等完整结果后展示，行内 Game 文字不触发操作', async t => {
    const { game } = fixture(t);
    const chunks = [];
    const sentences = [];
    const fakeChat = { splitIntoSentences: value => [value], async chatStream(_prompt, _options, callbacks) {
        for (const message of ['今', '今天', '今天好']) {
            callbacks.onChunk?.(message.at(-1), message, '');
        }
        callbacks.onSentence?.('今天好', '今天好', '', '今天好', 'answer');
        return { success: true, message: '今天好', speech: '今天好', history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '天气', options: {}, callbacks: { onChunk: chunk => chunks.push(chunk),
            onSentence: sentence => sentences.push(sentence) } });
    assert.deepEqual(chunks, ['今天好']);
    assert.deepEqual(sentences, ['今天好']);
    assert.equal(result.message, '今天好');
    assert.equal(game.snapshot('d'), null);
    assert.equal(filterGameProtocolText('Ga'), '');
    assert.equal(filterGameProtocolText('Ga', true), 'Ga');
    assert.equal(filterGameProtocolText('你好 Game:五子棋,GameAI,落子,H8。'), '你好 Game:五子棋,GameAI,落子,H8。');
    assert.equal(filterGameProtocolText('Game:五子棋,GameAI,落子,H8\n你好'), '你好');
    assert.equal(filterGameProtocolText('你好 <Game:五子棋,GameAI,落子,H8>。'), '你好 。');
});

test('流式游戏标签先缓冲，执行后只显示 AI 的最终叙述', async t => {
    const { game } = fixture(t);
    const chunks = [];
    let round = 0;
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(_prompt, _options, callbacks) {
        round += 1;
        if (round === 1) {
            for (const message of ['G', 'Game:', 'Game:五子棋,GameUser,开局']) {
                callbacks.onChunk?.(message.at(-1), message, '');
            }
            return { success: true, message: 'Game:五子棋,GameUser,开局', history: [] };
        }
        return { success: true, message: '开始下棋吧。', history: [] };
    } };
    await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '开始', options: {}, callbacks: { onChunk: chunk => chunks.push(chunk) } });
    assert.deepEqual(chunks, ['开始下棋吧。']);
    assert.equal(round, 2);
    assert.equal(game.snapshot('d').size, 15);
});

test('叙述后的独立 Game 行照常执行，协议不传给字幕和语音', async t => {
    const { game } = fixture(t);
    const chunks = [];
    const sentences = [];
    const raw = '你好\nGame:五子棋,GameUser,开局';
    const fakeChat = { splitIntoSentences: value => [value], async chatStream(_prompt, _options, callbacks) {
        callbacks.onChunk?.('你好', '你好', '');
        callbacks.onChunk?.('Game:', '你好\nGame:', '');
        callbacks.onChunk?.('完', raw, '');
        callbacks.onSentence?.(raw, raw, '', raw, 'answer');
        return { success: true, message: raw, speech: raw, history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '打招呼', options: {}, callbacks: { onChunk: chunk => chunks.push(chunk),
            onSentence: sentence => sentences.push(sentence) } });
    assert.equal(result.message, '你好');
    assert.deepEqual(chunks.join('').trim(), '你好');
    assert.deepEqual(sentences, ['你好']);
    assert.equal(game.snapshot('d').revision, 1);
});

test('自然语言前后包围的独立 AI 落子行等完整回复与 GM 确认后展示', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局', '9'));
    game.apply('d', call('User', '落子', 'C3'), { source: 'displayClick' });
    const chunks = [];
    const sentences = [];
    const raw = '哎呀，又报错了！看来我的指令还是有问题。让我换个方式试试～\n'
        + 'Game:五子棋,GameAI,落子,H8\n这次我仔细检查过了，应该没问题了吧？等 GM 确认～';
    const fakeChat = { splitIntoSentences: value => [value], async chatStream(_input, _options, callbacks) {
        callbacks.onChunk?.('哎呀', '哎呀', '');
        callbacks.onChunk?.('Game:', raw, '');
        assert.deepEqual(chunks, []);
        return { success: true, message: raw, speech: raw, history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: '我下 C3', options: {}, callbacks: { onChunk: chunk => chunks.push(chunk),
            onSentence: sentence => sentences.push(sentence) } });
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[7][7], 'O');
    assert.equal(result.message, '哎呀，又报错了！看来我的指令还是有问题。让我换个方式试试～\n'
        + '这次我仔细检查过了，应该没问题了吧？等 GM 确认～');
    assert.deepEqual(chunks, [result.message]);
    assert.deepEqual(sentences, [result.message]);
    assert.equal(result.speech.includes('Game:'), false);
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
        schedule: (callback, delay) => { const timer = { callback, delay, cancelled: false }; timers.push(timer); return timer; },
        cancel: timer => { timer.cancelled = true; }
    });
    assert.equal(isLoopbackAddress('127.0.0.1'), true);
    assert.equal(isLoopbackAddress('192.168.1.2'), false);
    assert.equal(demo.start(owner, 'd', 15, { delayMs: 350, resultPauseMs: 1200 }).ok, true);
    assert.equal(events[0].type, 'gameSnapshot');
    assert.equal(events[0].demo, true);
    for (let index = 0; index < timers.length; index += 1) {
        assert.ok(index < 25, '演示定时器必须有界');
        timers[index].callback();
    }
    const snapshots = events.filter(message => message.type === 'gameSnapshot');
    const deltas = events.filter(message => message.type === 'gameDelta');
    assert.equal(snapshots.length, 2);
    assert.notEqual(snapshots[0].gameId, snapshots[1].gameId);
    assert.equal(deltas.length, 19);
    assert.deepEqual(deltas.slice(0, 2).map(message => message.actor), ['User', 'AI']);
    assert.deepEqual(deltas.filter(message => message.result !== '进行中').map(message => message.result),
        ['User胜', 'AI胜']);
    assert.equal(timers.filter(timer => timer.delay === 350).length, 19);
    assert.equal(timers.filter(timer => timer.delay === 1200).length, 1);
    assert.equal(game.snapshot('d').revision, original.revision);
    assert.equal(game.snapshot('d').board, original.board);
    demo.stopForControl(owner);
    assert.equal(events.at(-1).gameId, original.gameId);
    assert.equal(events.at(-1).type, 'gameSnapshot');
    assert.equal(demo.start(owner, 'd').ok, true);
    assert.equal(demo.cancelForRealUpdate('d'), true);
    assert.equal(timers.at(-1).cancelled, true);
    const emptyEvents = [];
    const emptyDemo = createGomokuDisplayDemoService({
        getSnapshot: () => null, isOnline: () => true,
        sendToDisplay: (_, message) => { emptyEvents.push(message); return true; }
    });
    assert.equal(emptyDemo.start(owner, 'empty').ok, true);
    emptyDemo.stopForControl(owner);
    assert.equal(emptyEvents.at(-1).type, 'gameDemoEnd');
});
