'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-')); }
const KEEPER = path.join(__dirname, 'pipe-keeper.js');

test('守卫持有 in.fifo 写端并记录 PID，可 SIGTERM 退出', async () => {
    const dir = tmpDir();
    const inFifo = path.join(dir, 'in.fifo');
    const pidFile = path.join(dir, 'keeper.pid');
    execFileSync('mkfifo', [inFifo]);

    const keeper = spawn(process.execPath, [KEEPER, inFifo, pidFile], { stdio: 'ignore' });
    // 等待 pid 文件出现（表示已打开 in.fifo 写端）
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.ok(fs.existsSync(pidFile), '守卫应写入 pid 文件');

    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    // 存活
    let alive = true;
    try { process.kill(pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
    assert.ok(alive, '守卫进程应存活');

    // 守卫持有写端：此时尝试只读打开 in.fifo 不应阻塞（有写者）
    const reader = fs.openSync(inFifo, 'r');
    assert.ok(reader, '有守卫持有写端时，读端应能立即打开');
    fs.closeSync(reader);

    // SIGTERM 后退出
    process.kill(pid, 'SIGTERM');
    const end = Date.now() + 3000;
    let running = true;
    while (Date.now() < end) {
        try { process.kill(pid, 0); running = true; } catch (e) { running = e.code === 'EPERM'; }
        if (!running) break;
        await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(!running, '守卫收到 SIGTERM 后应退出');
});

test('守卫退出后，只读打开无写者的 FIFO 会阻塞直到出现写者', async () => {
    const dir = tmpDir();
    const inFifo = path.join(dir, 'in.fifo');
    execFileSync('mkfifo', [inFifo]);
    // 无守卫、无写者：读端 open 在子进程里会阻塞 —— 只验证它被阻塞，不验证超时
    // 子进程 -e 脚本里用 process.argv[1] 取 fifo 路径，需作为位置参数传入
    const child = spawn('node', ['-e', `const fs=require('fs');fs.openSync(process.argv[1],'r');`, inFifo], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    // 此时 child 仍存活（open 阻塞中）
    let running = true;
    try { process.kill(child.pid, 0); } catch (e) { running = e.code === 'EPERM'; }
    assert.ok(running, '无写者时读端 open 应阻塞');
    child.kill('SIGKILL');
});
