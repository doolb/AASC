'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./files');
const net = require('./network');

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function validateCatalog(catalog) {
    if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.models) || !catalog.models.length) throw new Error('模型可信目录无效');
    const ids = new Set();
    for (const model of catalog.models) {
        if (!NAME.test(model.modelId) || ids.has(model.modelId) || typeof model.revision !== 'string' || !model.revision || !Array.isArray(model.files) || !model.files.length) throw new Error('模型定义无效');
        ids.add(model.modelId); const names = new Set(); let bytes = 0;
        for (const file of model.files) {
            if (!NAME.test(file.name) || names.has(file.name) || typeof file.path !== 'string' || file.path.split('/').some(value => !NAME.test(value)) ||
                file.path.split('/').at(-1) !== file.name || !Number.isSafeInteger(file.size) || file.size < 1 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('模型文件定义无效');
            names.add(file.name); bytes += file.size;
        }
        if (!Number.isSafeInteger(bytes) || bytes !== model.totalBytes) throw new Error('模型大小不一致');
    }
    return catalog;
}
class Models {
    constructor(config, emit = () => {}) {
        this.config = config; this.root = path.dirname(config.root); this.emit = emit; this.jobs = new Map();
        this.catalog = validateCatalog(JSON.parse(fs.readFileSync(config.catalogPath, 'utf8')));
        this.sources = config.modelSources || net.MODEL_SOURCES;
    }
    definition(id) {
        const model = this.catalog.models.find(value => value.modelId === id);
        if (!model) throw new Error('未声明的本机模型'); return model;
    }
    directories(id) {
        this.definition(id);
        const relative = ['tts', 'sensevoice', 'voiceprint'].includes(id) ? [`aasc-server/res/models/${id}`, `models/${id}`] : [`models/llm/bundled/${id}`, `models/llm/${id}`];
        return relative.map(name => files.safe(this.root, path.join(this.root, name)));
    }
    present(directory, model) {
        try {
            files.safe(this.root, directory);
            return model.files.every(entry => { const stat = fs.lstatSync(files.safe(this.root, path.join(directory, entry.name))); return stat.isFile() && stat.size === entry.size; });
        } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }
    stamp(directory, model) {
        try {
            if (!this.present(directory, model)) return false;
            const value = files.read(directory, '.offline-model-verified.json');
            return value?.modelId === model.modelId && value.revision === model.revision && value.files?.length === model.files.length && model.files.every((entry, index) => {
                const actual = value.files[index]; const stat = fs.statSync(path.join(directory, entry.name));
                return actual.name === entry.name && actual.sha256 === entry.sha256 && actual.size === entry.size && actual.mtime === Math.trunc(stat.mtimeMs);
            });
        } catch (error) { return false; }
    }
    locate(id) {
        const model = this.definition(id); const dirs = this.directories(id);
        return dirs.find(dir => this.stamp(dir, model)) || dirs.find(dir => this.present(dir, model)) || dirs.at(-1);
    }
    status() {
        return this.catalog.models.map(model => ({ modelId: model.modelId, revision: model.revision, totalBytes: model.totalBytes,
            directory: this.locate(model.modelId), filesPresent: this.directories(model.modelId).some(dir => this.present(dir, model)),
            filesReady: this.directories(model.modelId).some(dir => this.stamp(dir, model)), downloading: this.jobs.has(model.modelId) }));
    }
    groups() {
        const ids = new Set(this.catalog.models.map(model => model.modelId));
        const voice = [{ id: 'voice-tts', title: 'TTS', modelIds: ['tts'], defaultSelected: true },
            { id: 'voice-asr', title: 'ASR/声纹', modelIds: ['sensevoice', 'voiceprint'], defaultSelected: true }]
            .map(group => ({ ...group, modelIds: group.modelIds.filter(id => ids.has(id)) })).filter(group => group.modelIds.length);
        const grouped = new Set(voice.flatMap(group => group.modelIds));
        return voice.concat(this.catalog.models.filter(model => !grouped.has(model.modelId)).map(model => ({ id: model.modelId, title: model.modelId, modelIds: [model.modelId], defaultSelected: false })));
    }
    async verify(directory, model) {
        if (this.stamp(directory, model)) return directory;
        if (!this.present(directory, model)) throw new Error('本机模型不完整，请从本机模型准备');
        for (const entry of model.files) if (!await files.matches(this.root, path.join(directory, entry.name), entry)) throw new Error('本机模型摘要不匹配');
        await files.atomic(directory, '.offline-model-verified.json', { modelId: model.modelId, revision: model.revision,
            files: model.files.map(entry => ({ name: entry.name, sha256: entry.sha256, size: entry.size, mtime: Math.trunc(fs.statSync(path.join(directory, entry.name)).mtimeMs) })) });
        return directory;
    }
    async require(id) {
        const model = this.definition(id);
        for (const dir of this.directories(id).sort((a, b) => Number(this.stamp(b, model)) - Number(this.stamp(a, model)))) {
            if (!this.present(dir, model)) continue;
            try { return await this.verify(dir, model); } catch (error) { /* 坏旧缓存不阻断另一份完整缓存。 */ }
        }
        throw new Error('模型未准备或校验失败，请从本机模型入口准备');
    }
    cancel(id) { this.definition(id); this.jobs.get(id)?.abort.abort(new Error('已取消模型准备')); }
    async recover(id) {
        const target = this.directories(id).at(-1); const parent = path.dirname(target);
        if (!fs.existsSync(parent)) return;
        const backups = (await fs.promises.readdir(parent)).filter(name => new RegExp(`^\\.model-backup-${id}-[0-9]+$`).test(name));
        if (!fs.existsSync(target) && backups.length) await fs.promises.rename(files.safe(this.root, path.join(parent, backups.sort((a, b) => fs.statSync(path.join(parent, a)).mtimeMs - fs.statSync(path.join(parent, b)).mtimeMs).at(-1))), target);
    }
    async prepare(id, allowDownload = true, progress = () => {}) {
        const existing = this.jobs.get(id);
        if (existing) { existing.listeners.add(progress); return existing.promise; }
        const model = this.definition(id); const abort = new AbortController();
        const job = { abort, listeners: new Set([progress]), promise: null };
        // 在第一次await前注册，合并同模型并发请求；取消令牌覆盖全部等待者。
        this.jobs.set(id, job);
        job.promise = this.prepareOne(model, allowDownload, abort.signal, value => { for (const callback of job.listeners) callback(value); })
            .finally(() => this.jobs.delete(id));
        return job.promise;
    }
    async prepareOne(model, allowDownload, signal, progress) {
        const id = model.modelId; await this.recover(id);
        try { return await this.require(id); } catch (error) { signal.throwIfAborted(); }
        if (!allowDownload) throw new Error('本机模型缺失或损坏，需要重新确认下载');
        const target = this.directories(id).at(-1); const parent = path.dirname(target);
        await fs.promises.mkdir(parent, { recursive: true }); files.space(this.root, model.totalBytes, 64 * 1024 ** 2);
        let source; let last;
        for (const base of this.sources) {
            signal.throwIfAborted();
            try {
                const manifest = await net.json(new URL('manifest.json', base), signal);
                if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !model.files.every(file => manifest.files.filter(row =>
                    row.path === file.path && row.size === file.size && row.sha256 === file.sha256).length === 1)) throw new Error('模型源尚未提供可信文件集合');
                source = base; break;
            } catch (error) { last = error; if (signal.aborted) throw error; }
        }
        if (!source) throw new Error('模型源不可用: ' + last?.message);
        const stage = files.safe(this.root, path.join(parent, `.model-${id}-${Date.now()}`));
        const backup = files.safe(this.root, path.join(parent, `.model-backup-${id}-${Date.now()}`));
        await fs.promises.mkdir(stage); let completed = 0;
        try {
            for (const entry of model.files) {
                signal.throwIfAborted();
                await net.download(this.root, [source, ...this.sources.filter(base => base !== source)], { ...entry, relativeUrl: entry.path }, path.join(stage, entry.name), signal,
                    bytes => progress(Math.min(99, Math.floor((completed + bytes) * 100 / model.totalBytes))));
                completed += entry.size;
            }
            if (id === 'sensevoice') for (const entry of model.files) await fs.promises.writeFile(path.join(stage, `${entry.name}.sha256`), entry.sha256 + '\n');
            if (id === 'tts') await files.atomic(stage, 'manifest.json', model.files.map(({ name, sha256 }) => ({ name, sha256 })));
            await this.verify(stage, model); signal.throwIfAborted();
            if (fs.existsSync(target)) await fs.promises.rename(target, backup);
            await fs.promises.rename(stage, target);
            await fs.promises.rm(backup, { recursive: true, force: true });
            progress(100); return target;
        } catch (error) {
            if (!fs.existsSync(target) && fs.existsSync(backup)) await fs.promises.rename(backup, target);
            throw error;
        } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
    }
}
module.exports = { Models, validateCatalog };
