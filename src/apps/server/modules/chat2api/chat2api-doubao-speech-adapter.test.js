'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fixture } = require('../../../../../tests/helpers/ogg-opus-fixture');
const { validateWav, wrapPcm } = require('../../../../external/tts/tts-wav');
const { createDoubaoSpeechQueue } = require('./chat2api-doubao-speech-queue');
const { createDoubaoSpeechAdapter } = require('./chat2api-doubao-speech-adapter');

const cookie = 'sessionid=demo_session_12345678; passport_csrf_token=demo_csrf_12345678';
const statusField = status => {
    const bytes=[40];let value=status>>>0;
    do {const byte=value&127;value>>>=7;bytes.push(byte|(value?128:0));} while(value);
    return Buffer.from(bytes);
};
const field = (id, text) => { const bytes=Buffer.isBuffer(text)?text:Buffer.from(text); const n=bytes.length; const length=[]; let value=n; do { const byte=value&127;value>>>=7;length.push(byte|(value?128:0)); }while(value); return Buffer.from([(id<<3)|2,...length,...bytes]); };
function event(name, options = {}) { return Buffer.concat([field(1, options.task || 'task'),field(3,'VoiceGenie'),field(4,name),
    statusField(options.status ?? 20000000),
    ...(options.data ? [field(8,options.data)] : []), ...(options.session ? [field(10,options.session)] : [])]); }
function setup(options = {}) {
    const sockets = [];
    const adapter = createDoubaoSpeechAdapter({ createSocket: (url, config) => {
        const socket = new EventEmitter(); socket.url=url;socket.config=config;socket.sent=[];socket.destroyed=false;
        socket.send=bytes=>socket.sent.push(bytes);socket.terminate=()=>{socket.destroyed=true}; sockets.push(socket); return socket;
    }, ...options });
    const generate = (context = {}) => adapter.generate({ text:'本地模拟短文', voice: context.voice }, cookie,
        { accountId:'demo', deadline:Date.now()+10000, ...context });
    return { sockets, generate };
}
function start(socket) { socket.emit('open');socket.emit('message',event('TaskStarted'),true);socket.emit('message',event('SessionStarted',{session:'session'}),true); }

test('默认只允许三条同账号上游连接，第四条在完成或失败释放后进入', async () => {
    const { generate, sockets } = setup();
    const tasks = [1, 2, 3, 4].map(() => generate());
    const rejected = tasks.map(task => assert.rejects(task, e => e.code === 'doubao_speech_incomplete'));
    assert.equal(sockets.length, 3);
    sockets[0].emit('close'); await rejected[0];
    assert.equal(sockets.length, 4);
    assert.equal(sockets.filter(socket => !socket.destroyed).length, 3);
    for (const socket of sockets.slice(1)) socket.emit('close');
    await Promise.all(rejected);
});

test('三条上游同轮完成，正式两Worker解码池排队后全部返回完整WAV', async () => {
    const { generate, sockets } = setup();
    const tasks = [1, 2, 3].map(() => generate());
    assert.equal(sockets.length, 3);
    for (const socket of sockets) { start(socket); sentence(socket); socket.emit('message', event('TTSEnded'), true); }
    const audio = await Promise.all(tasks);
    assert.ok(audio.every(wav => validateWav(wav).samples.length === 1920));
    assert.ok(sockets.every(socket => socket.destroyed));
});

test('本地解码等待容量满只报队列繁忙，不被当作账号合成失败或重试', async () => {
    const { generate, sockets } = setup({ decodeAudio: async () => {
        throw Object.assign(new Error('本地队列已满'), { code: 'TTS_OPUS_CAPACITY' });
    } });
    const task = generate();
    const rejected = assert.rejects(task, e => e.code === 'doubao_speech_busy' && e.speechQueueFailure === true);
    start(sockets[0]); sentence(sockets[0]); sockets[0].emit('message', event('TTSEnded'), true);
    await rejected; assert.equal(sockets.length, 1); assert.equal(sockets[0].destroyed, true);
});

test('非默认目录音色经过适配器进入真实编码的StartSession', async () => {
    const voice = 'zh_male_cixingjunyu_uranus_bigtts';
    const { generate, sockets } = setup();
    const pending = generate({ voice });
    start(sockets[0]);
    sentence(sockets[0]);
    sockets[0].emit('message', event('TTSEnded'), true);
    await pending;
    assert.ok(sockets[0].sent.some(bytes => bytes.toString('utf8').includes(voice)));
});
function sentence(socket, audio = fixture()) { socket.emit('message',event('TTSSentenceStart'),true);socket.emit('message',event('TTSResponse',{data:audio.subarray(0,10)}),true);socket.emit('message',event('TTSResponse',{data:audio.subarray(10)}),true);socket.emit('message',event('TTSSentenceEnd'),true); }

test('Frontier模拟分片/多句完整结束后真实解码为单一WAV，清理连接且不重试', async () => {
    const { generate,sockets }=setup();const task=generate();const socket=sockets[0];start(socket);sentence(socket);sentence(socket);
    socket.emit('message',event('TTSEnded'),true);const result=await task;
    assert.equal(validateWav(result).samples.length,3840);assert.equal(socket.destroyed,true);assert.equal(sockets.length,1);
    assert.equal(socket.listenerCount('message'),0);assert.equal(socket.sent.length,4);
    assert.equal(new URL(socket.url).hostname,'frontier-audio-web-ws.doubao.com');assert.equal(socket.config.headers.Cookie,cookie);
});
test('旧成功码0与实际20000000均完成音频，业务失败保留固定分类并释放资源', async () => {
    for(const status of [0,20000000,401,403,429,20000001,-1]) {
        const {generate,sockets}=setup();const task=generate();const socket=sockets[0];socket.emit('open');
        if(status!==0&&status!==20000000) {
            const expected=({401:'doubao_speech_auth',403:'doubao_speech_risk',429:'doubao_speech_rate'})[status]||'doubao_speech_upstream';
            const rejection=assert.rejects(task,e=>e.code===expected&&!e.message.includes(cookie));
            socket.emit('message',event('TaskStarted',{status}),true);await rejection;
            assert.equal(socket.sent.length,1);
        } else {
            socket.emit('message',event('TaskStarted',{status}),true);
            socket.emit('message',event('SessionStarted',{status,session:'session'}),true);
            for(const name of ['TTSSentenceStart','TTSResponse','TTSSentenceEnd','TTSEnded'])
                socket.emit('message',event(name,{status,...(name==='TTSResponse'?{data:fixture()}: {})}),true);
            assert.ok(validateWav(await task).samples.length>0);
        }
        socket.emit('message',event('TaskStarted'),true);
        assert.equal(socket.destroyed,true);assert.equal(sockets.length,1);assert.equal(socket.listenerCount('message'),0);
    }
});
test('取消/超时与关闭缺TTSEnded固定拒绝，销毁当前socket，不接受迟到帧', async () => {
    for (const reason of ['abort','timeout','close']) {
        const {generate,sockets}=setup();const control=new AbortController();
        const task=generate({signal:control.signal,deadline:Date.now()+(reason==='timeout'?20:1000)});
        const rejection=assert.rejects(task,e=>['doubao_speech_cancelled','doubao_speech_timeout','doubao_speech_incomplete'].includes(e.code));
        const socket=sockets[0];start(socket);
        if(reason==='abort')control.abort();if(reason==='close')socket.emit('close');
        await rejection;assert.equal(socket.destroyed,true);assert.equal(sockets.length,1);
    }
});
test('错任务/消息顺序/无完整句、空音频和不完整Ogg拒绝', async () => {
    for(const scenario of ['wrong','order','empty','partial']) {
        const {generate,sockets}=setup();const task=generate();const rejection=assert.rejects(task,e=>/^doubao_speech_/u.test(e.code));
        const socket=sockets[0];start(socket);
        if(scenario==='wrong')socket.emit('message',event('TTSSentenceStart',{task:'other'}),true);
        if(scenario==='order')socket.emit('message',event('TTSResponse',{data:fixture()}),true);
        if(scenario==='empty')socket.emit('message',event('TTSEnded'),true);
        if(scenario==='partial'){sentence(socket,fixture().subarray(0,-1));socket.emit('message',event('TTSEnded'),true)}
        await rejection;assert.equal(socket.destroyed,true);
    }
});
test('握手401/403/429和原始异常只回固定代码，不输出凭据或重试', async () => {
    for(const status of [401,403,429]){
        const {generate,sockets}=setup();const task=generate();const rejection=assert.rejects(task,e=>!e.message.includes('private')&&e.statusCode===status);
        const response={statusCode:status,destroy(){this.destroyed=true}};const req={destroy(){this.destroyed=true}};
        sockets[0].emit('unexpected-response',req,response);await rejection;assert.ok(req.destroyed&&response.destroyed);assert.equal(sockets.length,1);
    }
});
test('不同批次同账号等待，活动取消释放执行权；预取消不创建连接', async () => {
    const {generate,sockets}=setup({queue:createDoubaoSpeechQueue({concurrency:1})});const control=new AbortController();const first=generate({signal:control.signal});const rejected=assert.rejects(first);
    const second=generate();const rejected2=assert.rejects(second);assert.equal(sockets.length,1);
    control.abort();await rejected;assert.equal(sockets.length,2);sockets[1].emit('close');await rejected2;
    await assert.rejects(generate({signal:control.signal}),e=>e.code==='doubao_speech_cancelled');assert.equal(sockets.length,2);
});
test('完整音频到达立即交接，解码成功/失败/取消均不释放下一条执行权，不同账号并行', async () => {
  for(const scenario of ['success','failure','cancel']) {
    let finishDecode;
    const control=new AbortController();
    const {generate,sockets}=setup({queue:createDoubaoSpeechQueue({concurrency:1}),decodeAudio:()=>new Promise((resolve,reject)=>{finishDecode=()=>{
        if(scenario==='failure')reject(Error('local decoder failure'));
        else resolve(wrapPcm(Buffer.from([1,0]),24000));
    }})});
    const first=generate({signal:control.signal}); const second=generate(); const third=generate();
    const firstResult=scenario==='success'?first:assert.rejects(first,e=>e.code===(scenario==='cancel'?'doubao_speech_cancelled':'doubao_speech_audio'));
    const rejectSecond=assert.rejects(second,e=>e.code==='doubao_speech_incomplete');
    const rejectThird=assert.rejects(third,e=>e.code==='doubao_speech_incomplete');
    const other=generate({accountId:'other'});const rejectOther=assert.rejects(other);
    assert.equal(sockets.length,2);
    start(sockets[0]);sentence(sockets[0]);sockets[0].emit('message',event('TTSEnded'),true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(typeof finishDecode,'function');assert.equal(sockets.length,3);
    assert.equal(sockets[0].destroyed,true);
    if(scenario==='cancel')control.abort();
    finishDecode();const audio=await firstResult;
    if(scenario==='success')assert.ok(validateWav(audio).samples.length);
    assert.equal(sockets.length,3);sockets[2].emit('close');await rejectSecond;
    assert.equal(sockets.length,4);sockets[3].emit('close');await rejectThird;
    sockets[1].emit('close');await rejectOther;
  }
});
test('排队取消/到期没有连接，坏Cookie不占执行权', async () => {
    const {generate,sockets}=setup({queue:createDoubaoSpeechQueue({concurrency:1})});const first=generate();const rejectFirst=assert.rejects(first);
    const controller=new AbortController();const waiting=generate({signal:controller.signal});
    const rejected=assert.rejects(waiting,e=>e.code==='doubao_speech_cancelled'&&e.speechQueueFailure);controller.abort();await rejected;
    await assert.rejects(generate({deadline:Date.now()+20}),e=>e.code==='doubao_speech_timeout'&&e.speechQueueFailure);
    assert.equal(sockets.length,1);sockets[0].emit('close');await rejectFirst;
    let calls=0;const adapter=createDoubaoSpeechAdapter({createSocket:()=>{calls++;throw Error('unexpected')}});
    await assert.rejects(adapter.generate({text:'x'},'bad',{accountId:'one'}),e=>e.code==='doubao_speech_credentials');
    assert.equal(calls,0);
});
module.exports = { event };

test('每句合规但累计超过120秒拒绝，恰好120秒允许', async () => {
    for (const seconds of [60, 61]) {
        const {generate,sockets}=setup({decodeAudio:async()=>wrapPcm(Buffer.alloc(seconds*24000*2),24000)});
        const task=generate();
        const result=seconds===61?assert.rejects(task,e=>e.code==='doubao_speech_limit'):task;
        start(sockets[0]);sentence(sockets[0]);sentence(sockets[0]);sockets[0].emit('message',event('TTSEnded'),true);
        const audio=await result;
        if(seconds===60)assert.equal(validateWav(audio).samples.length,120*24000*2);
        assert.equal(sockets[0].destroyed,true);
    }
});

test('同一上游分句的两个完整Ogg流均解码合并，坏第二流不返回部分音频', async () => {
    const first = fixture({ packets: 2, preSkip: 120, endTrim: 240 });
    const second = fixture({ packets: 3, preSkip: 80, endTrim: 160 });
    const { generate, sockets } = setup();
    const pending = generate(); start(sockets[0]);
    sentence(sockets[0], Buffer.concat([first, second]));
    sockets[0].emit('message', event('TTSEnded'), true);
    assert.equal(validateWav(await pending).samples.length, 8400);
    let decoded = 0;
    const broken = setup({ decodeAudio: async () => { decoded++; return wrapPcm(Buffer.from([1, 0])); } });
    const failed = broken.generate(); start(broken.sockets[0]);
    sentence(broken.sockets[0], Buffer.concat([first, second.subarray(0, -1)]));
    broken.sockets[0].emit('message', event('TTSEnded'), true);
    await assert.rejects(failed, error => error.code === 'doubao_speech_audio');
    assert.equal(decoded, 0, '所有容器先完整校验，不先解码或返回部分音频');
});
