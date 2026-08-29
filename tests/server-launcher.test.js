'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const {
    createServerLauncher,
    DEFAULT_RESTART_DELAY_MS,
    MAX_CRASH_RESTARTS
} = require('../src/apps/server/boot/server-launcher');

const SERVER_PATH = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');
const PACKAGE_PATH = path.resolve(__dirname, '../package.json');

function createFakeChild() {
    const child = new EventEmitter();
    child.killedSignals = [];
    child.sentMessages = [];
    child.kill = (signal) => {
        child.killedSignals.push(signal);
        return true;
    };
    child.send = (message) => {
        child.sentMessages.push(message);
        return true;
    };
    return child;
}

function createImmediateScheduler() {
    const timers = new Set();
    return {
        schedule(callback) {
            const timer = { callback, cancelled: false };
            timers.add(timer);
            if (!timer.cancelled) callback();
            timers.delete(timer);
            return timer;
        },
        cancelSchedule(timer) {
            if (timer) timer.cancelled = true;
        }
    };
}

test('启动器使用继承标准流和 IPC 启动服务器子进程', () => {
    const calls = [];
    const child = createFakeChild();
    const launcher = createServerLauncher({
        serverPath: '/tmp/server-app.js',
        spawnChild: (...args) => {
            calls.push(args);
            return child;
        }
    });

    launcher.start();

    assert.deepEqual(calls[0][2].stdio, ['inherit', 'inherit', 'inherit', 'ipc']);
    assert.equal(calls[0][2].detached, undefined);
    assert.equal(calls[0][2].env.AASC_SERVER_CHILD, '1');
});

test('主动重启会拉起新子进程，外部停止不会拉起新子进程', () => {
    const children = [createFakeChild(), createFakeChild()];
    const scheduler = createImmediateScheduler();
    let index = 0;
    const launcher = createServerLauncher({
        spawnChild: () => children[index++],
        schedule: scheduler.schedule,
        cancelSchedule: scheduler.cancelSchedule,
        exit: () => {}
    });

    launcher.start();
    children[0].emit('message', { type: 'restartRequested' });
    children[0].emit('exit', 0, null);
    assert.equal(index, 2);

    launcher.requestStop('SIGTERM');
    children[1].emit('exit', 143, 'SIGTERM');
    assert.equal(index, 2);
    assert.deepEqual(children[1].killedSignals, ['SIGTERM']);
});

test('异常退出按延迟重启，连续失败达到上限后退出', () => {
    const children = Array.from({ length: MAX_CRASH_RESTARTS + 1 }, createFakeChild);
    const delays = [];
    const exits = [];
    let index = 0;
    const launcher = createServerLauncher({
        spawnChild: () => children[index++],
        schedule: (callback, delayMs) => {
            delays.push(delayMs);
            callback();
            return null;
        },
        cancelSchedule: () => {},
        exit: code => exits.push(code)
    });

    launcher.start();
    for (let crash = 0; crash < MAX_CRASH_RESTARTS + 1; crash += 1) {
        const child = children[crash];
        child.emit('exit', 1, null);
    }

    assert.equal(index, MAX_CRASH_RESTARTS);
    assert.equal(delays.length, MAX_CRASH_RESTARTS - 1);
    assert.ok(delays.every(delay => delay === DEFAULT_RESTART_DELAY_MS));
    assert.deepEqual(exits, [1]);
});

test('服务器重启接口只通知启动器，不再 detached 启动新进程', () => {
    const source = fs.readFileSync(SERVER_PATH, 'utf8');
    const restartStart = source.indexOf("app.post('/api/restart'");
    const restartEnd = source.indexOf('let processShutdownStarted');
    const restartBlock = source.slice(restartStart, restartEnd);

    assert.match(restartBlock, /process\.send\(\{\s*type:\s*['"]restartRequested['"]/u);
    assert.match(restartBlock, /tui\.destroy\(\)/u);
    assert.doesNotMatch(restartBlock, /detached\s*:\s*true/u);
    assert.doesNotMatch(restartBlock, /stdio\s*:\s*['"]ignore['"]/u);
});

test('npm start 和 main 入口均指向前台启动器', () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));

    assert.equal(packageJson.main, 'src/apps/server/boot/server-launcher.js');
    assert.equal(packageJson.scripts.start, 'node --openssl-legacy-provider --expose-gc src/apps/server/boot/server-launcher.js');
});

test('服务器默认关闭 TUI，仅显式 --tui 启用且 --no-tui 优先', () => {
    const source = fs.readFileSync(SERVER_PATH, 'utf8');

    assert.match(
        source,
        /const useTUI = process\.argv\.includes\(['"]--tui['"]\)\s*&&\s*!process\.argv\.includes\(['"]--no-tui['"]\)/u
    );
});
