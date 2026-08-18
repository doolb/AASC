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
    constructor({ dir, name, command = 'claude', commandPath = null, commandArgs = [], promptFile = null, cwd, keeperPath, readTimeoutMs = READ_TIMEOUT_MS, readOpenTimeoutMs = 5000 }) {
        this.dir = dir;                 // 角色目录（FIFO/pid/prompt 都在这）
        this.name = name;
        this.command = command;
        this.commandPath = commandPath || command;
        this.commandArgs = [...commandArgs];
        this.promptFile = promptFile;   // --append-system-prompt-file 指向的文件
        this.cwd = cwd;                 // spawn 工作目录（项目根）
        this.keeperPath = keeperPath;   // pipe-keeper.js 绝对路径
        this.readTimeoutMs = readTimeoutMs; // 读超时（测试注入短值；默认 60s）
        this.readOpenTimeoutMs = readOpenTimeoutMs; // 读端 open 超时（测试注入短值；默认 5s）
        this.claudePidFile = path.join(dir, 'claude.pid');
        this.keeperPidFile = path.join(dir, 'keeper.pid');
        this.inFifo = path.join(dir, 'in.fifo');
        this.outFifo = path.join(dir, 'out.fifo');
        this.errLog = path.join(dir, 'err.log');
        this.reader = null;             // out.fifo 读取流
        this._turn = null;              // 当前待处理一轮 { onChunk, onComplete, onError, resolve }
        this._fullMessage = '';
        this._timeout = null;
        this._generation = 0;
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

    // 等待读端 open，带超时；超时按 open 失败处理（ensureStarted 的 catch 里 cleanup + 抛错，chat 捕获后返回错误）。
    // 无超时时，若 out.fifo 的 open 永不完成（如 PID 复用指向无关进程、或 claude 存活但已关闭 stdout），
    // ensureStarted 会永久挂起、轮次超时也因 open 未完成而永不被武装 → chat 无限等，故必须限定等待上限。
    _awaitReader(timeoutMs = this.readOpenTimeoutMs) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                settled = true;
                reject(new Error('读端打开超时'));
            }, timeoutMs);
            // 读端正常 open 由 _startReader 的 once('open') resolve；open 失败由 once('error') reject。
            // 任一先到即清除计时器：避免已正常成功路径残留无用计时器拖住事件循环/线程池。
            this._readerReady.then(
                () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } },
                (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } }
            );
        });
    }

    // 懒启动：确保守卫 + claude + out.fifo 读端就绪（可重复调用）
    async ensureStarted() {
        // 进程存活但读端丢失（如服务器重启后新进程）：重开读端，绝不 SIGKILL 存活 claude
        if (this.isAlive()) {
            if (!this.reader) this._startReader();
            try {
                await this._awaitReader(); // 读端真正 open 后再返回，防 EPIPE；带超时防无界挂起
            } catch (err) {
                // open 超时/失败按整组不可用处理：cleanup 杀掉进程并把 reader 置 null，下轮 chat 懒重建
                this.cleanup();
                throw err;
            }
            return;
        }
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

        const inFd = fs.openSync(this.inFifo, 'r+');
        const outFd = fs.openSync(this.outFifo, 'r+');
        const errFd = fs.openSync(this.errLog, 'a');
        const args = [...this.commandArgs, ...(this.promptFile ? ['--append-system-prompt-file', this.promptFile] : [])];
        const child = spawn(this.commandPath, args, {
            detached: true,
            cwd: this.cwd,
            stdio: [inFd, outFd, errFd]
        });
        fs.closeSync(inFd);
        fs.closeSync(outFd);
        fs.closeSync(errFd);
        this._writePid(this.claudePidFile, child.pid);
        child.unref();

        this._startReader();
        try {
            await this._awaitReader(); // 等 claude 打开 out.fifo 写端、读端 open 完成；超时则整组清理重建
        } catch (err) {
            this.cleanup();
            throw err;
        }
    }

    // 读 out.fifo（claude stdout）：按行解析 stream-json 事件
    _startReader() {
        const rs = createReadStream(this.outFifo);
        this.reader = rs;
        // 记录读端就绪 Promise：open 完成前绝不向 in.fifo 写。
        // 否则本轮结束 destroy 读端后、新读端 open（线程池异步）完成前，claude 写 out.fifo 会因
        // 「无读者」触发 EPIPE 崩溃（冷启动因 claude 启动慢掩盖了此竞态，重开路径必现）。
        // open 失败时置空 reader 并 reject：不置空则 reader 恒非 null，下次 alive 路径会跳过重开、
        // 反复 await 同一个已 reject 的 _readerReady → 每次 chat 立即失败且永不重建（粘滞坏状态）；
        // 置空后下次 alive 路径 `if (!this.reader) _startReader()` 会重开新读端（自愈）。
        this._readerReady = new Promise((resolve, reject) => {
            rs.once('open', () => resolve());
            rs.once('error', (err) => { if (this.reader === rs) this.reader = null; reject(err); });
        });
        // 防 unhandled rejection：reconnect() 等无人 await _readerReady 的路径，open 失败时不会被吞
        this._readerReady.catch(() => {});
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
            // 超时先整组清理（SIGKILL claude+守卫、删 FIFO、毁读端）：杜绝 claude 慢响应迟到后
            // 被解析进下一轮返回错误内容；下一轮 chat 的 ensureStarted 会懒重建整条链路。
            this.cleanup();
            this._failTurn(`等待 claude 响应超时（${this.readTimeoutMs}ms 无输出）`);
        }, this.readTimeoutMs);
    }

    _failTurn(error) {
        const turn = this._turn;
        if (!turn) return;
        if (this._timeout) clearTimeout(this._timeout);
        this._timeout = null;
        this._turn = null;
        this._fullMessage = ''; // 清跨轮残留，防旧 turn 内容串入新一轮
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
            // 一轮结束即关读端释放线程池线程；下一轮 chat 的 ensureStarted 会重开
            if (this.reader) { this.reader.destroy(); this.reader = null; }
            return;
        }
        // system / assistant / 其他 stream_event 忽略
    }

    // 发消息给 claude（流式回调 + 返回 Promise）。调用方需串行化。
    chat(content, { onChunk, onComplete, onError } = {}) {
        if (this._turn) return Promise.resolve({ success: false, error: '当前角色仍在处理上一条消息' });
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
        const generation = ++this._generation;
        this._failTurn('角色已停止');
        const pids = [this.claudePidFile, this.keeperPidFile].map((file) => this._readPid(file));
        for (const pid of pids) {
            if (isAlive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch (_) {} }
        }
        setTimeout(() => {
            if (generation !== this._generation) return;
            for (const pid of pids) {
                if (isAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
            }
        }, 2000);
        for (const f of [this.inFifo, this.outFifo]) { try { fs.unlinkSync(f); } catch (_) {} }
        if (this.reader) { try { this.reader.destroy(); } catch (_) {} }
        this.reader = null;
    }
}
module.exports = ClaudeBridge;
