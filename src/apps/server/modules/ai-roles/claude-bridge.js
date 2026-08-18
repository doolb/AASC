'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createReadStream } = require('node:fs');

// 进程存活检测（PID 无效或已死返回 false）
function isAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
}

const READ_TIMEOUT_MS = 60000;

// 每角色一个 claude 进程桥：懒启动 → detached claude（stdin/stdout 接命名管道）→ 流式转发 → 回收。
// 进程 detached + pipe-keeper 持有 in.fifo 写端 + stdout 走 out.fifo（无读者时阻塞、重连后自愈），
// 实现「服务器重启 claude 进程不中断」。
class ClaudeBridge {
    constructor({ dir, name, command = 'claude', promptFile = null, cwd, keeperPath }) {
        this.dir = dir;                 // 角色目录（FIFO/pid/prompt 都在这）
        this.name = name;
        this.command = command;         // claude 基础命令（不含重定向/提示词参数）
        this.promptFile = promptFile;   // --append-system-prompt-file 指向的文件
        this.cwd = cwd;                 // spawn 工作目录（项目根）
        this.keeperPath = keeperPath;   // pipe-keeper.js 绝对路径
        this.claudePidFile = path.join(dir, 'claude.pid');
        this.keeperPidFile = path.join(dir, 'keeper.pid');
        this.inFifo = path.join(dir, 'in.fifo');
        this.outFifo = path.join(dir, 'out.fifo');
        this.errLog = path.join(dir, 'err.log');
        this.reader = null;             // out.fifo 读取流
        this._turn = null;              // 当前待处理一轮 { onChunk, onComplete, onError, resolve }
        this._fullMessage = '';
        this._timeout = null;
    }

    isAlive() {
        return isAlive(this._readPid(this.claudePidFile));
    }

    _readPid(file) {
        try { return parseInt(fs.readFileSync(file, 'utf8').trim(), 10); } catch (_) { return 0; }
    }

    _writePid(file, pid) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, String(pid));
    }

    // 清理：强杀旧进程、删 FIFO、丢弃读端（用于崩溃重建或已死检测后的重置）
    cleanup() {
        for (const file of [this.claudePidFile, this.keeperPidFile]) {
            const pid = this._readPid(file);
            if (isAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
        }
        for (const f of [this.inFifo, this.outFifo]) { try { fs.unlinkSync(f); } catch (_) {} }
        if (this.reader) { try { this.reader.destroy(); } catch (_) {} }
        this.reader = null;
    }

    // 懒启动：确保守卫 + claude + out.fifo 读端就绪（可重复调用）
    async ensureStarted() {
        if (this.isAlive() && this.reader) return;
        this.cleanup();
        fs.mkdirSync(this.dir, { recursive: true });
        try { execFileSync('mkfifo', [this.inFifo, this.outFifo]); } catch (_) { /* 已存在忽略 */ }

        // 1) 管道守卫：detached 持有 in.fifo 写端，防 claude stdin EOF
        const keeper = spawn(process.execPath, [this.keeperPath, this.inFifo, this.keeperPidFile], { detached: true, stdio: 'ignore' });
        keeper.unref();
        const deadline = Date.now() + 3000;
        while (!fs.existsSync(this.keeperPidFile) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 20));
        }
        if (!fs.existsSync(this.keeperPidFile)) throw new Error('管道守卫启动超时');

        // 2) claude：sh -c 'exec <cmd> ... < in.fifo > out.fifo'。exec 让 sh 变为 claude → child.pid 即 claude pid。
        //    提示词走 --append-system-prompt-file（避免 argv 超长），重定向由 sh 完成，claude 自持 fd 不依赖服务器。
        const promptArg = this.promptFile ? ` --append-system-prompt-file "${this.promptFile}"` : '';
        const shellCmd = `exec ${this.command}${promptArg} < "${this.inFifo}" > "${this.outFifo}" 2> "${this.errLog}"`;
        const child = spawn('sh', ['-c', shellCmd], { detached: true, cwd: this.cwd, stdio: 'ignore' });
        this._writePid(this.claudePidFile, child.pid);
        child.unref();

        this._startReader();
    }

    // 读 out.fifo（claude stdout）：按行解析 stream-json 事件
    _startReader() {
        this.reader = createReadStream(this.outFifo);
        let buf = '';
        this.reader.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            let idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (line) this._onLine(line);
            }
        });
        this.reader.on('end', () => {
            this.reader = null;
            this._failTurn('claude 进程退出');
        });
        this.reader.on('error', () => { /* 无读者阻塞等，忽略 */ });
    }

    _resetTimeout() {
        if (this._timeout) clearTimeout(this._timeout);
        this._timeout = setTimeout(() => {
            this._failTurn('等待 claude 响应超时（60s 无输出）');
        }, READ_TIMEOUT_MS);
    }

    _failTurn(error) {
        const turn = this._turn;
        if (!turn) return;
        if (this._timeout) clearTimeout(this._timeout);
        this._timeout = null;
        this._turn = null;
        if (turn.onError) turn.onError(error);
        turn.resolve({ success: false, error });
    }

    _onLine(line) {
        let ev;
        try { ev = JSON.parse(line); } catch (_) { return; }
        if (!ev || typeof ev !== 'object') return;

        // 流式文本增量
        if (ev.type === 'stream_event' && ev.event && ev.event.type === 'content_block_delta' &&
            ev.event.delta && ev.event.delta.type === 'text_delta') {
            const text = ev.event.delta.text || '';
            this._fullMessage += text;
            if (this._turn) {
                this._resetTimeout();
                if (this._turn.onChunk) this._turn.onChunk(text, this._fullMessage);
            }
            return;
        }

        // 一轮结束
        if (ev.type === 'result') {
            const turn = this._turn;
            if (!turn) return;
            if (this._timeout) clearTimeout(this._timeout);
            this._timeout = null;
            this._turn = null;
            if (ev.subtype === 'success') {
                const msg = ev.result || this._fullMessage;
                if (turn.onComplete) turn.onComplete(msg);
                turn.resolve({ success: true, message: msg });
            } else {
                const err = ev.result || 'claude 出错';
                if (turn.onError) turn.onError(err);
                turn.resolve({ success: false, error: err });
            }
            return;
        }
        // system / assistant / 其他 stream_event 忽略
    }

    // 发消息给 claude（流式回调 + 返回 Promise）。调用方需串行化。
    chat(content, { onChunk, onComplete, onError } = {}) {
        return new Promise((resolve) => {
            this.ensureStarted().then(() => {
                this._turn = { onChunk, onComplete, onError, resolve };
                this._fullMessage = '';
                this._resetTimeout();
                const payload = JSON.stringify({ type: 'user', message: { role: 'user', content } });
                fs.writeFileSync(this.inFifo, payload + '\n');
            }).catch((err) => {
                if (onError) onError(err.message);
                resolve({ success: false, error: err.message });
            });
        });
    }

    // 服务器重启恢复：存活则重开 out.fifo 读端（排空阻塞缓冲），死亡则清理返回 false
    reconnect() {
        if (!this.isAlive()) {
            this.cleanup();
            return false;
        }
        if (!this.reader) this._startReader();
        return true;
    }

    // 回收：SIGTERM → 2s 未退 → SIGKILL（claude + 守卫），并删除 FIFO（测试断言 stop 后 FIFO 清除）
    stop() {
        for (const file of [this.claudePidFile, this.keeperPidFile]) {
            const pid = this._readPid(file);
            if (isAlive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch (_) {} }
        }
        setTimeout(() => {
            for (const file of [this.claudePidFile, this.keeperPidFile]) {
                const pid = this._readPid(file);
                if (isAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
            }
        }, 2000);
        for (const f of [this.inFifo, this.outFifo]) { try { fs.unlinkSync(f); } catch (_) {} }
        if (this.reader) { try { this.reader.destroy(); } catch (_) {} }
        this.reader = null;
    }
}
module.exports = ClaudeBridge;
