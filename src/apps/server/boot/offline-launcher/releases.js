'use strict';

const fs = require('node:fs');
const path = require('node:path');
const shared = require('../../modules/aasc/shared-update-manifest');
const tasks = require('../../modules/aasc/task-code-contract');
const tree = require('../../modules/aasc/dependency-tree');
const files = require('./files');
const net = require('./network');
const archive = require('./archive');
const { restoreSeeds } = require('./seeds');

const POINTER = 'updates/active-release.json';
const MARKER = '.offline-update-verified.json';
function identity(root, kind, entry) {
    const marker = files.read(root, MARKER);
    if (marker?.kind !== kind || marker.version !== entry.version || marker.sha256 !== entry.sha256) throw new Error('已有版本目录与签名身份不符');
}
async function validateLock(directory, code) {
    const packages = files.read(code, 'package-lock.json')?.packages;
    if (!packages || typeof packages !== 'object') throw new Error('生产锁缺少packages');
    for (const [relative, entry] of Object.entries(packages)) {
        if (!relative || entry.dev || entry.optional) continue;
        if (!relative.startsWith('node_modules/') || relative.split('/').some(part => !/^[A-Za-z0-9@_.-]+$/.test(part) || ['.', '..'].includes(part))) throw new Error('生产锁路径无效');
        if (files.read(directory, relative + '/package.json')?.version !== entry.version) throw new Error('生产包与代码锁版本不符: ' + relative);
    }
}
const RUNTIME = { abi: 'arm64-v8a', nodeMajor: 26, contractVersion: 1 };
function artifact(entry, expectedPath) {
    if (!Number.isSafeInteger(entry?.version) || entry.version < 1 || !Number.isSafeInteger(entry.size) || entry.size < 1 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) || entry.relativeUrl !== expectedPath(entry.version)) throw new Error('发布组件无效');
}
function verifyManifest(manifest, config) {
    shared.verifyManifest(manifest, config.publicKey);
    const c = manifest.payload.components;
    for (const entry of [c.code, c.dependencies]) {
        const runtime = entry.runtimeCompatibility || c.code.runtimeCompatibility;
        if (runtime && Object.entries(RUNTIME).some(([key, value]) => runtime[key] !== value)) throw new Error('服务运行契约不兼容');
    }
    tasks.assertCombination(c.taskCode, c.code, c.dependencies, config.apkVersion);
    if (c.nodeMinSeeds) artifact(c.nodeMinSeeds, version => `node-min-seeds/node-min-seeds-v${version}.zip`);
    if (c.apkMin) {
        const apk = c.apkMin;
        artifact({ ...apk, version: apk.versionCode }, version => `apk/aasc-display-offline-min-v${version}.apk`);
        if (apk.packageName !== 'com.aasc.display.offline' || !/^[a-f0-9]{64}$/.test(apk.signerSha256)) throw new Error('APK组件身份无效');
    }
    if (c.dataRepair) {
        const repair = c.dataRepair;
        artifact({ ...repair, version: repair.repairVersion }, version => `data/data-repair-v${version}.zip`);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(repair.repairId) || !/^[a-f0-9]{64}$/.test(repair.scriptSha256) ||
            !Number.isSafeInteger(repair.requiredCodeVersion) || repair.requiredCodeVersion < 1 ||
            !Number.isSafeInteger(repair.requiredDataVersion) || repair.requiredDataVersion < 0 ||
            !Number.isSafeInteger(repair.targetDataVersion) || repair.targetDataVersion < repair.requiredDataVersion ||
            repair.compatibleDataVersions !== undefined && (!Array.isArray(repair.compatibleDataVersions) || !repair.compatibleDataVersions.length || repair.compatibleDataVersions.length > 32 ||
            repair.compatibleDataVersions.some(value => !Number.isSafeInteger(value) || value < 0 || value > repair.targetDataVersion)) ||
            !Array.isArray(repair.capabilities) || !repair.capabilities.length || repair.capabilities.some(value =>
                !['config', 'user-config', 'chat2api.config', 'chat2api.providers', 'chat2api.accounts', 'chat2api.model-mappings'].includes(value))) throw new Error('数据修复契约无效');
        const compatible = repair.compatibleDataVersions || [repair.requiredDataVersion];
        if (new Set(compatible).size !== compatible.length || !compatible.includes(repair.requiredDataVersion) ||
            compatible.length > 1 && !Number.isSafeInteger(repair.requiredApkVersionCode) ||
            repair.requiredApkVersionCode !== undefined && (!Number.isSafeInteger(repair.requiredApkVersionCode) || repair.requiredApkVersionCode < 1) ||
            new Set(repair.capabilities).size !== repair.capabilities.length || repair.capabilities.length > 32 ||
            repair.capabilities.includes('chat2api.accounts') && repair.sensitive !== true) throw new Error('数据修复授权/兼容契约无效');
    }
    return c;
}
class Releases {
    constructor(config, emit = () => {}) {
        this.config = config; this.root = config.root; this.sources = config.updateSources || net.UPDATE_SOURCES; this.emit = emit;
    }
    /** 文件系统阶段通常没有可靠总量，定期报告真实处理状态与耗时，不把下载100%沿用为整体完成。 */
    async operation(phase, detail, run) {
        const started = Date.now(); let latest = { indeterminate: true };
        const report = value => {
            latest = { ...latest, ...value };
            this.emit({ phase, detail, ...latest, elapsedSeconds: Math.floor((Date.now() - started) / 1000) });
        };
        report({});
        const timer = setInterval(() => report({}), 1000);
        try { return await run(report); }
        finally { clearInterval(timer); }
    }
    async extract(zip, destination, kind, detail = kind, signal) {
        return this.operation('extracting', detail, report => archive.extractZipSafely(zip, destination, kind, () => true,
            value => { signal?.throwIfAborted(); report(value); }));
    }
    async manifest(signal) {
        let last;
        for (const baseUrl of this.sources) {
            signal?.throwIfAborted();
            try {
                const manifest = await net.json(new URL('manifest.json', baseUrl), signal);
                const components = verifyManifest(manifest, this.config);
                return { manifest, components, baseUrl };
            } catch (error) { last = error; if (signal?.aborted) throw error; }
        }
        throw new Error(`更新源均不可用: ${last?.message}`);
    }
    current() {
        const pointer = files.read(this.root, POINTER);
        const value = pointer || files.read(this.root, 'offline-update-client.json');
        if (!value) return null;
        if (![value.codeVersion, value.dependencyVersion].every(version => Number.isSafeInteger(version) && version > 0) ||
            !/^[a-f0-9]{64}$/.test(value.lockSha256)) throw new Error('当前服务组合身份无效');
        return { ...value, legacyDependencies: pointer ? value.legacyDependencies === true : true, bundled: !pointer };
    }
    async repairLegacy() {
        const pointer = files.read(this.root, POINTER);
        if (!pointer?.legacyDependencies) return;
        const directory = files.safe(this.root, path.join(this.root, `updates/dependencies/dependencies-v${pointer.dependencyVersion}`));
        const marker = files.read(directory, MARKER); const metadata = files.read(directory, 'dependency-manifest.json');
        const marked = marker?.kind === 'dependencies' && marker.version === pointer.dependencyVersion && /^[a-f0-9]{64}$/.test(marker.sha256);
        const packaged = metadata?.version === pointer.dependencyVersion && metadata.lockSha256 === pointer.lockSha256 &&
            fs.existsSync(files.safe(this.root, path.join(directory, 'node_modules/express/package.json')));
        if (marked || packaged) await files.atomic(this.root, POINTER, { ...pointer, legacyDependencies: false });
    }
    context(current = this.current()) {
        if (!current) return null;
        return { ...current, codeRoot: current.bundled ? this.root : files.safe(this.root, path.join(this.root, `updates/code/code-v${current.codeVersion}`)),
            dependenciesRoot: current.legacyDependencies ? this.root : files.safe(this.root, path.join(this.root, `updates/dependencies/dependencies-v${current.dependencyVersion}`)) };
    }
    repairNeeded(repair) {
        if (!repair) return false;
        const state = files.read(this.root, 'data-repair/state.json', {});
        const records = [...(state.appliedRepairs || []), ...(state.includedRepairs || [])];
        return !records.some(item => item.repairId === repair.repairId && item.repairVersion === repair.repairVersion && item.scriptSha256 === repair.scriptSha256) &&
            !((state.latestRepairVersion || 0) > repair.repairVersion && (state.dataVersion || 0) >= repair.targetDataVersion);
    }
    plan(source, fresh = false) {
        const c = source.components; const current = this.current();
        if (fresh && current && !current.pendingHealth) return { current, plan: 'CURRENT', entries: [] };
        if (!fresh && current && (c.code.version < current.codeVersion || c.dependencies.version < current.dependencyVersion)) return { current, plan: 'CURRENT', entries: [] };
        if (current?.pendingHealth) throw new Error('当前候选尚未通过健康检查');
        if (current?.taskCodeVersion && !c.taskCode) throw new Error('不能移除已启用的任务代码组件');
        if (fresh && !c.code.runtimeCompatibility) throw new Error('首装代码缺少运行契约');
        const repair = c.dataRepair;
        if (!fresh && this.repairNeeded(repair)) {
            const state = files.read(this.root, 'data-repair/state.json', { dataVersion: 0 });
            const compatible = repair.compatibleDataVersions || [repair.requiredDataVersion];
            if (c.code.version < repair.requiredCodeVersion || (repair.requiredApkVersionCode || 0) > this.config.apkVersion ||
                !compatible.includes(state.dataVersion || 0)) throw new Error('数据修复所需代码/APK/数据版本不兼容');
        }
        const entries = [];
        if (fresh || !current || current.codeVersion !== c.code.version || current.bundled && (current.dependencyVersion !== c.dependencies.version || (current.taskCodeVersion || null) !== (c.taskCode?.version || null))) entries.push(['code', c.code]);
        if (fresh || !current || current.dependencyVersion !== c.dependencies.version || current.lockSha256 !== c.dependencies.lockSha256) {
            if (c.dependencies.groups) entries.push(...['common', 'android'].map(name => [name, c.dependencies.groups[name]]));
            else entries.push(['dependencies', c.dependencies]);
        }
        if (c.taskCode && (fresh || current?.taskCodeVersion !== c.taskCode.version || current?.taskCodeSha256 !== c.taskCode.sha256)) entries.push(['taskCode', c.taskCode]);
        if (fresh) {
            if (!c.nodeMinSeeds) throw new Error('首装清单缺少初始种子');
            entries.push(['seeds', c.nodeMinSeeds]);
        } else if (this.repairNeeded(c.dataRepair)) entries.push(['dataRepair', { ...c.dataRepair, version: c.dataRepair.repairVersion }]);
        const plan = !entries.length ? 'CURRENT' : fresh || entries.some(([kind]) => ['common', 'android', 'dependencies'].includes(kind)) ? 'ALL' :
            entries.some(([kind]) => kind === 'code') ? 'CODE_ONLY' : entries.some(([kind]) => kind === 'taskCode') ? 'TASK_CODE_ONLY' : 'DATA_REPAIR_ONLY';
        return { current, plan, entries };
    }
    async check(manualRetry = false, signal) {
        const source = await this.manifest(signal);
        const plan = this.plan(source);
        const failed = files.read(this.root, 'updates/failed-release.json');
        if (!manualRetry && failed?.codeVersion === source.components.code.version && failed.dependencyVersion === source.components.dependencies.version &&
            (failed.taskCodeVersion || null) === (source.components.taskCode?.version || null)) return { status: '候选组合此前失败，请手动重试', hasUpdate: false, plan: 'CURRENT' };
        return { status: plan.plan === 'CURRENT' ? '服务已是当前版本' : '发现服务更新', hasUpdate: plan.plan !== 'CURRENT', plan: plan.plan,
            installed: plan.current, targetCodeVersion: source.components.code.version, targetDependencyVersion: source.components.dependencies.version,
            targetTaskCodeVersion: source.components.taskCode?.version, downloadBytes: plan.entries.reduce((sum, [, entry]) => sum + entry.size, 0),
            dataRepair: this.repairNeeded(source.components.dataRepair) ? source.components.dataRepair : null };
    }
    async preview(signal) {
        const source = await this.manifest(signal);
        const plan = this.plan(source, true);
        return { baseUrl: source.baseUrl, signedManifest: JSON.stringify(source.manifest), downloadBytes: plan.entries.reduce((sum, [, entry]) => sum + entry.size, 0) };
    }
    source(preview) {
        if (!this.sources.includes(preview.baseUrl)) throw new Error('首装确认来源无效');
        const manifest = JSON.parse(preview.signedManifest);
        return { manifest, components: verifyManifest(manifest, this.config), baseUrl: preview.baseUrl };
    }
    async fetch(source, kind, entry, signal) {
        const destination = files.safe(this.root, path.join(this.root, `updates/js-downloads/${kind}-v${entry.version}-${entry.sha256}.zip`));
        return net.download(this.root, [source.baseUrl, ...this.sources.filter(value => value !== source.baseUrl)], entry, destination, signal,
            (completedBytes, totalBytes) => this.emit({ phase: 'downloading', completedBytes, totalBytes, detail: kind }));
    }
    async install(stage, kind, entry, sourceDirectory) {
        const directories = { code: 'code/code-v', dependencies: 'dependencies/dependencies-v', taskCode: 'task-code/task-code-v', dataRepair: 'data-repair/data-repair-v' };
        const destination = files.safe(this.root, path.join(this.root, 'updates', directories[kind] + entry.version));
        const old = files.read(destination, MARKER);
        if (fs.existsSync(destination)) {
            identity(destination, kind, entry);
            return destination;
        }
        await files.atomic(sourceDirectory, MARKER, { schemaVersion: 1, kind, version: entry.version, sha256: entry.sha256 });
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.rename(sourceDirectory, destination);
        return destination;
    }
    async validateCode(directory, entry) {
        for (const name of ['package.json', 'package-lock.json', 'src/apps/server/boot/server-app.js']) {
            const file = files.safe(directory, path.join(directory, name));
            if (!fs.statSync(file).isFile()) throw new Error('代码入口缺失');
        }
        if (await files.hash(path.join(directory, 'package-lock.json')) !== entry.requiredLockSha256) throw new Error('代码锁指纹不符');
    }
    async validateTask(directory, entry) {
        const value = files.read(directory, 'task-code-manifest.json', null, 1024 ** 2);
        tasks.validateManifest(value, entry);
        const expected = new Set(['task-code-manifest.json']);
        for (const task of value.tasks) for (const file of task.files) {
            const name = `tasks/${task.taskName}/${file.path}`; expected.add(name);
            if (!await files.matches(directory, path.join(directory, name), file)) throw new Error('任务文件摘要不符');
        }
        for (const file of await files.walk(directory)) if (file.path !== MARKER && !expected.has(file.path)) throw new Error('任务包含未声明文件');
    }
    async dependencies(source, stage, signal) {
        const dep = source.components.dependencies; const destination = path.join(stage, 'dependencies');
        if (!dep.groups) {
            const zip = await this.fetch(source, 'dependencies', dep, signal);
            await this.extract(zip, destination, 'dependencies', 'dependencies', signal);
        } else {
            for (const name of ['common', 'android']) {
                const entry = dep.groups[name];
                if (name === 'android') shared.assertRuntime(entry.target, { android: true, ...(this.config.runtime || {}) });
                const cache = files.safe(this.root, path.join(this.root, `updates/dependency-groups/${name}/dependencies-v${entry.version}-${entry.sha256.slice(0, 12)}`));
                if (!fs.existsSync(cache)) {
                    const zip = await this.fetch(source, name, entry, signal);
                    const layer = path.join(stage, `group-${name}`);
                    await this.extract(zip, layer, 'dependencies', name, signal);
                    const metadata = files.read(layer, 'dependency-group.json');
                    if (metadata?.group !== name || metadata.version !== entry.version || metadata.contentSha256 !== entry.contentSha256 || shared.canonicalJson(metadata.target) !== shared.canonicalJson(entry.target) || await this.operation('verifying', name, () => tree.contentHash(path.join(layer, 'node_modules'))) !== entry.contentSha256) throw new Error('依赖层内容指纹不符');
                    await fs.promises.mkdir(path.dirname(cache), { recursive: true }); await fs.promises.rename(layer, cache);
                }
                const metadata = files.read(cache, 'dependency-group.json');
                if (metadata?.group !== name || metadata.version !== entry.version || metadata.contentSha256 !== entry.contentSha256 ||
                    shared.canonicalJson(metadata.target) !== shared.canonicalJson(entry.target) ||
                    await this.operation('verifying', name, () => tree.contentHash(path.join(cache, 'node_modules'))) !== entry.contentSha256) throw new Error('缓存依赖层已损坏');
                files.space(this.root, (await this.operation('verifying', name, () => files.walk(path.join(cache, 'node_modules')))).reduce((sum, file) => sum + file.size, 0));
                await fs.promises.mkdir(path.join(destination, 'node_modules'), { recursive: true });
                await this.operation('merging', name, () => tree.mergeTree(path.join(cache, 'node_modules'), path.join(destination, 'node_modules')));
            }
            await files.atomic(destination, 'dependency-manifest.json', { version: dep.version, lockSha256: dep.lockSha256, sha256: dep.sha256 });
        }
        const marker = files.read(destination, 'dependency-manifest.json');
        if (marker?.version !== dep.version || marker.lockSha256 !== dep.lockSha256) throw new Error('依赖清单与组合不匹配');
        return this.install(stage, 'dependencies', dep, destination);
    }
    async stageLauncher(source, signal) {
        const entry = source.components.code;
        const destination = files.safe(this.root, path.join(this.root, `updates/code/code-v${entry.version}`));
        const zip = await this.fetch(source, 'code', entry, signal);
        if (!fs.existsSync(destination)) {
            const stage = files.safe(this.root, path.join(this.root, `updates/.launcher-stage-${process.pid}-${Date.now()}`));
            try {
                await this.extract(zip, stage, 'code', 'launcher', signal);
                await this.operation('verifying', 'launcher', () => this.validateCode(stage, entry)); await this.install(stage, 'code', entry, stage);
            } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
        }
        const identity = files.read(destination, MARKER);
        if (identity?.version !== entry.version || identity.sha256 !== entry.sha256 || identity.kind !== 'code') throw new Error('启动器来源目录身份不符');
        const metadata = files.read(destination, 'src/apps/server/boot/offline-launcher/host-api.json');
        if (!metadata) return null; // 旧正式code包仍可由APK内置启动器托管。
        if (metadata.hostApi !== 1 || metadata.stateApi !== 1) throw new Error('请先更新支持此启动器协议的min APK');
        return { version: entry.version, manifest: source.manifest };
    }
    async prepare(source, fresh, signal) {
        signal?.throwIfAborted();
        const { entries, plan, current } = this.plan(source, fresh);
        if (plan === 'CURRENT') return { applied: false, status: '服务已是当前版本' };
        files.space(this.root, entries.reduce((sum, [, entry]) => sum + entry.size, 0));
        const stage = files.safe(this.root, path.join(this.root, `updates/.js-stage-${process.pid}-${Date.now()}`));
        await fs.promises.mkdir(path.dirname(stage), { recursive: true });
        await fs.promises.mkdir(stage, { recursive: false });
        try {
            const c = source.components;
            for (const [kind, entry] of entries.filter(([kind]) => !['common', 'android', 'dependencies'].includes(kind))) {
                signal?.throwIfAborted();
                const zip = await this.fetch(source, kind, entry, signal);
                const directory = path.join(stage, kind);
                await this.extract(zip, directory, kind, kind, signal);
                if (kind === 'code') { await this.operation('verifying', kind, () => this.validateCode(directory, entry)); await this.install(stage, kind, entry, directory); }
                if (kind === 'seeds') await this.operation('restoring', kind, () => restoreSeeds(directory, this.root));
                if (kind === 'taskCode') { await this.operation('verifying', kind, () => this.validateTask(directory, entry)); await this.install(stage, kind, entry, directory); }
                if (kind === 'dataRepair') {
                    if (await files.hash(path.join(directory, 'repair.js')) !== entry.scriptSha256) throw new Error('修复脚本摘要不符');
                    await this.install(stage, kind, entry, directory);
                    await files.atomic(this.root, 'data-repair/pending-repair.json', { ...entry, format: 'aasc-offline-data-repair', schemaVersion: 1,
                        script: `updates/data-repair/data-repair-v${entry.repairVersion}/repair.js` });
                }
            }
            if (entries.some(([kind]) => ['common', 'android', 'dependencies'].includes(kind))) await this.dependencies(source, stage, signal);
            const legacy = current?.legacyDependencies === true && current.dependencyVersion === c.dependencies.version;
            const codeDirectory = plan === 'DATA_REPAIR_ONLY' && current?.bundled ? this.root : path.join(this.root, `updates/code/code-v${c.code.version}`);
            if (codeDirectory !== this.root) identity(codeDirectory, 'code', c.code);
            await this.operation('verifying', 'code', () => this.validateCode(codeDirectory, c.code));
            const dependencyDirectory = legacy ? this.root : path.join(this.root, `updates/dependencies/dependencies-v${c.dependencies.version}`);
            if (!legacy) identity(dependencyDirectory, 'dependencies', c.dependencies);
            await this.operation('verifying', 'dependencies', () => validateLock(dependencyDirectory, codeDirectory));
            if (c.taskCode) {
                const directory = path.join(this.root, `updates/task-code/task-code-v${c.taskCode.version}`);
                identity(directory, 'taskCode', c.taskCode); await this.operation('verifying', 'taskCode', () => this.validateTask(directory, c.taskCode));
            }
            signal?.throwIfAborted();
            const pointer = { schemaVersion: 1, codeVersion: c.code.version, dependencyVersion: c.dependencies.version, lockSha256: c.dependencies.lockSha256,
                taskCodeVersion: c.taskCode?.version || null, taskCodeSha256: c.taskCode?.sha256 || null, legacyDependencies: !!legacy,
                pendingHealth: true, previous: current ? { ...current, previous: undefined } : null, previousLegacyDependencies: current?.legacyDependencies === true };
            if (plan !== 'DATA_REPAIR_ONLY') await files.atomic(this.root, POINTER, pointer);
            return { applied: true, status: '服务文件已准备，等待健康检查', pointer: plan === 'DATA_REPAIR_ONLY' ? current : pointer, source };
        } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
    }
    async rollback() {
        const current = files.read(this.root, POINTER);
        if (!current?.pendingHealth) return;
        await files.atomic(this.root, 'updates/failed-release.json', { ...current, previous: undefined });
        if (current.previous && !current.previous.bundled) await files.atomic(this.root, POINTER, { ...current.previous, pendingHealth: false, previous: null });
        else await fs.promises.rm(files.safe(this.root, path.join(this.root, POINTER)), { force: true });
    }
    async healthy() {
        const current = files.read(this.root, POINTER);
        if (current?.pendingHealth) await files.atomic(this.root, POINTER, { ...current, pendingHealth: false, previous: null });
        await files.atomic(this.root, 'updates/bootstrap-state.json', { phase: 'ready', standalone: this.config.updateOnly === true });
        // 清理失败只记录可重试错误，不回滚已健康提交的服务。
        const errors = await require('./cleanup').cleanup(this.root).catch(error => [error.message]);
        if (errors.length) console.error('版本清理待重试:', errors.join('; '));
    }
}
module.exports = { validateLock, identity, Releases, verifyManifest, artifact, POINTER, MARKER };
