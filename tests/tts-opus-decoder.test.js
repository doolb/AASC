'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fixture, pages, page, editPage, splitTagsFixture } = require('./helpers/ogg-opus-fixture');
const { validateWav, wrapPcm } = require('../src/external/tts/tts-wav');
const { decodeOggOpusToWav, createOpusWavDecoder } = require('../src/external/tts/tts-opus-decoder');
const { checkDecoded } = require('../src/external/tts/tts-opus-decode-worker');

test('Offline代码与依赖分目录时worker仍通过NODE_PATH加载真实WASM', async () => {
    const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
    const {promisify}=require('node:util');const execFile=promisify(require('node:child_process').execFile);
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-opus-split-runtime-'));
    try {
        const code=path.join(root,'code');await fs.mkdir(code);
        for(const name of ['tts-opus-decoder.js','tts-opus-decode-worker.js','tts-ogg.js','tts-wav.js'])
            await fs.copyFile(path.join(__dirname,'../src/external/tts',name),path.join(code,name));
        const input=path.join(root,'input.ogg');await fs.writeFile(input,fixture({packets:2}));
        const script="const fs=require('node:fs');require(process.argv[1]).decodeOggOpusToWav(fs.readFileSync(process.argv[2])).then(b=>console.log(b.length)).catch(e=>{console.error(e.code);process.exitCode=1;});";
        const result=await execFile(process.execPath,['-e',script,path.join(code,'tts-opus-decoder.js'),input],
            {cwd:root,env:{...process.env,NODE_PATH:path.resolve(__dirname,'../node_modules')},timeout:15000});
        assert.equal(Number(result.stdout.trim()),3840+44);
    } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('头部暂不输出PCM时允许零声道空结果；解码错误及NaN不得因部分PCM被忽略', () => {
    assert.equal(checkDecoded({ errors: [], channelData: [], samplesDecoded: 0, sampleRate: 48000 }).length, 0);
    for (const patch of [{ errors: [{ message: 'private' }] }, { channelData: [Float32Array.of(NaN)] },
        { channelData: [Float32Array.of(0), Float32Array.of(0)] }, { samplesDecoded: 3 }, { sampleRate: 0 }]) {
        assert.throws(() => checkDecoded({ errors: [], channelData: [Float32Array.of(0)], samplesDecoded: 1, sampleRate: 48000, ...patch }),
            error => error.code === 'TTS_OPUS_INVALID' && !error.message.includes('private'));
    }
});

test('单次Float32输出超过32MiB时在扫描/复制PCM之前拒绝', () => {
    const pcm = new Float32Array(32 * 1024 * 1024 / 4 + 1);
    assert.throws(() => checkDecoded({ errors: [], channelData: [pcm], samplesDecoded: pcm.length, sampleRate: 48000 }),
        error => error.code === 'TTS_OPUS_LIMIT');
});

test('真实WASM把本地静音Ogg解码为单声道WAV，使用实际48kHz而非请求24kHz', async () => {
    const audio = await decodeOggOpusToWav(fixture({ packets: 2 }), { deadline: Date.now() + 10000 });
    const { format, samples } = validateWav(audio);
    assert.equal(format.readUInt16LE(2), 1); assert.equal(format.readUInt32LE(4), 48000);
    assert.equal(samples.length, 1920 * 2); assert.ok(samples.every(value => value === 0));
});

test('真实WASM只裁剪一次pre-skip与EOS末尾，实际样本数符合granule', async () => {
    const audio = await decodeOggOpusToWav(fixture({ packets: 2, preSkip: 120, endTrim: 240 }));
    assert.equal(validateWav(audio).samples.length, 1560 * 2);
});

function workers(options = {}) {
    const created = [];
    const decode = createOpusWavDecoder({ ...options, createWorker: () => {
        const worker = new EventEmitter(); worker.terminated = 0;
        worker.postMessage = value => { worker.input = value.audio; };
        worker.terminate = async () => { worker.terminated++; };
        created.push(worker); return worker;
    } });
    return { created, decode };
}

// 对应.src/framework/tts-provider-configuration.md：只给正式共享解码池启用有界等待，保持最多两个Worker。
test('有界等待不创建第三Worker，FIFO准入且排队输入副本不被调用者改写', async () => {
    const { decode, created } = workers({ maxWaiting: 1 });
    const first = decode(fixture()), second = decode(fixture());
    const input = fixture(); const original = Buffer.from(input);
    const third = decode(input); input.fill(0);
    await assert.rejects(decode(fixture()), e => e.code === 'TTS_OPUS_CAPACITY');
    assert.equal(created.length, 2);
    created[0].emit('message', { audio: wrapPcm(Buffer.alloc(1920), 48000) }); await first;
    assert.equal(created.length, 3); assert.deepEqual(Buffer.from(created[2].input), original);
    created[1].emit('message', { audio: wrapPcm(Buffer.alloc(1920), 48000) });
    created[2].emit('message', { audio: wrapPcm(Buffer.alloc(1920), 48000) });
    await Promise.all([second, third]);
});

test('排队取消与超时释放字节/数量额度，取消项不会迟到创建Worker', async () => {
    const bytes = fixture().length;
    const { decode, created } = workers({ maxWaiting: 2, maxWaitingBytes: bytes });
    const active = new AbortController();
    const first = decode(fixture(), { signal: active.signal }), second = decode(fixture(), { signal: active.signal });
    const activeRejected = Promise.all([assert.rejects(first), assert.rejects(second)]);
    const control = new AbortController();
    const waiting = decode(fixture(), { signal: control.signal });
    const rejected = assert.rejects(waiting, e => e.code === 'TTS_OPUS_CANCELLED');
    await assert.rejects(decode(fixture()), e => e.code === 'TTS_OPUS_CAPACITY');
    control.abort(); await rejected;
    await assert.rejects(decode(fixture(), { deadline: Date.now() + 30 }), e => e.code === 'TTS_OPUS_TIMEOUT');
    assert.equal(created.length, 2);
    const next = decode(fixture());
    active.abort(); await activeRejected;
    assert.equal(created.length, 3);
    created[2].emit('message', { audio: wrapPcm(Buffer.alloc(1920), 48000) }); await next;
    assert.equal(require('node:events').getEventListeners(control.signal, 'abort').length, 0);
});

test('正式共享解码器承接同时三条真实WASM解码，不返回容量拒绝', async () => {
    const results = await Promise.all([1, 2, 3].map(() => decodeOggOpusToWav(fixture(), { deadline: Date.now() + 15000 })));
    assert.equal(results.length, 3);
    for (const audio of results) assert.equal(validateWav(audio).samples.length, 1920);
});

test('取消及过期deadline在创建worker前拒绝；非法容器不启动解码', async () => {
    const { decode, created } = workers(); const control = new AbortController(); control.abort();
    await assert.rejects(decode(fixture(), { signal: control.signal }), e => e.code === 'TTS_OPUS_CANCELLED');
    await assert.rejects(decode(fixture(), { deadline: Date.now() - 1 }), e => e.code === 'TTS_OPUS_TIMEOUT');
    await assert.rejects(decode(Buffer.from('OggS')), e => e.code === 'TTS_OGG_INVALID');
    assert.equal(created.length, 0);
});

test('进行中取消及deadline终止worker，拒绝迟到音频且清理监听', async () => {
    const { decode, created } = workers(); const control = new AbortController();
    const task = decode(fixture(), { signal: control.signal }); const rejection = assert.rejects(task, e => e.code === 'TTS_OPUS_CANCELLED');
    control.abort(); created[0].emit('message', { audio: wrapPcm(Buffer.alloc(1920)) }); await rejection;
    assert.equal(created[0].terminated, 1); assert.equal(created[0].listenerCount('message'), 0);
    await assert.rejects(decode(fixture(), { deadline: Date.now() + 20 }), e => e.code === 'TTS_OPUS_TIMEOUT');
    assert.equal(created[1].terminated, 1);
});

test('worker解码错误、崩溃、迟到消息和伪WAV只返回固定脱敏错误', async () => {
    for (const outcome of ['message', 'error', 'exit']) {
        const { decode, created } = workers(); const task = decode(fixture());
        const rejection = assert.rejects(task, e => e.code === 'TTS_OPUS_INVALID' && !e.message.includes('private'));
        const value = outcome === 'message' ? { code: 'private-cookie', audio: Buffer.from('private') }
            : outcome === 'error' ? new Error('private-cookie') : 1;
        created[0].emit(outcome, value); await rejection;
        assert.equal(created[0].terminated, 1);
    }
});

test('解码输出样本数必须与Ogg结束granule一致', async () => {
    const { decode, created } = workers(); const task = decode(fixture());
    const rejection = assert.rejects(task, e => e.code === 'TTS_OPUS_INVALID');
    created[0].emit('message', { audio: wrapPcm(Buffer.alloc(2), 48000) }); await rejection;
});

test('最多两个worker，满额立即拒绝且取消后释放容量', async () => {
    const { decode, created } = workers(); const control = new AbortController();
    const first = decode(fixture(), { signal: control.signal }); const second = decode(fixture(), { signal: control.signal });
    const rejected = Promise.all([assert.rejects(first), assert.rejects(second)]);
    await assert.rejects(decode(fixture()), e => e.code === 'TTS_OPUS_CAPACITY');
    assert.equal(created.length, 2); control.abort(); await rejected;
    const third = decode(fixture()); const rejection = assert.rejects(third); created[2].emit('exit', 1); await rejection;
});

test('WAV已到达但worker尚未释放时取消仍拒绝结果', async () => {
    let worker, release;
    const decode = createOpusWavDecoder({ createWorker: () => {
        worker = new EventEmitter(); worker.postMessage = () => {};
        worker.terminate = () => new Promise(resolve => { release = resolve; }); return worker;
    } });
    const control = new AbortController(); const task = decode(fixture(), { signal: control.signal });
    const rejection = assert.rejects(task, e => e.code === 'TTS_OPUS_CANCELLED');
    worker.emit('message', { audio: wrapPcm(Buffer.alloc(1920), 48000) });
    control.abort(); release(); await rejection;
});

test('CRC合法的高位伪OpusTags不能被真实解码库宽松接受', async () => {
    await assert.rejects(decodeOggOpusToWav(editPage(fixture(), 1, b => { b[28] |= 0x80; })), e => e.code === 'TTS_OGG_INVALID');
});

test('真实WASM支持完整Tags跨页包及音频包continued，不依赖原页序号跳过标签', async () => {
    assert.equal(validateWav(await decodeOggOpusToWav(splitTagsFixture())).samples.length, 1920);
    // 单帧20ms静音加251字节合法Opus padding，使256字节音频包跨255字节lacing。
    const packet = Buffer.concat([Buffer.from([0xfb, 0x41, 251, 0xff, 0xfe]), Buffer.alloc(251)]);
    const bytes = Buffer.concat([...pages(fixture()).slice(0, 2),
        page({ sequence: 2, granule: -1n, body: packet.subarray(0, 255), lacing: [255] }),
        page({ sequence: 3, flags: 5, granule: 960n, body: packet.subarray(255) })]);
    assert.equal(validateWav(await decodeOggOpusToWav(bytes)).samples.length, 1920);
});

test('真实非静音Opus包按signed Q8头部增益放大/衰减，再限幅转16位PCM', async () => {
    const base = Buffer.concat([...pages(fixture()).slice(0, 2),
        page({ sequence: 2, flags: 4, granule: 960n, body: Buffer.from([0xf8, 0x55, 0x55]) })]);
    const decodeGain = async gain => validateWav(await decodeOggOpusToWav(editPage(base, 0,
        b => b.writeInt16LE(gain, 28 + 16)))).samples;
    const neutral = await decodeGain(0), loud = await decodeGain(1536), quiet = await decodeGain(-1536);
    let max = 0, loudMax = 0, quietMax = 0;
    for (let index = 0; index < neutral.length; index += 2) {
        max = Math.max(max, Math.abs(neutral.readInt16LE(index)));
        loudMax = Math.max(loudMax, Math.abs(loud.readInt16LE(index)));
        quietMax = Math.max(quietMax, Math.abs(quiet.readInt16LE(index)));
    }
    assert.ok(max > 0); assert.ok(loudMax > max * 1.8); assert.ok(quietMax < max * 0.6);
});

test('完整两流分别经过真实WASM解码，各自pre-skip与EOS裁剪后PCM可按序合并', async () => {
    const { splitOggOpusStreams } = require('../src/external/tts/tts-ogg');
    const streams = splitOggOpusStreams(Buffer.concat([
        fixture({ packets: 2, preSkip: 120, endTrim: 240 }), fixture({ packets: 3, preSkip: 80, endTrim: 160 })
    ]));
    const pcm = [];
    for (const stream of streams) pcm.push(validateWav(await decodeOggOpusToWav(stream)).samples);
    assert.deepEqual(pcm.map(bytes => bytes.length), [1560 * 2, 2640 * 2]);
    assert.equal(validateWav(wrapPcm(Buffer.concat(pcm), 48000)).samples.length, 8400);
});
