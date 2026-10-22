'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { LinuxAudioOutput, normalizeDevice } = require('../src/apps/voice-display-node/linux-audio-output');
const tick = () => new Promise(resolve => setImmediate(resolve));

function probeFixture({ names = 'pulse\n    PulseAudio\npipewire\n    PipeWire', pulse = true, pipewire = true } = {}) {
    const calls = [], logs = [];
    const selector = new LinuxAudioOutput({}, { log: text => logs.push(text), run: async (command, args, options) => {
        calls.push({ command, args, options });
        assert.equal(options.shell, false); assert.equal(options.timeout, 2000);
        if (command === 'aplay') return { stdout: names };
        if ((command === 'pactl' && pulse) || (command === 'pw-cli' && pipewire)) return { stdout: 'server available' };
        throw Object.assign(new Error('服务不可达或命令缺失'), { code: 'ENOENT' });
    } });
    return { selector, calls, logs };
}

function wav() {
    const buffer = Buffer.alloc(52);
    buffer.write('RIFF'); buffer.writeUInt32LE(44, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36); buffer.writeUInt32LE(8, 40);
    return buffer;
}

/** 运行真实AudioPlayer与子进程事件链，只替换操作系统进程，测试不操作真实音频设备。 */
function audioFixture(output) {
    const children = [], errors = [];
    const sandbox = { module: { exports: {} }, Buffer, AbortController, console: { log() {}, error: (...args) => errors.push(args) },
        require(name) {
            if (name === './linux-audio-output') return { LinuxAudioOutput };
            if (name === 'os') return { platform: () => 'linux' };
            if (name === 'child_process') return { spawn(command, args, options) {
                const child = new EventEmitter();
                child.stdin = new PassThrough(); child.stderr = new PassThrough(); child.input = [];
                child.stdin.on('data', data => child.input.push(data));
                Object.assign(child, { command, args, options }); children.push(child);
                child.kill = () => queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
                queueMicrotask(() => child.emit('spawn')); return child;
            } };
            return require(name);
        }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/apps/voice-display-node/audio-player'), 'utf8'), sandbox);
    return { player: new sandbox.module.exports({}, { linuxOutput: output }), children, errors };
}

test('设备名规范化与显式PCM，禁止控制字符，显式配置不探测或改投', async () => {
    assert.equal(normalizeDevice(), 'auto'); assert.equal(normalizeDevice(' pulse '), 'pulse');
    for (const value of ['', ' ', null, 0, {}, 'x\n', 'x\0y', 'a'.repeat(257)]) assert.throws(() => normalizeDevice(value), /audioPlayer.linux.device/);
    for (const device of ['pulse', 'pipewire', 'default', 'plug:dmix', 'hw:1,0', '设备 名']) {
        const selector = new LinuxAudioOutput({ device }, { log() {}, run() { throw new Error('显式配置不应探测'); } });
        assert.equal(await selector.resolve(), device);
    }
    assert.throws(() => new LinuxAudioOutput('pulse'), /配置对象/);
});

test('auto须同时具备ALSA插件和可达服务，优先pulse再pipewire，无共享入口时default', async () => {
    for (const [options, expected] of [
        [{}, 'pulse'], [{ pulse: false }, 'pipewire'], [{ pulse: false, pipewire: false }, 'default'],
        [{ names: 'default\n    Default', pulse: true, pipewire: true }, 'default'],
        [{ names: 'pipewire\n    PipeWire' }, 'pipewire'], [{ names: 'pulse\n    PulseAudio', pulse: false }, 'default']
    ]) {
        const { selector, calls, logs } = probeFixture(options);
        const first = selector.resolve(); assert.equal(selector.resolve(), first);
        assert.equal(await first, expected); assert.equal(await selector.resolve(), expected);
        assert.equal(calls.length, 3); assert.equal(logs.length, 1, '逐句调用不重复探测或打印选择结果');
        assert.deepEqual(calls.map(call => call.args), [['-L'], ['info'], ['info', '0']]);
    }
});

test('真实卡住的探测进程被限时终止，不阻塞播放设备回退', { timeout: 5000 }, async () => {
    const children = [];
    const selector = new LinuxAudioOutput({}, { log() {}, timeoutMs: 80, run: (command, args, options) => new Promise((resolve, reject) => {
        const child = execFile(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options,
            (error, stdout) => error ? reject(error) : resolve({ stdout }));
        children.push(child);
    }) });
    assert.equal(await selector.resolve(), 'default');
    assert.equal(children.length, 3); assert.ok(children.every(child => child.signalCode === 'SIGKILL'));
});

test('共享输出仍使用aplay独立-D参数与内存WAV，PCM及字幕/录音完成回调各一次', async () => {
    const { selector } = probeFixture();
    const { player, children, errors } = audioFixture(selector);
    let starts = 0, ends = 0, pcm = 0, complete = 0;
    const events = [], buffer = wav();
    player.onPlayStart = () => starts++; player.onPlayEnd = () => ends++;
    player.onPlayData = () => pcm++; player.onItemPlayback = event => events.push(event);
    player.queueBuffer(buffer, { text: '报时', onComplete: error => { assert.equal(error, null); complete++; } });
    assert.equal(pcm, 0, '探测之前不提前送AEC参考信号');
    await tick(); assert.equal(children.length, 1);
    assert.equal(children[0].command, 'aplay'); assert.equal(children[0].options.shell, undefined);
    assert.deepEqual(Array.from(children[0].args), ['-q', '-D', 'pulse', '-t', 'wav']);
    assert.deepEqual(Buffer.concat(children[0].input), buffer);
    assert.deepEqual(events.filter(event => event.phase === 'start').map(event => event.text), ['报时']);
    children[0].emit('close', 0); await tick();
    assert.equal(starts, 1); assert.equal(ends, 1); assert.equal(pcm, 1); assert.equal(complete, 1); assert.deepEqual(errors, []);
});

test('探测中取消文本owner，旧音频不播放/不送AEC，普通TTS继续原队列', async () => {
    let release;
    const selection = new Promise(resolve => { release = resolve; });
    const { player, children } = audioFixture({ resolve: () => selection });
    const completed = []; let pcm = 0, starts = 0, ends = 0;
    player.onPlayData = () => pcm++; player.onPlayStart = () => starts++; player.onPlayEnd = () => ends++;
    player.queueBuffer(wav(), { owner: 'text:old', onComplete: () => completed.push('old') });
    player.queueBuffer(wav(), { owner: 'ordinary', onComplete: () => completed.push('ordinary') });
    player.queueBuffer(wav(), { owner: 'text:old', onComplete: () => completed.push('queued-old') });
    player.cancelOwner('text:old'); release('pulse'); await tick();
    assert.equal(children.length, 1); assert.equal(pcm, 1); assert.equal(player.currentQueueItem.owner, 'ordinary');
    children[0].emit('close', 0); await tick();
    assert.deepEqual(completed, ['ordinary']); assert.equal(starts, 1); assert.equal(ends, 1);
});

test('停止后探测迟到不会复活旧队列，新播报继续使用同一选择结果', async () => {
    let release;
    const selection = new Promise(resolve => { release = resolve; });
    const { player, children } = audioFixture({ resolve: () => selection });
    const completed = []; let pcm = 0;
    player.onPlayData = () => pcm++;
    player.queueBuffer(wav(), { onComplete: () => completed.push('old') });
    player.stop(); player.clearQueue();
    player.queueBuffer(wav(), { onComplete: () => completed.push('new') });
    release('pipewire'); await tick();
    assert.equal(children.length, 1); assert.equal(pcm, 1); assert.ok(children[0].args.includes('pipewire'));
    children[0].emit('close', 0); await tick(); assert.deepEqual(completed, ['new']);
});

test('设备播放失败只回调一次，不跨设备重新播放已入队音频', async () => {
    const selector = new LinuxAudioOutput({ device: 'pulse' }, { log() {}, run() { throw new Error('不应探测'); } });
    const { player, children } = audioFixture(selector);
    const completed = [];
    player.queueBuffer(wav(), { onComplete: error => completed.push(error.message) });
    await tick(); children[0].stderr.write('audio open error: Device or resource busy'); children[0].emit('close', 1);
    await tick(); assert.equal(children.length, 1); assert.equal(completed.length, 1); assert.match(completed[0], /Device or resource busy/);
});
