'use strict';

const fs = require('node:fs');
const path = require('node:path');
const shared = require('./shared-update-manifest');
const archive = require('./update-archive');
const { assertNoLinks } = require('./dependency-tree');
const feed = require('./main-server-update-feed');
const closure = require('./dependency-closure');

// 与现有Offline启动器使用同一环境变量及LAN/WAN镜像地址，不新增远端配置通道。
const DEFAULT_SOURCES = Object.freeze(['http://192.168.1.39/mnt/aasc-offline/',
    'http://10.221.70.87/mnt/aasc-offline/', 'http://120.79.245.103/mnt/aasc-offline/']);

function resolveSources(values) {
    const configured = process.env.AASC_OFFLINE_UPDATE_BASE_URLS;
    const inputs = values || (configured ? configured.split(',').map(value => value.trim()).filter(Boolean) : DEFAULT_SOURCES);
    const sources = [...new Set(inputs.map(value => {
        const url = new URL(value.endsWith('/') ? value : `${value}/`);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error('任务依赖更新源必须是HTTP/HTTPS目录地址');
        }
        return url.href;
    }))];
    if (!sources.length) throw new Error('任务依赖更新源为空');
    return sources;
}

/** 只在任务执行前准备已注册的资源包，独立缓存不改变基础依赖和更新回滚指针。 */
class TaskDependencyManager {
    constructor(options = {}) {
        this.projectRoot = path.resolve(options.projectRoot || process.cwd());
        this.codeRoot = path.resolve(options.codeRoot || this.projectRoot);
        this.nodeModulesRoot = path.resolve(options.nodeModulesRoot || path.join(this.projectRoot, 'node_modules'));
        this.cacheRoot = path.join(this.projectRoot, 'updates/task-dependencies');
        this.publicKeyPem = options.publicKeyPem || shared.PUBLIC_KEY;
        this.options = options;
        this.ready = new Map();
        this.pending = new Map();
    }

    expectedVersion(id) {
        if (!Object.hasOwn(shared.TASK_DEPENDENCIES, id)) throw new Error(`未注册的任务依赖：${id}`);
        const lock = JSON.parse(fs.readFileSync(path.join(this.codeRoot, 'package-lock.json'), 'utf8'));
        const version = lock.packages?.[`node_modules/${shared.TASK_DEPENDENCIES[id].packagePath}`]?.version;
        if (!version) throw new Error(`当前代码锁未声明任务依赖：${id}`);
        return version;
    }

    localPackage(id) {
        if (shared.TASK_DEPENDENCIES[id].targetName) {
            try {
                const versions = {};
                const lock = JSON.parse(fs.readFileSync(path.join(this.codeRoot, 'package-lock.json'), 'utf8'));
                for (const key of closure.dependencyClosure(lock, closure.PI_PACKAGES)) {
                    const file = path.join(this.nodeModulesRoot, key.slice('node_modules/'.length), 'package.json');
                    assertNoLinks(this.nodeModulesRoot, file);
                    if (fs.existsSync(file)) versions[key] = JSON.parse(fs.readFileSync(file, 'utf8')).version;
                }
                this.verifyPiPackages(this.nodeModulesRoot, versions);
                return path.join(this.nodeModulesRoot, shared.TASK_DEPENDENCIES[id].packagePath);
            } catch (error) {
                if (error.message.includes('链接') || error.message.includes('越界')) throw error;
                return null;
            }
        }
        const directory = path.join(this.nodeModulesRoot, shared.TASK_DEPENDENCIES[id].packagePath);
        assertNoLinks(this.nodeModulesRoot, directory);
        assertNoLinks(this.nodeModulesRoot, path.join(directory, 'package.json'));
        assertNoLinks(this.nodeModulesRoot, path.join(directory, 'dist/ort.webgpu.min.js'));
        try {
            const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
            if (metadata.name === id && metadata.version === this.expectedVersion(id) &&
                fs.statSync(path.join(directory, 'dist/ort.webgpu.min.js')).isFile()) return directory;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        return null;
    }

    assetDirectory(id) {
        // 静态请求只读取已准备的目录，不偷偷触发下载；首屏不需要网络包准备。
        const directory = this.ready.get(id) || this.localPackage(id);
        if (!directory) return null;
        assertNoLinks(directory === path.join(this.nodeModulesRoot, shared.TASK_DEPENDENCIES[id].packagePath) ? this.nodeModulesRoot : this.cacheRoot, directory);
        return path.join(directory, 'dist');
    }

    piDependencyId() {
        return `pi-agent-${shared.selectTarget(this.options.runtime || {})}`;
    }

    moduleRoot(id) {
        const directory = this.ready.get(id) || this.localPackage(id);
        if (!directory) throw new Error(`依赖尚未准备：${id}`);
        return path.resolve(directory, ...shared.TASK_DEPENDENCIES[id].packagePath.split('/').map(() => '..'));
    }

    async isReady(id) {
        this.expectedVersion(id);
        if (shared.TASK_DEPENDENCIES[id].targetName) shared.assertRuntime(shared.TARGETS[shared.TASK_DEPENDENCIES[id].targetName], this.options.runtime || {});
        const directory = this.localPackage(id) || await this.cachedPackage(id);
        if (!directory) return false;
        this.ready.set(id, directory);
        return true;
    }

    /** SDK缓存必须包含代码锁允许的完整依赖；不借用进程全局node_modules填补缺包。 */
    verifyPiPackages(modules, versions) {
        const lock = JSON.parse(fs.readFileSync(path.join(this.codeRoot, 'package-lock.json'), 'utf8'));
        const keys = closure.dependencyClosure(lock, closure.PI_PACKAGES);
        for (const name of closure.PI_PACKAGES) {
            if (!versions[`node_modules/${name}`]) throw new Error('Pi依赖缺少根SDK');
        }
        for (const [key, version] of Object.entries(versions)) {
            if (!keys.has(key) || version !== lock.packages[key]?.version) throw new Error(`Pi依赖版本与代码锁不符：${key}`);
            const file = path.join(modules, key.slice('node_modules/'.length), 'package.json');
            assertNoLinks(modules, file);
            const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (metadata.version !== version) throw new Error(`Pi真实依赖版本不符：${key}`);
            for (const name of Object.keys(metadata.dependencies || {})) {
                if (!metadata.optionalDependencies?.[name] && !closure.resolveLockedPackage(versions, key, name)) {
                    throw new Error(`Pi缓存缺少必需依赖：${key}/${name}`);
                }
            }
        }
        for (const name of closure.PI_PACKAGES) {
            const file = path.join(modules, name, 'dist/index.js');
            assertNoLinks(modules, file);
            if (!fs.statSync(file).isFile()) throw new Error('Pi依赖缺少SDK入口');
        }
    }

    async ensure(ids, onProgress = () => {}) {
        if (!Array.isArray(ids)) throw new Error('任务dependencies必须为依赖ID数组');
        for (const id of new Set(ids)) {
            this.expectedVersion(id);
            if (shared.TASK_DEPENDENCIES[id].targetName) shared.assertRuntime(shared.TARGETS[shared.TASK_DEPENDENCIES[id].targetName], this.options.runtime || {});
            let pending = this.pending.get(id);
            if (!pending) {
                pending = { listeners: new Set() };
                pending.listeners.add(onProgress);
                let lastPercent = -1;
                const notify = progress => {
                    if (!progress.message && progress.percent === lastPercent) return;
                    lastPercent = progress.percent;
                    for (const listener of pending.listeners) listener({ id, ...progress });
                };
                // 先登记Promise再执行准备，多个任务只产生一次下载和原子落盘。
                pending.promise = Promise.resolve().then(() => this.prepare(id, notify));
                this.pending.set(id, pending);
            } else pending.listeners.add(onProgress);
            try { await pending.promise; }
            catch (error) { this.ready.delete(id); throw error; }
            finally {
                pending.listeners.delete(onProgress);
                if (!pending.listeners.size && this.pending.get(id) === pending) this.pending.delete(id);
            }
        }
    }

    async verifyLayer(directory, id, entry) {
        const definition = shared.TASK_DEPENDENCIES[id];
        assertNoLinks(this.cacheRoot, directory);
        const names = await fs.promises.readdir(directory);
        if (names.some(name => !['node_modules', 'dependency-group.json', 'signed-manifest.json'].includes(name))) {
            throw new Error('任务依赖缓存包含非组件文件');
        }
        for (const name of names) assertNoLinks(this.cacheRoot, path.join(directory, name));
        const modules = path.join(directory, 'node_modules');
        const packages = await fs.promises.readdir(modules);
        if (!definition.targetName && (packages.length !== 1 || packages[0] !== definition.packagePath)) throw new Error('任务依赖包包含其他生产包');
        const metadata = JSON.parse(await fs.promises.readFile(path.join(directory, 'dependency-group.json'), 'utf8'));
        const expected = { group: definition.directory, version: entry.version, contentSha256: entry.contentSha256,
            target: entry.target, packageName: id, packageVersion: entry.packageVersion,
            ...(definition.targetName ? { packageVersions: entry.packageVersions } : {}) };
        if (shared.canonicalJson(metadata) !== shared.canonicalJson(expected)) throw new Error('任务依赖组元数据不匹配');
        if (await archive.contentHash(modules) !== entry.contentSha256) throw new Error('任务依赖实际内容指纹不匹配');
        const root = path.join(modules, definition.packagePath);
        const packageJson = JSON.parse(await fs.promises.readFile(path.join(root, 'package.json'), 'utf8'));
        if (packageJson.name !== (definition.packageName || id) || packageJson.version !== entry.packageVersion || entry.packageVersion !== this.expectedVersion(id)) {
            throw new Error('任务依赖真实包版本与代码锁不匹配');
        }
        if (definition.targetName) {
            shared.assertRuntime(entry.target, this.options.runtime || {});
            this.verifyPiPackages(modules, entry.packageVersions);
            const keys = new Set(Object.keys(entry.packageVersions));
            for (const file of await archive.treeFiles(modules)) {
                if (!closure.packageOwnerKey(file.path, keys)) throw new Error('Pi缓存包含未声明的生产文件');
            }
        } else if (!(await fs.promises.stat(path.join(root, 'dist/ort.webgpu.min.js'))).isFile()) throw new Error('任务依赖缺少WebGPU入口');
        return root;
    }

    async cachedPackage(id) {
        const root = path.join(this.cacheRoot, id);
        assertNoLinks(this.projectRoot, root);
        const names = await fs.promises.readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        for (const name of names.sort().reverse()) {
            if (!/^dependencies-v[1-9][0-9]*-[a-f0-9]{12}$/.test(name)) continue;
            const directory = path.join(root, name);
            assertNoLinks(this.cacheRoot, path.join(directory, 'signed-manifest.json'));
            const manifest = JSON.parse(await fs.promises.readFile(path.join(directory, 'signed-manifest.json'), 'utf8'));
            shared.verifyManifest(manifest, this.publicKeyPem);
            const entry = manifest.payload.components.taskDependencies?.[id];
            if (!entry || entry.packageVersion !== this.expectedVersion(id)) continue;
            if (entry.packageVersions) {
                const lock = JSON.parse(fs.readFileSync(path.join(this.codeRoot, 'package-lock.json'), 'utf8'));
                if (Object.entries(entry.packageVersions).some(([key, version]) => lock.packages?.[key]?.version !== version)) continue;
            }
            if (name !== `dependencies-v${entry.version}-${entry.sha256.slice(0, 12)}`) throw new Error('任务依赖缓存目录与签名版本不匹配');
            return this.verifyLayer(directory, id, entry);
        }
        return null;
    }

    async prepare(id, notify) {
        const local = this.localPackage(id);
        if (local) { this.ready.set(id, local); notify({ percent: 100, message: `任务依赖 ${id} 已在本机就绪` }); return; }
        const cached = await this.cachedPackage(id);
        if (cached) { this.ready.set(id, cached); notify({ percent: 100, message: `复用已校验任务依赖 ${id}` }); return; }
        notify({ percent: 0, message: `正在准备任务依赖 ${id}，首次执行需要下载` });
        const errors = [];
        for (const baseUrl of resolveSources(this.options.baseUrls)) {
            let staging;
            try {
                const manifest = await (this.options.requestJson || feed.requestJson)(new URL('manifest.json', baseUrl).href);
                shared.verifyManifest(manifest, this.publicKeyPem);
                const entry = manifest.payload.components.taskDependencies?.[id];
                if (!entry || entry.packageVersion !== this.expectedVersion(id)) throw new Error(`更新源缺少与当前代码兼容的任务依赖 ${id}`);
                if (entry.target) shared.assertRuntime(entry.target, this.options.runtime || {});
                const root = path.join(this.cacheRoot, id);
                assertNoLinks(this.projectRoot, root);
                await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
                staging = await fs.promises.mkdtemp(path.join(root, '.staging-'));
                const zip = path.join(staging, 'download.zip');
                await feed.downloadCode({ ...entry, downloadUrl: new URL(entry.relativeUrl, baseUrl).href }, zip,
                    { download: this.options.download, onProgress: (received, total) => notify({ percent: Math.floor(received / total * 90) }) });
                const layer = path.join(staging, 'layer');
                await archive.extractZip(zip, layer, 'dependencies');
                await this.verifyLayer(layer, id, entry);
                await fs.promises.writeFile(path.join(layer, 'signed-manifest.json'), `${JSON.stringify(manifest)}\n`, { flag: 'wx' });
                const destination = path.join(root, `dependencies-v${entry.version}-${entry.sha256.slice(0, 12)}`);
                assertNoLinks(this.projectRoot, destination);
                // 独立进程若已先完成同版本，仅复用完整验收的缓存，不覆盖现有目录。
                if (fs.existsSync(destination)) await this.verifyLayer(destination, id, entry);
                else await fs.promises.rename(layer, destination);
                this.ready.set(id, path.join(destination, 'node_modules', shared.TASK_DEPENDENCIES[id].packagePath));
                notify({ percent: 100, message: `任务依赖 ${id} 下载并校验完成` });
                return;
            } catch (error) { errors.push(`${baseUrl}: ${error.message}`); }
            finally {
                // 只删除本次mkdtemp生成的唯一暂存目录，不清理任何已保存依赖或用户数据。
                if (staging) await fs.promises.rm(staging, { recursive: true, force: true });
            }
        }
        throw new Error(`任务依赖 ${id} 准备失败：${errors.join('；')}`);
    }
}

module.exports = { TaskDependencyManager, resolveSources };
