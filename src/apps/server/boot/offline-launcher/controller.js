'use strict';

const path = require('node:path');
const files = require('./files');
const net = require('./network');
const { Releases } = require('./releases');
const { Models } = require('./models');
const { ServiceProcess } = require('./service-process');

class Controller {
    constructor(config, send, switchLauncher = () => { throw new Error('启动器宿主不可用'); }) {
        this.config = config; this.send = send; this.switchLauncher = switchLauncher;
        this.snapshot = { status: 'preparing', phase: 'starting_launcher' }; this.busy = null; this.abort = null;
        this.releases = new Releases(config, progress => this.progress(progress));
        this.models = new Models(config); this.groups = new Map(); this.apkBusy = null; this.promptToken = null;
        this.service = config.service || new ServiceProcess(config, status => this.status(status));
        this.service.onHealthy = async () => {
            await this.releases.healthy();
            // 只在本次干净首装真实健康后开放启动页提示；不能抢先覆盖旧安装的原生已提示记录。
            if (this.freshInstall) {
                const state = files.read(this.config.root, 'updates/js-ui-state.json', { handled: false });
                await files.atomic(this.config.root, 'updates/js-ui-state.json', { ...state, launcherEligible: true });
            }
            this.lastProgress = null;
            this.status({ status: 'ready' });
        };
    }
    status(value) { this.snapshot = value; this.send({ type: 'startup.status', payload: value }); }
    progress(value) { this.lastProgress = { ...value, bootstrap: !this.releases.current() }; this.send({ type: 'update.progress', payload: this.lastProgress }); }
    async boot() {
        await this.releases.rollback();
        await this.releases.repairLegacy();
        const current = this.releases.context();
        if (current) {
            try { await this.service.start(current); }
            catch (error) { await this.service.stop(); this.status({ status: 'failed', detail: error.message }); throw error; }
        } else this.status({ status: 'preparing', phase: 'awaiting_confirmation', detail: '请确认准备本机服务' });
        this.send({ type: 'launcher.healthy', payload: { hasService: !!current } });
    }
    transaction(action) {
        if (this.busy) return Promise.reject(new Error('已有服务事务正在执行'));
        this.abort = new AbortController();
        this.busy = Promise.resolve().then(async () => {
            const release = files.lock(this.config.root);
            try { return await action(this.abort.signal); } finally { release(); }
        }).finally(() => { this.busy = null; this.abort = null; });
        return this.busy;
    }
    bootstrap(payload, request) {
        const source = this.releases.source(payload);
        const identity = JSON.stringify(source.manifest);
        // 启动器热更重载后的自动请求与宿主重放归并，不能重复下载或把健康事务显示成并发失败。
        if (this.bootstrapBusy) {
            if (this.bootstrapIdentity !== identity) throw new Error('已有不同的首装事务正在执行');
            return this.bootstrapBusy;
        }
        this.bootstrapIdentity = identity;
        this.bootstrapBusy = this.apply(payload, request, true).finally(() => { this.bootstrapBusy = null; this.bootstrapIdentity = null; });
        return this.bootstrapBusy;
    }
    async apply(payload, request, fresh) {
        return this.transaction(async signal => {
            const source = fresh ? this.releases.source(payload) : await this.releases.manifest(signal);
            const plan = this.releases.plan(source, fresh);
            if (plan.plan === 'CURRENT') return { applied: false, status: '服务已是当前版本' };
            if (source.components.code.version !== this.config.launcherVersion) {
                // launcherVersion 是宿主既有的代码版本身份；目标实际启动器内容不变时stageLauncher返回null。
                const candidate = await this.releases.stageLauncher(source, signal);
                if (candidate) {
                    if (this.models.jobs.size || this.groups.size || this.apkBusy) throw new Error('模型任务完成或取消后再更新启动器');
                    this.switchLauncher({ candidate, resume: request });
                    return { handingOff: true };
                }
            }
            await this.service.stop();
            this.freshInstall = fresh && !plan.current;
            this.status({ status: 'installing', phase: 'downloading', detail: fresh ? '正在准备本机服务' : '正在更新服务' });
            try {
                const result = await this.releases.prepare(source, fresh, signal);
                await this.service.start(this.releases.context());
                const repair = source.components.dataRepair;
                const last = files.read(this.config.root, 'data-repair/last-result.json', {});
                if (!fresh && this.releases.repairNeeded(repair)) {
                    this.send({ type: 'service.result', payload: { status: 'service_update_failed', detail: `数据修复未完成: ${last.status || '待执行'}` } });
                } else if (!fresh) this.send({ type: 'service.result', payload: { status: 'service_update_applied', detail: '服务更新已健康提交' } });
                return { applied: result.applied, status: '本机服务已就绪' };
            } catch (error) {
                await this.service.stop(); await this.releases.rollback();
                const previous = this.releases.context();
                if (previous) {
                    try { await this.service.start(previous); } catch (restartError) { this.status({ status: 'failed', detail: restartError.message }); }
                } else this.status({ status: 'failed', phase: 'awaiting_confirmation', detail: error.message });
                if (!fresh) this.send({ type: 'service.result', payload: { status: 'service_update_failed', detail: error.message } });
                throw error;
            } finally { this.freshInstall = false; }
        });
    }
    async apk(prepare, signal) {
        const source = await this.releases.manifest(signal); const entry = source.components.apkMin;
        if (!entry || entry.versionCode <= this.config.apkVersion) return { status: 'min APK已是当前版本' };
        if (!prepare) return { status: '发现min APK更新', metadata: entry };
        const destination = files.safe(this.config.root, path.join(this.config.root, `updates/apk/aasc-display-offline-min-v${entry.versionCode}.apk`));
        await net.download(this.config.root, [source.baseUrl, ...this.releases.sources.filter(value => value !== source.baseUrl)],
            { ...entry, version: entry.versionCode }, destination, signal, (completedBytes, totalBytes) => this.progress({ phase: 'downloading_apk', completedBytes, totalBytes }));
        return { status: 'min APK已下载，等待系统校验安装', metadata: entry, apkFile: destination };
    }
    async firstRun(payload) {
        const state = files.read(this.config.root, 'updates/js-ui-state.json', { handled: false });
        const launcherReady = payload.launcherReady === true && state.launcherEligible === true;
        // 旧安装的启动页查询不导入隐含false，等待显示端带来真正的原生历史标记。
        if (payload.launcherReady && !launcherReady) return { show: false, handled: !!state.handled };
        if (!state.legacyImported) { state.handled = state.handled || payload.handled === true; state.legacyImported = true; await files.atomic(this.config.root, 'updates/js-ui-state.json', state); }
        if (!this.config.updateOnly || !payload.front || (!payload.displayReady && !launcherReady) || this.snapshot.status !== 'ready' || state.handled) return { show: false, handled: !!state.handled };
        const ids = new Set(this.models.groups().filter(group => group.defaultSelected).flatMap(group => group.modelIds));
        const ready = this.models.status().filter(model => model.filesReady).map(model => model.modelId);
        if ([...ids].every(id => ready.includes(id))) { await files.atomic(this.config.root, 'updates/js-ui-state.json', { handled: true, legacyImported: true }); return { show: false, handled: true }; }
        this.promptToken ||= require('node:crypto').randomUUID();
        return { show: true, handled: false, token: this.promptToken, groups: this.models.groups().filter(group => group.defaultSelected) };
    }
    async prepareGroup(payload, requestId) {
        if (!Array.isArray(payload.modelIds) || !payload.modelIds.length || payload.modelIds.length > 64) throw new Error('模型组无效');
        const ids = [...new Set(payload.modelIds)]; const models = ids.map(id => this.models.definition(id));
        const abort = new AbortController(); this.groups.set(requestId, { ids, abort });
        const total = models.reduce((sum, model) => sum + model.totalBytes, 0); let complete = 0; let last = 0;
        try {
            for (const model of models) {
                abort.signal.throwIfAborted();
                const present = this.models.directories(model.modelId).some(dir => this.models.present(dir, model));
                await this.models.prepare(model.modelId, payload.allowDownload === true || !present, value => {
                    abort.signal.throwIfAborted();
                    last = Math.max(last, Math.min(99, Math.floor((complete + model.totalBytes * value / 100) * 100 / total)));
                    this.send({ type: 'model.progress', requestId, payload: { modelId: model.modelId, progress: last } });
                });
                abort.signal.throwIfAborted(); complete += model.totalBytes;
                this.send({ type: 'model.prepared', requestId, payload: { modelId: model.modelId, progress: Math.floor(complete * 100 / total) } });
            }
            return { modelIds: ids };
        } finally { this.groups.delete(requestId); }
    }
    cancelModel(id) {
        this.models.cancel(id);
        for (const group of this.groups.values()) if (group.ids.includes(id)) {
            group.abort.abort(new Error('已取消模型组'));
            for (const active of group.ids) this.models.cancel(active);
        }
        return {};
    }
    async handle(request) {
        const p = request.payload || {};
        const routes = {
            'state.get': () => ({ ...this.snapshot, progress: this.busy && this.snapshot.status !== 'ready' ? this.lastProgress : null, modelStates: this.models.status() }),
            'bootstrap.preview': () => this.releases.preview(),
            'bootstrap.install': () => this.bootstrap(p, request),
            'bootstrap.cancel': () => { this.abort?.abort(new Error('已取消本机服务准备')); return {}; },
            'service.check': () => this.releases.check(p.manualRetry === true),
            'service.apply': () => this.apply(p, request, false),
            'service.restart': () => this.transaction(async () => { await this.service.stop(); await this.boot(); return {}; }),
            'apk.check': () => this.apk(false),
            'apk.prepare': () => {
                if (this.apkBusy || this.busy) throw new Error('已有更新事务正在执行');
                this.apkBusy = this.apk(true).finally(() => { this.apkBusy = null; }); return this.apkBusy;
            },
            'models.catalog': () => ({ ...this.models.catalog, groups: this.models.groups() }),
            'models.status': () => this.models.status(),
            'models.locate': () => ({ directory: this.models.locate(p.modelId) }),
            'models.require': async () => ({ directory: await this.models.require(p.modelId) }),
            'models.prepare': async () => ({ directory: await this.models.prepare(p.modelId, p.allowDownload === true, progress => this.send({ type: 'model.progress', requestId: request.requestId, payload: { modelId: p.modelId, progress } })) }),
            'models.prepareGroup': () => this.prepareGroup(p, request.requestId),
            'models.cancel': () => this.cancelModel(p.modelId),
            'ui.firstRun': () => this.firstRun(p),
            'ui.firstRunShown': async () => {
                if (!p.token || p.token !== this.promptToken) throw new Error('首装展示确认已过期');
                if (p.visible !== true) throw new Error('首装提示尚未确认可见');
                this.promptToken = null; await files.atomic(this.config.root, 'updates/js-ui-state.json', { handled: true, legacyImported: true }); return { handled: true, legacyImported: true }; }
        };
        if (!routes[request.type]) throw new Error('未知启动器命令');
        if (this.initializing && ['service.apply', 'bootstrap.install', 'service.restart'].includes(request.type)) {
            try { await this.initializing; } catch (error) { /* 旧服务不健康时仍允许用户更新或重试恢复。 */ }
        }
        return routes[request.type]();
    }
    async close() {
        this.abort?.abort(new Error('启动器正在停止'));
        for (const id of this.models.jobs.keys()) this.cancelModel(id);
        await Promise.allSettled([this.busy, this.apkBusy, ...[...this.models.jobs.values()].map(job => job.promise)]);
        await this.service.stop();
    }
}
module.exports = { Controller };
