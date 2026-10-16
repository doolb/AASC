'use strict';

// 此文件及其校验器从APK内置基线执行，业务启动器entry/controller可由签名代码包替换。
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const files = require('./files');
const { verifyManifest } = require('./releases');
const { extractZipSafely } = require('./archive');

const PREFIX = 'src/apps/server/boot/offline-launcher/';
const SHARED = ['src/apps/server/modules/aasc/shared-update-manifest.js', 'src/apps/server/modules/aasc/task-code-contract.js',
    'src/apps/server/modules/aasc/dependency-tree.js', 'src/apps/server/modules/model-distribution/offline-model-catalog.json'];
const STATE = 'updates/launcher-state.json';

async function verifyCandidate(config, candidate) {
    if (!Number.isSafeInteger(candidate?.version) || candidate.version < 1) throw new Error('启动器候选版本无效');
    const components = verifyManifest(candidate.manifest, config);
    const entry = components.code;
    if (candidate.version !== entry.version) throw new Error('启动器版本与签名清单不符');
    const root = files.safe(config.root, path.join(config.root, `updates/code/code-v${entry.version}`));
    const zip = files.safe(config.root, path.join(config.root, `updates/js-downloads/code-v${entry.version}-${entry.sha256}.zip`));
    if (!await files.matches(config.root, zip, entry)) throw new Error('启动器来源代码ZIP已损坏');
    const stage = files.safe(config.root, path.join(config.root, `updates/.launcher-verify-${process.pid}-${Date.now()}`));
    try {
        const select = name => name.startsWith(PREFIX) || SHARED.includes(name);
        await extractZipSafely(zip, stage, 'code', select);
        const expected = await files.walk(stage);
        if (!expected.some(file => file.path === PREFIX + 'entry.js')) throw new Error('代码包缺少启动器入口');
        for (const file of expected) if (!await files.matches(root, path.join(root, file.path), file)) throw new Error('启动器文件与已签名ZIP不一致');
        for (const file of await files.walk(path.join(root, PREFIX))) if (!expected.some(entry => entry.path === PREFIX + file.path)) throw new Error('启动器目录包含未签名文件');
        const api = files.read(root, PREFIX + 'host-api.json');
        if (api?.hostApi !== 1 || api.stateApi !== 1) throw new Error('启动器宿主或状态协议不兼容');
        return root;
    } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
}
class Supervisor {
    constructor(config, output = value => process.stdout.write(JSON.stringify(value) + '\n')) {
        this.config = config; this.output = output; this.child = null; this.switching = false; this.stopping = false;
        this.pending = null; this.resume = null; this.timer = null; this.servicePid = null;
        this.requests = new Set(); this.fallbacks = new Set(); this.recovering = false;
    }
    send(value) { this.output({ ...value, generation: this.config.generation }); }
    async start() {
        this.state = files.read(this.config.root, STATE, { active: null, previous: null });
        if (this.state.pending) { this.state.pending = null; await files.atomic(this.config.root, STATE, this.state); }
        await this.launch(this.state.active);
    }
    async launch(candidate) {
        let root = this.config.bundleRoot;
        if (candidate) {
            try { root = await verifyCandidate(this.config, candidate); }
            catch (error) { await this.fallback(error); return; }
        }
        this.launchRoot = root;
        const context = { ...this.config, launcherVersion: candidate?.version || 0,
            catalogPath: path.join(root, 'src/apps/server/modules/model-distribution/offline-model-catalog.json') };
        const child = fork(path.join(root, PREFIX, 'entry.js'), [], { env: { ...process.env, AASC_LAUNCH_CONTEXT: JSON.stringify(context) },
            cwd: this.config.root, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        this.child = child;
        child.stdout.pipe(process.stderr, { end: false }); child.stderr.pipe(process.stderr, { end: false });
        this.timer = setTimeout(() => this.fallback(new Error('启动器未按时完成健康握手')).catch(error => this.fail(error)), this.config.launcherTimeoutMs || 150000);
        child.on('message', message => {
            if (this.child !== child || !message || Buffer.byteLength(JSON.stringify(message)) > 2 * 1024 ** 2) return;
            this.message(message).catch(error => {
                const id = message.payload?.resume?.requestId;
                if (id && this.requests.delete(id)) this.send({ type: 'rpc.result', requestId: id, error: error.message });
                if (this.pending) this.fallback(error).catch(value => this.fail(value));
                else if (!id) this.fail(error);
            });
        });
        child.once('error', error => this.fallback(error).catch(value => this.fail(value)));
        child.once('exit', code => {
            if (this.child !== child || this.switching || this.stopping) return;
            this.child = null; this.killService();
            this.fallback(new Error(`启动器退出: ${code}`)).catch(error => this.fail(error));
        });
    }
    async message(message) {
        if (message.type === 'launcher.switch') {
            if (this.switching || this.pending) throw new Error('启动器切换正在执行');
            const { candidate, resume } = message.payload || {};
            if (!this.requests.has(resume?.requestId)) throw new Error('启动器切换缺少已确认请求');
            await verifyCandidate(this.config, candidate);
            this.pending = candidate; this.resume = resume;
            await files.atomic(this.config.root, STATE, { ...this.state, pending: candidate });
            for (const id of this.requests) if (id !== resume.requestId) {
                this.requests.delete(id); this.send({ type: 'rpc.result', requestId: id, error: '启动器正在切换，请重试' });
            }
            await this.stopChild(); this.switching = false; await this.launch(candidate); return;
        }
        if (message.type === 'launcher.healthy') {
            clearTimeout(this.timer);
            if (this.pending) {
                this.state = { active: this.pending, previous: this.state.active || null, pending: null };
                await files.atomic(this.config.root, STATE, this.state);
                this.pending = null;
                const request = this.resume; this.resume = null;
                if (request) this.child.send(request);
            }
            return;
        }
        if (message.type === 'launcher.failed' && this.pending) { await this.fallback(new Error(message.payload?.error || '候选启动器健康失败')); return; }
        if (message.type === 'startup.status' && message.payload?.pid) this.servicePid = message.payload.pid;
        if (message.type === 'launcher.ready') message.payload = { ...message.payload, uiRoot: path.join(this.launchRoot, PREFIX, 'ui') };
        if (message.type === 'rpc.result') this.requests.delete(message.requestId);
        this.send(message);
    }
    request(message) {
        if (message?.generation !== this.config.generation || typeof message.requestId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(message.requestId) ||
            typeof message.type !== 'string' || Buffer.byteLength(JSON.stringify(message)) > 2 * 1024 ** 2) throw new Error('宿主请求无效或代次已过期');
        if (!this.child?.connected || this.switching || this.pending) throw new Error('启动器暂不可用');
        if (this.requests.has(message.requestId)) throw new Error('重复宿主请求');
        this.requests.add(message.requestId); this.child.send(message);
    }
    killService() {
        if (!Number.isSafeInteger(this.servicePid) || this.servicePid < 1) return;
        try { process.kill(-this.servicePid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') console.error('清理旧服务进程组失败'); }
        this.servicePid = null;
    }
    async stopChild() {
        clearTimeout(this.timer); this.switching = true;
        const child = this.child; this.child = null;
        if (child && child.exitCode === null) await new Promise(resolve => {
            const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { child.kill('SIGKILL'); } }, 15000);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
            if (child.connected) child.send({ type: 'host.stop' }); else child.kill('SIGTERM');
        });
        this.killService();
    }
    async fallback(error) {
        if (this.stopping || this.recovering) return;
        this.recovering = true;
        clearTimeout(this.timer);
        const hadPending = !!this.pending;
        const failed = this.pending || this.state.active;
        this.fallbacks.add(failed?.version || 0);
        const original = this.resume;
        this.pending = null; this.resume = null;
        await this.stopChild();
        let candidate = hadPending ? this.state.active : this.state.previous;
        if (candidate && this.fallbacks.has(candidate.version)) candidate = null;
        if (!candidate && this.fallbacks.has(0)) {
            for (const id of this.requests) this.send({ type: 'rpc.result', requestId: id, error: 'APK内置启动器无法恢复: ' + error.message });
            this.requests.clear(); this.recovering = false; this.fail(error);
            this.send({ type: 'launcher.fatal', payload: { error: error.message } }); return;
        }
        this.state = { active: candidate, previous: null, pending: null };
        await files.atomic(this.config.root, STATE, this.state);
        if (original) { this.requests.delete(original.requestId); this.send({ type: 'rpc.result', requestId: original.requestId, error: '启动器升级已回退: ' + error.message }); }
        for (const id of this.requests) this.send({ type: 'rpc.result', requestId: id, error: '启动器重启，请重试' });
        this.requests.clear(); this.switching = false; this.recovering = false;
        await this.launch(candidate);
    }
    fail(error) { this.send({ type: 'startup.status', payload: { status: 'failed', detail: error.message } }); }
    async close() { this.stopping = true; await this.stopChild(); }
}
async function main() {
    const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    if (config.hostApi !== 1 || config.stateApi !== 1 || !config.root || !config.bundleRoot || !config.publicKey) throw new Error('宿主配置不完整');
    const supervisor = new Supervisor(config);
    let buffered = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
        buffered += chunk;
        let newline;
        while ((newline = buffered.indexOf('\n')) >= 0) {
            const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
            if (!line) continue;
            if (Buffer.byteLength(line) > 2 * 1024 ** 2) { supervisor.fail(new Error('宿主消息超限')); process.stdin.pause(); return; }
            try { supervisor.request(JSON.parse(line)); }
            catch (error) { let id; try { id = JSON.parse(line).requestId; } catch {} supervisor.send({ type: 'rpc.result', requestId: id, error: error.message }); }
        }
        if (Buffer.byteLength(buffered) > 2 * 1024 ** 2) { supervisor.fail(new Error('宿主消息超限')); process.stdin.pause(); }
    });
    const stop = async () => { await supervisor.close(); process.exit(0); };
    process.stdin.once('end', stop); process.once('SIGTERM', stop); process.once('SIGINT', stop);
    await supervisor.start(); return supervisor;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { Supervisor, verifyCandidate, PREFIX, SHARED, main };
