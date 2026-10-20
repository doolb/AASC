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
    return parseGameTag(`<Game:五子棋,${actor},${operation}${args.length ? ',' + args.join(',') : ''}>`);
}

test('位置参数标签严格解析且可从正文移除', () => {
    assert.deepEqual(call('User', '落子', 'H8').args, ['H8']);
    assert.equal(parseGameTag('<Game:目录,AI,列表>').operation, '列表');
    assert.equal(parseGameTag('<Game:五子棋,AI,规则>').operation, '规则');
    assert.equal(call('GM', '落子', 'H8'), null);
    assert.deepEqual(call('AI', '开局', '12').args, ['12']);
    assert.equal(parseGameTag('<Game:五子棋,AI,落子,H8,多余>'), null);
    assert.equal(extractGameTags('请看 <Game:五子棋,AI,落子,G8>')[0].call.actor, 'AI');
    assert.equal(stripGameTags('请看 <Game:五子棋,AI,落子,G8>'), '请看');
    assert.equal(formatGameProtocolSummary('AI', '<Game:五子棋,AI,落子,H4>'), 'AI · 落子 H4');
    assert.equal(formatGameProtocolSummary('GM', '<Game:五子棋,GM,落子,1234,3,AI,H4,User,进行中>'),
        'GM · #1234 第3手 AI H4');
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
    assert.match(moved.gm, /^<Game:五子棋,GM,落子,[a-f\d]{4},2,/);
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
    assert.deepEqual(gameTrace.map(entry => entry.kind), ['GM', 'User', 'GM', 'AI', 'GM']);
    assert.equal(gameTrace.some(entry => entry.text.includes('根据权威结果继续')), false);
    assert.match(systemPrompts[0], /<Game:目录,AI,列表>/);
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
    assert.match(prompts[0].systemPrompt, /<Game:目录,AI,列表>/);
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
        '<Game:目录,AI,列表>',
        '<Game:五子棋,AI,规则>',
        '<Game:五子棋,User,落子,H3>\n你下 H3。',
        '<Game:五子棋,AI,落子,H4>\n我下 H4。'
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
        '<Game:目录,AI,列表>\n我先看看可用游戏。',
        '<Game:五子棋,AI,规则>',
        '<Game:五子棋,User,开局>\n来玩吧，你先落黑子。'
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
    assert.ok(inputs[0].systemPrompt.indexOf('目录,AI,列表')
        < inputs[0].systemPrompt.indexOf('NowGame:无'));
    assert.ok(inputs[0].systemPrompt.indexOf('NowGame:无')
        < inputs[0].systemPrompt.indexOf('原角色设定'));
    assert.equal(game.snapshot('d').revision, 1);
    assert.deepEqual(trace.map(entry => entry.kind), ['AI', 'GM', 'AI', 'GM', 'User', 'GM']);
    assert.deepEqual(trace.slice(0, 3).map(entry => entry.summary),
        ['AI · 列表', 'GM · 当前支持：五子棋', 'AI · 规则']);
});

test('未声明游戏能力的显示端目录为空，不能读取五子棋规则', async t => {
    const { game } = fixture(t);
    const prompts = [];
    const answers = ['<Game:目录,AI,列表>', '<Game:五子棋,AI,规则>', '这个显示端暂不支持五子棋。'];
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
    const answers = ['<Game:五子棋,User,落子,H8>\n收到 H8。', '<Game:五子棋,AI,落子,G8>\n我下 G8。'];
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

test('同一回复的两行标签依次执行，末尾自然语言只播报一次', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const trace = [];
    const chunks = [];
    const sentences = [];
    const prompts = [];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input, options, callbacks) {
        prompts.push({ input, systemPrompt: options.systemPrompt });
        const message = '<Game:五子棋,User,落子,H3>\n<Game:五子棋,AI,落子,H4>\n你下 H3，我下 H4，轮到你啦。';
        callbacks.onChunk?.(message, message, '');
        return { success: true, message, history: [] };
    } };
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H3。', options: { systemPrompt: '原角色设定' }, callbacks: {
            onChunk: chunk => chunks.push(chunk), onSentence: sentence => sentences.push(sentence),
            onGameProtocol: entry => trace.push(entry)
        } });
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].systemPrompt, /^本地游戏标签：/);
    assert.ok(prompts[0].systemPrompt.indexOf('目录,AI,列表') < prompts[0].systemPrompt.indexOf('原角色设定'));
    assert.equal(result.message, '你下 H3，我下 H4，轮到你啦。');
    assert.deepEqual(chunks, [result.message]);
    assert.deepEqual(sentences, [result.message]);
    assert.deepEqual(trace.slice(1).map(entry => entry.kind), ['User', 'GM', 'AI', 'GM']);
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[2][7], 'X');
    assert.equal(game.snapshot('d').board.split('/')[3][7], 'O');
});

test('批次第二条失败时停止后续标签，回送已有 GM 并丢弃预写叙述', async t => {
    const { game } = fixture(t);
    game.apply('d', call('User', '开局'));
    const inputs = [];
    const answers = [
        '<Game:五子棋,User,落子,H3>\n<Game:五子棋,AI,落子,H3>\n<Game:五子棋,User,落子,H2>\n你下 H3，我下 H3。',
        '<Game:五子棋,AI,落子,H4>\n我改下 H4。'
    ];
    const fakeChat = { splitIntoSentences: text => [text], async chatStream(input) {
        inputs.push(input);
        return { success: true, message: answers.shift(), history: [] };
    } };
    const trace = [];
    const result = await runGameAwareChat({ chat: fakeChat, gameService: game, displayId: 'd',
        content: 'H3。', options: {}, callbacks: { onGameProtocol: entry => trace.push(entry) } });
    assert.equal(inputs.length, 2);
    assert.match(inputs[1], /GM,落子,.*User,H3,AI,进行中/);
    assert.match(inputs[1], /GM,错误,位置已占用/);
    assert.equal(result.message, '我改下 H4。');
    assert.deepEqual(trace.slice(1).map(entry => entry.kind), ['User', 'GM', 'AI', 'GM', 'AI', 'GM']);
    assert.equal(game.snapshot('d').revision, 3);
    assert.equal(game.snapshot('d').board.split('/')[1][7], '.');
});

test('同一行或叙述间夹入多个标签时整批拒绝，单标签同一行叙述仍兼容', async t => {
    const { game } = fixture(t);
    const inputs = [];
    const answers = [
        '<Game:五子棋,User,开局><Game:五子棋,User,落子,H3>先开局再落子。',
        Array(9).fill('<Game:目录,AI,列表>').join('\n'),
        '<Game:五子棋,User,开局>\n<Game:五子棋,AI,落子,H8,多余>',
        '<Game:五子棋,User,开局>来玩吧。'
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
    assert.match(inputs[1], /GM,错误,标签格式无效/);
    assert.match(inputs[2], /GM,错误,标签格式无效/);
    assert.match(inputs[3], /GM,错误,标签格式无效/);
    assert.deepEqual(observedRevisions, [null, null, null, null]);
    assert.equal(result.message, '来玩吧。');
    assert.equal(game.snapshot('d').revision, 1);
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
    assert.equal(round, 2);
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
