'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const files = require('./files');

function health(config, context) {
    const settings = files.read(config.root, 'config/config.json', {});
    const port = settings.server?.port || settings.port || 8081;
    const cert = path.join(config.root, 'res/certs/cert.pem');
    const secure = fs.existsSync(cert);
    return new Promise(resolve => {
        const request = (secure ? https : http).get({ host: '127.0.0.1', port, path: '/api/status',
            ...(secure ? { ca: fs.readFileSync(cert), checkServerIdentity: () => undefined } : {}) }, response => {
            const parts = []; let bytes = 0;
            response.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 ** 2) request.destroy(); else parts.push(chunk); });
            response.on('error', () => resolve(false));
            response.on('end', () => {
                try {
                    const result = JSON.parse(Buffer.concat(parts)); const versions = result.versions;
                    const same = (a, b) => fs.realpathSync(a) === fs.realpathSync(b);
                    resolve(response.statusCode === 200 && result.status === 'ok' && versions?.code === `v${context.codeVersion}` &&
                        versions.dependencies === `v${context.dependencyVersion}` && same(versions.codePath, context.codeRoot) &&
                        same(versions.dependenciesPath, path.join(context.dependenciesRoot, 'node_modules')) &&
                        (!context.taskCodeVersion || versions.taskCode?.verified === true && versions.taskCode.version === context.taskCodeVersion && versions.taskCode.sha256 === context.taskCodeSha256 &&
                            versions.taskCode.codeVersion === context.codeVersion && versions.taskCode.dependencyVersion === context.dependencyVersion &&
                            versions.taskCode.taskCodeApiVersion === 1 && versions.taskCode.lockSha256 === context.lockSha256 &&
                            same(versions.taskCode.path, path.join(config.root, `updates/task-code/task-code-v${context.taskCodeVersion}`))));
                } catch (error) { resolve(false); }
            });
        });
        request.setTimeout(3000, () => request.destroy()); request.on('error', () => resolve(false));
    });
}
class ServiceProcess {
    constructor(config, emit) { this.config = config; this.emit = emit; this.child = null; this.stopping = false; this.crashes = 0; this.timer = null; }
    async start(context) {
        if (!context) return;
        const root = this.config.root;
        // 保持原NodeServerConfig的Offline语义，在种子落盘后执行，不提前覆盖新设备种子。
        const settings = files.read(root, 'config/config.json', {});
        const idFile = files.safe(root, path.join(root, '.node-id'));
        const nodeId = settings.aasc?.nodeId || (fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : `apk-subserver-${randomUUID().replaceAll('-', '').slice(0, 16)}`);
        if (!fs.existsSync(idFile)) await fs.promises.writeFile(idFile, nodeId, { flag: 'wx', mode: 0o600 });
        settings.server = { ...(settings.server || {}), port: 8081 };
        settings.aasc = { ...(settings.aasc || {}), role: 'main', mainServerUrl: this.config.environment?.AASC_MAIN_SERVER_URL || 'https://127.0.0.1:8081', nodeId, nodeName: 'AASC 显示端 Offline' };
        settings.asr = { ...(settings.asr || {}), serverEnabled: false, device: 'display', isolateProcess: { ...(settings.asr?.isolateProcess || {}), enabled: false } };
        settings.tts = { ...(settings.tts || {}), serverEnabled: false, device: 'display' };
        await files.atomic(root, 'config/config.json', settings);
        for (const relative of ['res/tasks/render-display/results/index.json', 'release/task/render-display/results/index.json']) {
            const index = files.read(root, relative);
            if (!index) continue;
            let changed = false;
            for (const instance of index.instances || []) if (instance.taskName === 'render-display' && instance.displayId && instance.displayId !== 'offline-display') {
                instance.displayId = 'offline-display'; changed = true;
            }
            if (changed) await files.atomic(root, relative, index);
        }
        const env = { ...process.env, ...(this.config.environment || {}), AASC_SERVER_CHILD: '1', AASC_OFFLINE_MODE: '1',
            AASC_RELEASE_MODE: '0', AASC_PROJECT_ROOT: root, AASC_NODE_MODULES_DIR: path.join(context.dependenciesRoot, 'node_modules'),
            NODE_PATH: path.join(context.dependenciesRoot, 'node_modules') };
        delete env.AASC_TASK_CODE_CONTEXT;
        if (context.taskCodeVersion) env.AASC_TASK_CODE_CONTEXT = JSON.stringify({ version: context.taskCodeVersion, sha256: context.taskCodeSha256,
            path: path.join(root, `updates/task-code/task-code-v${context.taskCodeVersion}`), codeVersion: context.codeVersion,
            dependencyVersion: context.dependencyVersion, lockSha256: context.lockSha256 });
        this.stopping = false;
        const child = fork(path.join(context.codeRoot, 'src/apps/server/boot/server-app.js'), ['--no-tui'], { env, cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        this.child = child; this.context = context;
        child.stdout.pipe(process.stderr, { end: false }); child.stderr.pipe(process.stderr, { end: false });
        child.on('error', error => this.emit({ status: 'failed', detail: error.message }));
        let restartRequested = false; let healthy = false;
        child.on('message', message => { if (message?.type === 'restartRequested') { restartRequested = true; this.crashes = 0; } });
        child.once('exit', code => {
            if (this.child === child) this.child = null;
            if (this.stopping) return;
            this.emit({ status: 'failed', detail: `服务退出: ${code}` });
            if (healthy && (restartRequested || code !== 0) && this.crashes++ < 5) this.timer = setTimeout(() => {
                this.start(context).catch(error => this.emit({ status: 'failed', detail: error.message }));
            }, 1000);
        });
        this.emit({ status: 'starting', pid: child.pid });
        const deadline = Date.now() + (this.config.healthTimeoutMs || 120000);
        while (this.child === child && child.exitCode === null && Date.now() < deadline) {
            if (await health(this.config, context)) { healthy = true; await this.onHealthy?.(); return; }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error('服务未通过真实版本/目录健康检查');
    }
    async stop() {
        this.stopping = true; clearTimeout(this.timer);
        const child = this.child; this.child = null;
        if (!child || child.exitCode !== null) return;
        await new Promise(resolve => {
            const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') child.kill(signal); } };
            const timer = setTimeout(() => kill('SIGKILL'), 12000);
            child.once('exit', () => { clearTimeout(timer); resolve(); }); kill('SIGTERM');
        });
    }
}
module.exports = { ServiceProcess, health };
