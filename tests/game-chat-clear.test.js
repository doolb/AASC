'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGomokuGameService, parseGameTag } = require('../src/apps/server/modules/game/gomoku-game-service');
const { runGameAwareChat, buildGameSystemPrompt } = require('../src/apps/server/modules/game/game-chat-bridge');
const { createChatHistoryClearService } = require('../src/apps/server/modules/chat/chat-history-clear-service');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-game-clear-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const events = [];
    const options = { filePath: path.join(directory, 'games.json'), onUpdate: (id, message) => events.push({id,message}) };
    const game = createGomokuGameService(options);
    const open = (displayId, chatScope) => game.apply(displayId,
        parseGameTag('Game:五子棋,GameUser,开局,9'), { chatScope });
    return { game, open, events, options, directory };
}

const privateScope = { mode: 'private', target: '小爱', sessionId: 'first' };

test('清空仅移除关联会话和目标显示端棋局，重启后NowGame为无', t => {
    const { game, open, events, options } = fixture(t);
    open('selected', privateScope);
    open('other-display', privateScope);
    open('other-session', { ...privateScope, sessionId:'second' });
    const removed = game.clearForChat(privateScope, { displayIds:['selected'] });
    assert.deepEqual(removed, ['selected']);
    assert.equal(game.snapshot('selected'), null);
    assert.ok(game.snapshot('other-display')); assert.ok(game.snapshot('other-session'));
    assert.equal(events.at(-1).message.type, 'gameCleared');
    const restored = createGomokuGameService(options);
    assert.equal(restored.snapshot('selected'), null);
    const prompt = buildGameSystemPrompt(restored.snapshot('selected'), '角色设定');
    assert.match(prompt, /NowGame:无/); assert.doesNotMatch(prompt, /NowGame:五子棋|LastGame:|五子棋规则:/);
    assert.ok(restored.snapshot('other-display'));
});

test('无归属旧棋局仅在明确选中该显示端时清除', t => {
    const { game, open } = fixture(t);
    open('legacy'); open('legacy-other');
    assert.deepEqual(game.clearForChat(privateScope), []);
    assert.deepEqual(game.clearForChat(privateScope, { displayIds:['legacy'] }), ['legacy']);
    assert.ok(game.snapshot('legacy-other'));
});

test('错误会话清空不取消其他模型；临时清空按会话匹配', t => {
    const { game, open } = fixture(t);
    const old = { mode:'temporary', sessionId:'old' };
    const current = { mode:'temporary', sessionId:'current' };
    open('old', old); open('current', current);
    const request = game.beginChat('old', old);
    game.clearForChat(current);
    assert.equal(request.signal.aborted, false); assert.ok(game.snapshot('old'));
    assert.equal(game.snapshot('current'), null);
    request.release();
});

test('棋局持久失败回滚内存、不取消请求、不提前清空历史', t => {
    const { game, open, options } = fixture(t);
    open('display', privateScope); const request = game.beginChat('display', privateScope);
    // 把存储目录暂时移走并用普通文件占位，模拟真实不可写路径。
    const moved = path.dirname(options.filePath) + '-moved';
    fs.renameSync(path.dirname(options.filePath), moved);
    fs.writeFileSync(path.dirname(options.filePath), 'blocked');
    let clears = 0;
    const service = createChatHistoryClearService({ gameService:game,
        chat:{validateHistoryScope:s=>s, clearHistory:()=>{clears++;return []}} });
    try {
        assert.throws(() => service.clear({...privateScope,displayId:'display'}));
        assert.equal(clears,0); assert.ok(game.snapshot('display')); assert.equal(request.signal.aborted,false);
    } finally {
        fs.unlinkSync(path.dirname(options.filePath));fs.renameSync(moved,path.dirname(options.filePath));request.release();
    }
});

test('共用清空入口先校验范围与显示端，再清棋局及历史', t => {
    const { game, open } = fixture(t); open('display', privateScope);
    let clears=0;
    const chat={ validateHistoryScope(input){if(!input.mode)throw new Error('缺少范围');return privateScope},
        clearHistory(scope){assert.deepEqual(scope,privateScope);clears++;return ['remaining']} };
    const service=createChatHistoryClearService({chat,gameService:game});
    assert.throws(()=>service.clear({displayId:'display'}),/缺少范围/);
    assert.throws(()=>service.clear({...privateScope,displayIds:'all'}),/显示端/);
    assert.ok(game.snapshot('display'));
    assert.deepEqual(service.clear({...privateScope,displayId:'display'}),['remaining']);
    assert.equal(game.snapshot('display'),null);assert.equal(clears,1);
});

for (const existing of [false, true]) {
    test(`清空使在途模型失效，迟到${existing ? '落子' : '开局'}不执行也不保存`, async t => {
        const {game,open}=fixture(t);
        if(existing)open('display',privateScope);
        let release;const saved=[];const spoken=[];const errors=[];
        const chat={splitIntoSentences:t=>[t],async chatStream(input,options,callbacks){
            return await new Promise(resolve=>{release=()=>{
                const message=existing?'Game:五子棋,GameUser,落子,C3':'Game:五子棋,GameUser,开局,9';
                callbacks.onChunk?.(message,message,'');resolve({success:true,message:message+'\n已经下好了',history:[]});
            }});
        }};
        const job=runGameAwareChat({chat,gameService:game,displayId:'display',content:'下棋',options:privateScope,
            callbacks:{onComplete:m=>saved.push(m),onSentence:m=>spoken.push(m),onError:e=>errors.push(e)}});
        game.clearForChat(privateScope,{displayIds:['display']});release();
        assert.equal((await job).cancelled,true);assert.equal(game.snapshot('display'),null);
        assert.deepEqual(saved,[]);assert.deepEqual(spoken,[]);assert.equal(errors.length,1);
    });
}

test('临时聊天清空使用服务端所属显示端，控制端切换选择不误清其他端', () => {
    const vm=require('node:vm');
    const source=fs.readFileSync(path.resolve(__dirname,'../src/apps/server/boot/server-app.js'),'utf8');
    const start=source.indexOf('function clearTemporaryConversation(');
    const end=source.indexOf('\nfunction appendTemporaryConversationMessage(',start);
    const cleared=[];const actions=[];
    const context={temporaryConversation:{id:'current-session',displayId:'actual-display',messages:['old']},
        clearTemporaryChatHistory:options=>cleared.push(options),broadcastTemporaryConversation:action=>actions.push(action)};
    vm.runInNewContext(source.slice(start,end),context);
    context.clearTemporaryConversation({displayIds:['another-display']});
    assert.deepEqual(Array.from(cleared[0].displayIds),['actual-display']);
    assert.equal(cleared[0].sessionId,'current-session');assert.equal(context.temporaryConversation.messages.length,0);
    assert.deepEqual(actions,['clear']);
    context.clearTemporaryChatHistory=()=>{throw new Error('保存失败')};
    context.temporaryConversation.messages=['preserve'];
    assert.throws(()=>context.clearTemporaryConversation({}),/保存失败/);
    assert.equal(context.temporaryConversation.messages[0],'preserve');
});

test('清空棋局释放服务端旧棋步锁，其他显示端请求锁保留', t => {
    const vm=require('node:vm');
    const {directory}=fixture(t);
    const source=fs.readFileSync(path.resolve(__dirname,'../src/apps/server/boot/server-app.js'),'utf8');
    const start=source.indexOf('const gomokuGame = createGomokuGameService(');
    const end=source.indexOf('const chatHistoryClear =',start);
    const pendingGameMoves=new Map([['selected',{requestId:'old'}],['other',{requestId:'keep'}]]);
    const messages=[];let game;
    vm.runInNewContext(source.slice(start,end),{path,USER_CONFIG_DIR:directory,pendingGameMoves,
        createGomokuGameService:options=>{game=createGomokuGameService(options);return game},
        gomokuDisplayDemo:{cancelForRealUpdate:()=>false},sendToDisplay:(id,message)=>messages.push({id,message})});
    game.apply('selected',parseGameTag('Game:五子棋,GameUser,开局,9'),{chatScope:privateScope});
    game.clearForChat(privateScope,{displayIds:['selected']});
    assert.equal(pendingGameMoves.has('selected'),false);assert.equal(pendingGameMoves.has('other'),true);
    assert.equal(messages.at(-1).message.type,'gameCleared');
});
