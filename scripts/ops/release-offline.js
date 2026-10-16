'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createReadStream, constants } = require('node:fs');
const { loadOfflineUpdateKeyPair, loadOfflineUpdatePublicKey } = require('./offline-update-signing');
const { verifySignedManifest, validateManifestComponents, canonicalJson } = require('./offline-update-package');
const { validateFullApkManifest, readFullApkManifest } = require('./offline-full-apk-manifest');
const { stageVoiceDisplayNodePackage } = require('./voice-display-node-package');
const { publishVoiceDisplayNodePackage } = require('./publish-voice-display-node');
const { readSignerSha256 } = require('./offline-min-apk-package');
const { readGitSourceMetadata } = require('./git-source-metadata');
const { collectFreshCleanup, cleanupFreshRelease, preparePendingRebuild } = require('./offline-release-cleanup');
const { publishOfflineUpdate, publishOfflineFullApk, assertRemoteTarget, buildRemoteShellArguments,
    DEFAULT_LOCAL_ROOT, DEFAULT_LOCAL_VERIFY_URL, DEFAULT_WAN_VERIFY_URL } = require('./publish-offline-update');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '../..');
const KINDS = Object.freeze(['min', 'code', 'deps', 'task', 'node', 'full']);
const STATUS_FIELDS = Object.freeze({ min: 'minApk', code: 'servicePackage', deps: 'dependenciesPackage',
    task: 'taskCodePackage', node: 'voiceDisplayNodePackage' });
const PROFILE_NAMES = Object.freeze({ min: 'allserver-min', full: 'allserver' });
const VERSION_RESERVATIONS = '.release-offline-versions.json';
const HELP = `Offline 自动出包与发布

npm run release:offline -- [参数]
  无参数                         自动恢复最近未完成任务，否则按状态出包
  --only=min,code,deps,task,node,full  手动指定种类，可单选或组合
  --only=all                     显式构建全部六种，包括完整 APK
  --publish                      出包后发布 LAN/WAN，校验并精确清理
  --dry-run                      仅输出计划，不升版、不写文件、不加载私钥
  --resume=报告路径               复用完成项，仅补建未完成项
  --resume                       自动识别最近可恢复报告，不需填写路径
  --resume=报告路径 --publish     原号补完构建后发布，不递增版本
  --fresh                        清理旧报告及未发布APK/ZIP，复用原号重建
  --new                          跳过自动恢复，递增版本创建新任务
  --manifest-file=签名清单        指定构建基线（默认 LAN，并检查 WAN）
  --output-dir=目录              产物/报告目录，默认 release/offline-update/output
  --local-root=目录              LAN 发布根，默认 /mnt/aasc-offline
  --remote-dir=目录              WAN 发布根，默认 /home/as/a/aasc-offline
  --local-verify-url=URL          LAN HTTP 校验根
  --remote-verify-url=URL         WAN HTTP 校验根
  --dependency-roots=JSON文件    复用依赖构建器的多平台依赖目录映射
  --node-abi=数字                 指定依赖构建器的 Node ABI
  --help                         显示帮助

deps 会联动 code；code 检测到锁文件变化也会联动 deps。
full 仅在 --only 显式指定时构建；不清除 min APK 待出包标记。
退出码：0 成功/无需出包；1 失败（含发布或清理待重试）。报告位于输出目录 releases/。
`;

function parseArguments(argv) {
    const flags = new Set(['publish', 'dry-run', 'help', 'fresh', 'new']);
    const values = new Set(['only', 'resume', 'manifest-file', 'output-dir', 'local-root', 'remote-dir',
        'local-verify-url', 'remote-verify-url', 'dependency-roots', 'node-abi']);
    const options = {};
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`不支持的位置参数: ${token}`);
        const equal = token.indexOf('=');
        const key = equal < 0 ? token.slice(2) : token.slice(2, equal);
        if (!flags.has(key) && !values.has(key)) throw new Error(`未知参数: --${key}`);
        const field = key.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
        if (Object.hasOwn(options, field)) throw new Error(`重复参数: --${key}`);
        if (flags.has(key)) {
            if (equal >= 0) throw new Error(`--${key} 不接收值`);
            options[field] = true;
            continue;
        }
        if (key === 'resume' && equal < 0 && (!argv[index + 1] || argv[index + 1].startsWith('--'))) {
            options.resume = 'auto';
            continue;
        }
        const value = equal < 0 ? argv[++index] : token.slice(equal + 1);
        if (!value || value.startsWith('--')) throw new Error(`--${key} 缺少值`);
        options[field] = value;
    }
    if (options.only !== undefined) {
        options.only = options.only.split(',').map(value => value.trim());
        if (options.only.length === 1 && options.only[0] === 'all') options.only = [...KINDS];
        if (options.only.some(kind => !KINDS.includes(kind)) || new Set(options.only).size !== options.only.length) {
            throw new Error('--only 只允许 min,code,deps,task,node,full 或单独 all，且不能重复');
        }
    }
    if (options.resume && (options.only || options.manifestFile || options.fresh || options.new)) {
        throw new Error('--resume 不能与 --only/--manifest-file/--fresh/--new 混用');
    }
    if (options.fresh && options.new) throw new Error('--fresh 原号重建与 --new 递增版本不能同时使用');
    if (options.nodeAbi && !/^[1-9][0-9]{0,4}$/u.test(options.nodeAbi)) throw new Error('--node-abi 必须为有效的正整数 ABI');
    return options;
}

async function readJson(file) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`输入必须是普通文件: ${file}`);
    return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function optionalJson(file) {
    try { return await readJson(file); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    try {
        const existing = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error(`拒绝覆盖非普通文件: ${file}`);
        await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
}

async function hashFile(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

async function describeFile(file) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`产物必须是普通文件: ${file}`);
    return { path: path.resolve(file), size: stat.size, sha256: await hashFile(file) };
}

function targetOptions(options) {
    const result = {
        localRoot: path.resolve(options.localRoot || DEFAULT_LOCAL_ROOT),
        remote: { host: 'as@120.79.245.103', directory: options.remoteDir || '/home/as/a/aasc-offline' },
        localVerifyUrl: options.localVerifyUrl || DEFAULT_LOCAL_VERIFY_URL,
        remoteVerifyUrl: options.remoteVerifyUrl || DEFAULT_WAN_VERIFY_URL
    };
    assertRemoteTarget(result.remote);
    for (const value of [result.localVerifyUrl, result.remoteVerifyUrl]) {
        if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error('校验地址必须是 HTTP/HTTPS');
    }
    return result;
}

async function fetchManifest(base) {
    const response = await fetch(new URL('manifest.json', base), { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`无法读取发布源清单: ${base} HTTP ${response.status}`);
    return response.json();
}

function validateBaseline(manifest, publicKeyPem) {
    verifySignedManifest(manifest, publicKeyPem);
    validateManifestComponents(manifest);
    return manifest;
}

/** 只扫描明确的版本目录与普通文件；符号链接不作为版本占用依据。 */
async function scanVersions(root, versions) {
    const reservations = await optionalJson(path.join(root, VERSION_RESERVATIONS));
    if (reservations) {
        if (reservations.schemaVersion !== 1 || !reservations.maximum) throw new Error('版本预留记录格式无效');
        for (const kind of Object.keys(versions)) versions[kind] = Math.max(versions[kind], safeVersion(reservations.maximum[kind] || 0));
    }
    const rules = [
        [/^code-v(\d+)\.zip$/u, 'code'], [/^manifest-code-v(\d+)\.json$/u, 'code'],
        [/^dependencies-v(\d+)\.zip$/u, 'deps'], [/^task-code-v(\d+)\.zip$/u, 'task'],
        [/^manifest-task-code-v(\d+)\.json$/u, 'task'], [/^voice-display-node-v(\d+)\.(zip|json)$/u, 'node'],
        [/^aasc-display-offline(?:-min)?-v(\d+)\.apk$/u, 'apk'], [/^manifest-apk-min-v(\d+)\.json$/u, 'apk']
    ];
    const allowed = new Set(['code', 'dependencies', 'task-code', 'apk', 'voice-display-node', 'manifests', 'releases']);
    const visit = async (directory, depth) => {
        const stat = await fs.lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!stat) return;
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`版本扫描目录不是普通目录: ${directory}`);
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            if (entry.isFile()) {
                if (path.basename(directory) === 'releases' && entry.name === entry.name.trim() && /^release-[0-9TZ]+-[0-9]+\.json$/u.test(entry.name)) {
                    const report = await readJson(path.join(directory, entry.name));
                    // 报告已分配的编号也算占用，避免归档尚未生成时中断后重用编号。
                    if (report.schemaVersion === 1 && report.plan?.versions) {
                        for (const [kind, version] of Object.entries(report.plan.versions)) {
                            const target = ['min', 'full'].includes(kind) ? 'apk' : kind;
                            if (Object.hasOwn(versions, target)) versions[target] = Math.max(versions[target], safeVersion(version));
                        }
                    }
                }
                for (const [pattern, kind] of rules) {
                    const match = entry.name.match(pattern);
                    if (match) versions[kind] = Math.max(versions[kind], safeVersion(Number(match[1])));
                }
            }
            if (entry.isDirectory() && depth < 2 && (depth > 0 || allowed.has(entry.name))) {
                await visit(path.join(directory, entry.name), depth + 1);
            }
        }
    };
    await visit(root, 0);
}

function safeVersion(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`无效版本号: ${value}`);
    return value;
}

async function createPlan(options = {}) {
    const projectRoot = options.projectRoot || ROOT;
    const targets = targetOptions(options);
    const artifactRoot = path.resolve(options.outputDir || path.join(projectRoot, 'release/offline-update/output'));
    if (artifactRoot === path.parse(artifactRoot).root) throw new Error('产物根目录不能是文件系统根目录');
    const statusPath = path.join(projectRoot, 'release/offline-release-status.json');
    const status = await readJson(statusPath);
    for (const field of Object.values(STATUS_FIELDS)) {
        if (typeof status[field] !== 'boolean') throw new Error(`待出包状态必须为布尔值: ${field}`);
    }
    const requested = options.only || Object.keys(STATUS_FIELDS).filter(kind => status[STATUS_FIELDS[kind]]);
    if (!requested.length && !options.fresh) return { requested, selected: [], reasons: [], artifactRoot, targets, projectRoot, statusPath };
    const { publicKeyPem } = await loadOfflineUpdatePublicKey();
    const baselinePath = path.resolve(options.manifestFile || path.join(targets.localRoot, 'manifest.json'));
    const baseline = validateBaseline(options.baseline || await readJson(baselinePath), publicKeyPem);
    const baselines = [baseline];
    if (!options.manifestFile) baselines.push(validateBaseline(await fetchManifest(targets.remoteVerifyUrl), publicKeyPem));
    const selected = new Set(requested);
    const reasons = [];
    const lockSha256 = await hashFile(path.join(projectRoot, 'package-lock.json'));
    if (selected.has('deps') && !selected.has('code')) {
        selected.add('code'); reasons.push('依赖版本绑定服务代码，deps 联动 code');
    }
    if (selected.has('code') && (!baseline.payload.components.dependencies.groups ||
        baseline.payload.components.dependencies.lockSha256 !== lockSha256)) {
        selected.add('deps'); reasons.push('依赖分组或 package-lock 指纹变化，code 联动 deps');
    }
    const versions = { code: 0, deps: 0, task: 0, node: 0, apk: 0 };
    for (const item of baselines) {
        const components = item.payload.components;
        versions.code = Math.max(versions.code, components.code.version);
        versions.deps = Math.max(versions.deps, components.dependencies.version);
        versions.task = Math.max(versions.task, components.taskCode?.version || 0);
        versions.apk = Math.max(versions.apk, components.apkMin?.versionCode || 0);
    }
    const full = await optionalJson(path.join(targets.localRoot, 'full-apk-manifest.json'));
    if (full) versions.apk = Math.max(versions.apk, validateFullApkManifest(full, publicKeyPem).versionCode);
    let publishedFullVersion = full?.payload.apkFull.versionCode || 0;
    if (!options.manifestFile) {
        const remoteFull = await readFullApkManifest(targets.remoteVerifyUrl, publicKeyPem);
        if (remoteFull) {
            versions.apk = Math.max(versions.apk, remoteFull.payload.apkFull.versionCode);
            publishedFullVersion = Math.max(publishedFullVersion, remoteFull.payload.apkFull.versionCode);
        }
    }
    for (const profile of Object.values(PROFILE_NAMES)) {
        const configuration = await readJson(path.join(projectRoot, `release/apkbuild/${profile}/app.json`));
        versions.apk = Math.max(versions.apk, safeVersion(configuration.versionCode));
        const built = await optionalJson(path.join(projectRoot, `release/apkbuild/${profile}/output/build-manifest.json`));
        if (built) versions.apk = Math.max(versions.apk, safeVersion(built.versionCode));
    }
    await scanVersions(artifactRoot, versions);
    await scanVersions(targets.localRoot, versions);
    if (selected.has('node') && !options.manifestFile) versions.node = Math.max(versions.node, await readRemoteNodeVersion(targets.remote));
    const next = {};
    for (const kind of ['code', 'deps', 'task', 'node']) {
        if (selected.has(kind) && !options.fresh) next[kind] = safeVersion(versions[kind] + 1);
    }
    // 旧服务构建器为附带 Node 使用同一编号，联合选择时避免任一目录已有该版本。
    if (!options.fresh && selected.has('code') && selected.has('node')) next.code = next.node = Math.max(next.code, next.node);
    let apkVersion = versions.apk;
    for (const kind of ['min', 'full']) {
        if (selected.has(kind) && !options.fresh) {
            next[kind] = safeVersion(++apkVersion);
            if (next[kind] > 2100000000) throw new Error('Android versionCode 超过允许上限');
        }
    }
    let reusedReport;
    if (options.fresh && selected.size) {
        const previous = await latestMatchingTask({ artifactRoot, projectRoot, targets });
        if (!previous) throw new Error('--fresh 不升号，需要旧任务的预留版本；请去掉 --fresh 或使用 --new 先创建新版本');
        reusedReport = previous.file;
        const published = { code: Math.max(...baselines.map(item => item.payload.components.code.version)),
            deps: Math.max(...baselines.map(item => item.payload.components.dependencies.version)),
            task: Math.max(...baselines.map(item => item.payload.components.taskCode?.version || 0)),
            min: Math.max(...baselines.map(item => item.payload.components.apkMin?.versionCode || 0)), full: publishedFullVersion };
        for (const kind of selected) {
            const original = previous.report.plan.versions?.[kind];
            if (!Number.isSafeInteger(original) || original < 1) throw new Error(`旧任务没有 ${kind} 的预留版本；请使用 --new 分配新版本`);
            if (['min', 'full'].includes(kind) && original > 2100000000) throw new Error('原APK版本超过Android允许上限');
            if (original <= (published[kind] || 0)) throw new Error(`${kind} 原版本 ${original} 已发布，不能同号重建；请使用 --new`);
            next[kind] = original;
        }
        if (selected.has('code') && selected.has('node') && next.code !== next.node) throw new Error('原任务code/node联合编号不一致，请使用 --new');
        reasons.push('fresh 原号重建：复用旧任务 versions，不递增；正式执行前还会核对两端实际文件');
    }
    return { requested, selected: KINDS.filter(kind => selected.has(kind)), reasons, versions: next, baseline,
        artifactRoot, targets, projectRoot, statusPath, fullBaseline: full, lockSha256, baselinePath,
        dependencyRoots: options.dependencyRoots ? path.resolve(options.dependencyRoots) : undefined, nodeAbi: options.nodeAbi,
        reservedMaximum: versions, reusedReport };
}

async function reserveVersions(plan) {
    const maximum = { code: 0, deps: 0, task: 0, node: 0, apk: 0, ...plan.reservedMaximum };
    await scanVersions(plan.artifactRoot, maximum);
    await scanVersions(plan.targets.localRoot, maximum);
    for (const profile of Object.values(PROFILE_NAMES)) {
        const configuration = await readJson(path.join(plan.projectRoot, `release/apkbuild/${profile}/app.json`));
        maximum.apk = Math.max(maximum.apk, safeVersion(configuration.versionCode));
    }
    const existing = await optionalJson(path.join(plan.artifactRoot, VERSION_RESERVATIONS));
    for (const [kind, version] of Object.entries(existing?.maximum || {})) maximum[kind] = Math.max(maximum[kind] || 0, safeVersion(version));
    for (const [kind, version] of Object.entries(plan.versions)) {
        const target = ['min', 'full'].includes(kind) ? 'apk' : kind;
        maximum[target] = Math.max(maximum[target] || 0, safeVersion(version));
    }
    await writeJson(path.join(plan.artifactRoot, VERSION_RESERVATIONS), { schemaVersion: 1, maximum });
}

function plannedSteps(plan) {
    const selected = new Set(plan.selected);
    const steps = [];
    if (selected.has('min')) steps.push('build:apk:offline:min', 'package:offline-apk:min');
    if (selected.has('code') || selected.has('task')) steps.push('build:offline-update');
    if (selected.has('node') && !selected.has('code')) steps.push('stageVoiceDisplayNodePackage');
    if (selected.has('full')) steps.push('build:apk:offline');
    return steps;
}

async function runNpm(projectRoot, script, args = [], environment = {}, runtime = {}) {
    runtime.signal?.throwIfAborted();
    const npmPath = process.env.npm_execpath;
    const program = npmPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const parameters = [...(npmPath ? [npmPath] : []), 'run', script, ...(args.length ? ['--', ...args] : [])];
    console.log(JSON.stringify({ stage: 'command', script, args }));
    await new Promise((resolve, reject) => {
        const detached = process.platform !== 'win32';
        const child = spawn(program, parameters, { cwd: projectRoot, stdio: 'inherit', detached, env: { ...process.env, ...environment } });
        let killTimer;
        const kill = signal => {
            try { if (child.pid) process.kill(detached ? -child.pid : child.pid, signal); }
            catch (error) { if (error.code !== 'ESRCH') console.error(`停止构建命令失败: ${error.message}`); }
        };
        const abort = () => {
            kill('SIGTERM');
            killTimer = setTimeout(() => kill('SIGKILL'), 10000);
            killTimer.unref();
        };
        const cleanup = () => { clearTimeout(killTimer); runtime.signal?.removeEventListener('abort', abort); };
        runtime.signal?.addEventListener('abort', abort, { once: true });
        child.once('error', error => { cleanup(); reject(error); });
        child.once('exit', (code, signal) => {
            if (runtime.signal?.aborted) kill('SIGKILL');
            cleanup();
            if (runtime.signal?.aborted) { reject(runtime.signal.reason); return; }
            if (code === 0) { resolve(); return; }
            reject(new Error(`${script} 失败: ${signal || code}`));
        });
        if (runtime.signal?.aborted) abort();
    });
}

/** 优先使用显式工具路径，再从 Android SDK 的最新 build-tools 目录查找。 */
async function androidTools() {
    let apksignerPath = process.env.AASC_APKSIGNER;
    if (!apksignerPath) {
        const directory = path.join(process.env.ANDROID_HOME || '/opt/android-sdk', 'build-tools');
        const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        const versions = entries.filter(entry => entry.isDirectory() && /^\d/u.test(entry.name))
            .map(entry => entry.name).sort((left, right) => right.localeCompare(left, 'en', { numeric: true }));
        for (const version of versions) {
            const candidate = path.join(directory, version, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner');
            try { await fs.access(candidate); apksignerPath = candidate; break; }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
    apksignerPath ||= 'apksigner';
    return { apksignerPath, aaptPath: process.env.AASC_AAPT || path.join(path.dirname(apksignerPath), 'aapt') };
}

/** 指纹只纳入受管代码/发布种子；排除本入口写入的版本配置、状态、报告和运行结果。 */
async function sourceFingerprint(projectRoot) {
    const result = await execFileAsync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: projectRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const files = [...new Set(result.stdout.split('\0'))].filter(file => /^(src\/|scripts\/|release\/(config|userconfig|task)\/|res\/tasks\/|package(?:-lock)?\.json$)/u.test(file)
        && !/(^|\/)(results|node_modules|\.gradle|\.cxx|build)(\/|$)/u.test(file)).sort();
    const hash = crypto.createHash('sha256');
    for (const file of files) {
        const absolute = path.join(projectRoot, file);
        const stat = await fs.lstat(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        hash.update(file).update('\0');
        if (!stat) { hash.update('deleted'); continue; }
        if (stat.isSymbolicLink()) { hash.update(await fs.readlink(absolute)); continue; }
        if (stat.isFile()) hash.update(await hashFile(absolute));
    }
    return hash.digest('hex');
}

async function updateStatus(plan, kinds, pending) {
    if (!kinds.some(kind => STATUS_FIELDS[kind])) return;
    const status = await readJson(plan.statusPath);
    for (const kind of kinds) {
        if (STATUS_FIELDS[kind]) status[STATUS_FIELDS[kind]] = pending;
    }
    await writeJson(plan.statusPath, status);
}

async function bumpApk(plan, kind, manifest) {
    const file = path.join(plan.projectRoot, `release/apkbuild/${PROFILE_NAMES[kind]}/app.json`);
    const configuration = await readJson(file);
    const versionCode = plan.versions[kind];
    configuration.versionCode = versionCode;
    const versionName = configuration.versionName.match(/^(\d+\.\d+\.)\d+(.*)$/u);
    if (!versionName) throw new Error(`APK versionName 必须为 主版本.次版本.编号[后缀]: ${configuration.versionName}`);
    configuration.versionName = `${versionName[1]}${versionCode}${versionName[2]}`;
    if (kind === 'full') configuration.serviceVersions = { codeVersion: manifest.payload.components.code.version,
        dependencyVersion: manifest.payload.components.dependencies.version };
    await writeJson(file, configuration);
}

async function verifyApk(apkPath, buildManifestPath, kind, expectedVersion, baseline, runtime = {}) {
    runtime.signal?.throwIfAborted();
    const metadata = await readJson(buildManifestPath);
    const file = await describeFile(apkPath);
    if (metadata.profile !== PROFILE_NAMES[kind] || metadata.offline !== true || metadata.embeddedNode !== true ||
        (metadata.updateOnly === true) !== (kind === 'min') || metadata.versionCode !== expectedVersion || metadata.sha256 !== file.sha256) {
        throw new Error(`${kind} APK profile/版本/摘要与构建清单不符`);
    }
    const { apksignerPath, aaptPath } = await androidTools();
    const signer = await readSignerSha256(apkPath, { apksignerPath, commandRunner: runtime.commandRunner });
    if (baseline.payload.components.apkMin?.signerSha256 && signer !== baseline.payload.components.apkMin.signerSha256) {
        throw new Error('APK 签名证书与现行 min APK 不一致');
    }
    const identity = await (runtime.commandRunner || execFileAsync)(aaptPath, ['dump', 'badging', apkPath], { encoding: 'utf8' });
    const match = identity.stdout.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/u);
    if (!match || match[1] !== 'com.aasc.display.offline' || Number(match[2]) !== expectedVersion || match[3] !== metadata.versionName) {
        throw new Error('APK 实际包名或版本与构建清单不一致');
    }
    return metadata;
}

async function buildNode(plan, keyPair, runtime = {}) {
    const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-release-node-'));
    try {
        const staged = await stageVoiceDisplayNodePackage({ projectRoot: plan.projectRoot, workDirectory,
            outputDir: plan.artifactRoot, version: plan.versions.node, source: readGitSourceMetadata(plan.projectRoot),
            zipRunner: runtime.commandRunner, ...keyPair });
        runtime.signal?.throwIfAborted();
        await fs.mkdir(path.dirname(staged.archiveDestination), { recursive: true });
        await fs.copyFile(staged.archivePath, staged.archiveDestination, constants.COPYFILE_EXCL);
        await fs.copyFile(staged.metadataPath, staged.metadataDestination, constants.COPYFILE_EXCL);
        return [staged.archiveDestination, staged.metadataDestination];
    } finally { await fs.rm(workDirectory, { recursive: true, force: true }); }
}

async function saveReport(file, report) {
    report.updatedAt = new Date().toISOString();
    await writeJson(file, report);
}

function manifestArtifacts(manifest) {
    return Object.entries(manifest.payload.components).flatMap(([name, component]) =>
        name === 'taskDependencies' ? Object.values(component) : component.groups ? Object.values(component.groups)
            : component.relativeUrl ? [component] : []);
}

async function buildRelease(plan, report, reportPath, keyPair, runtime = {}) {
    runtime.signal?.throwIfAborted();
    let manifestPath = report.manifestPath;
    let manifest = manifestPath ? validateBaseline(await readJson(manifestPath), keyPair.publicKeyPem) : plan.baseline;
    if (!manifestPath) {
        manifestPath = path.join(plan.artifactRoot, 'releases', `${report.id}-baseline.json`);
        await writeJson(manifestPath, manifest);
    }
    const selected = new Set(plan.selected.filter(kind => !report.completed.includes(kind)));
    if (runtime.resuming) await preparePendingRebuild(report, reportPath, saveReport, keyPair.publicKeyPem, runtime);
    const record = async (kinds, files) => {
        runtime.signal?.throwIfAborted();
        for (const file of [...files, manifestPath]) {
            const description = await describeFile(file);
            if (!report.files.some(entry => entry.path === description.path)) report.files.push(description);
        }
        report.completed.push(...kinds);
        report.manifestPath = manifestPath;
        const unchanged = await sourceFingerprint(plan.projectRoot) === report.sourceFingerprint;
        if (!unchanged) {
            await updateStatus(plan, plan.selected, true);
            throw new Error('构建期间受管代码或发布输入改变，请重新出包；待出包标记保留');
        }
        runtime.signal?.throwIfAborted();
        await saveReport(reportPath, report);
        await updateStatus(plan, kinds, false);
    };
    const buildApkKind = async kind => {
        runtime.signal?.throwIfAborted();
        await bumpApk(plan, kind, manifest);
        await runNpm(plan.projectRoot, kind === 'min' ? 'build:apk:offline:min' : 'build:apk:offline', [], {}, runtime);
        const output = path.join(plan.projectRoot, `release/apkbuild/${PROFILE_NAMES[kind]}/output`);
        const apkPath = path.join(output, kind === 'min' ? 'aasc-display-offline-min.apk' : 'aasc-display-offline.apk');
        const buildManifestPath = path.join(output, 'build-manifest.json');
        const metadata = await verifyApk(apkPath, buildManifestPath, kind, plan.versions[kind], plan.baseline, runtime);
        if (kind === 'min') {
            const tools = await androidTools();
            await runNpm(plan.projectRoot, 'package:offline-apk:min', [`--manifest-file=${manifestPath}`, `--output-dir=${plan.artifactRoot}`],
                { AASC_APKSIGNER: tools.apksignerPath }, runtime);
            manifestPath = path.join(plan.artifactRoot, `manifests/manifest-apk-min-v${plan.versions.min}.json`);
            manifest = validateBaseline(await readJson(manifestPath), keyPair.publicKeyPem);
            await record(['min'], [path.join(plan.artifactRoot, manifest.payload.components.apkMin.relativeUrl)]);
            return;
        }
        // 保存不可变副本，使后续单独构建其他 APK 不会破坏恢复发布所需的输入。
        const destination = path.join(plan.artifactRoot, `apk/aasc-display-offline-v${plan.versions.full}.apk`);
        const metadataPath = path.join(plan.artifactRoot, `releases/${report.id}-full-build.json`);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(apkPath, destination, constants.COPYFILE_EXCL);
        await writeJson(metadataPath, { ...metadata, apk: path.basename(destination) });
        report.full = { apkPath: destination, buildManifestPath: metadataPath };
        await record(['full'], [destination, metadataPath]);
    };
    // 先准备新 min 的签名候选，使联合任务包的最低 APK 约束基于新版本判断。
    if (selected.has('min')) await buildApkKind('min');
    if (selected.has('code') || selected.has('task')) {
        const mode = selected.has('deps') ? 'all' : selected.has('code') ? 'code-only' : 'task-code-only';
        const args = [`--mode=${mode}`,
            `--manifest-file=${manifestPath}`, `--output-dir=${plan.artifactRoot}`];
        args.push(`--current-artifact-root=${plan.targets.localRoot}`);
        if (plan.dependencyRoots) args.push(`--dependency-roots=${plan.dependencyRoots}`);
        if (plan.nodeAbi) args.push(`--node-abi=${plan.nodeAbi}`);
        if (selected.has('code')) args.push(`--code-version=${plan.versions.code}`,
            `--include-voice-display-node=${selected.has('node')}`,
            `--reuse-node-min-seeds=${!selected.has('deps') && !!manifest.payload.components.nodeMinSeeds}`);
        if (selected.has('deps')) args.push(`--dependency-version=${plan.versions.deps}`);
        if (selected.has('task')) args.push(`--task-code-version=${plan.versions.task}`);
        await runNpm(plan.projectRoot, 'build:offline-update', args, {}, runtime);
        manifestPath = path.join(plan.artifactRoot, 'manifests', selected.has('code')
            ? `manifest-code-v${plan.versions.code}.json` : `manifest-task-code-v${plan.versions.task}.json`);
        manifest = validateBaseline(await readJson(manifestPath), keyPair.publicKeyPem);
        const previousUrls = new Set(manifestArtifacts(plan.baseline).map(item => item.relativeUrl));
        const files = manifestArtifacts(manifest).filter(item => !previousUrls.has(item.relativeUrl))
            .map(item => path.join(plan.artifactRoot, item.relativeUrl));
        if (selected.has('code') && selected.has('node')) files.push(...['zip', 'json'].map(extension =>
            path.join(plan.artifactRoot, `voice-display-node/voice-display-node-v${plan.versions.node}.${extension}`)));
        await record(['code', 'deps', 'task', 'node'].filter(kind => selected.has(kind) && (kind !== 'node' || selected.has('code'))), files);
    }
    if (selected.has('node') && !selected.has('code')) await record(['node'], await buildNode(plan, keyPair, runtime));
    if (selected.has('full')) await buildApkKind('full');
    if (await sourceFingerprint(plan.projectRoot) !== report.sourceFingerprint) {
        await updateStatus(plan, plan.selected, true);
        throw new Error('构建完成时受管代码或发布输入改变，请重新出包');
    }
    report.manifestPath = manifestPath;
    if (!report.files.some(file => file.path === manifestPath)) report.files.push(await describeFile(manifestPath));
    runtime.signal?.throwIfAborted();
    report.phase = 'built';
    await saveReport(reportPath, report);
    await updateStatus(plan, report.completed, false);
}

async function readRemoteNodeVersion(remote, runtime = {}) {
    const directory = remote.directory;
    const assignment = directory.startsWith('~/') ? `root="$HOME"/${shellQuote(directory.slice(2))}` : `root=${shellQuote(directory)}`;
    const command = `set -eu\n${assignment}\n[ ! -L "$root" ] || exit 31\n` +
        'if [ -d "$root/voice-display-node" ] && [ ! -L "$root/voice-display-node" ]; then\n' +
        'find "$root/voice-display-node" -maxdepth 1 -type f -name "voice-display-node-v*" -printf "%f\\n"\nfi';
    const result = await (runtime.commandRunner || execFileAsync)('ssh', [remote.host, ...buildRemoteShellArguments(command)],
        { encoding: 'utf8', timeout: 30000 });
    let maximum = 0;
    for (const name of result.stdout.split('\n')) {
        const match = name.match(/^voice-display-node-v(\d+)\.(json|zip)$/u);
        if (match) maximum = Math.max(maximum, safeVersion(Number(match[1])));
    }
    return maximum;
}

function shellQuote(value) { return `'${value.replace(/'/gu, `'"'"'`)}'`; }

async function publishRelease(report, reportPath, keyPair, runtime = {}) {
    const plan = report.plan;
    runtime.signal?.throwIfAborted();
    await verifyReportFiles(report, true);
    const manifest = validateBaseline(await readJson(report.manifestPath), keyPair.publicKeyPem);
    const names = Object.keys(manifest.payload.components).filter(name =>
        canonicalJson(manifest.payload.components[name]) !== canonicalJson(plan.baseline.payload.components[name] ?? null));
    report.phase = 'publishing';
    await saveReport(reportPath, report);
    if (names.length) {
        const result = await publishOfflineUpdate({ mode: 'selected', components: names, artifactRoot: plan.artifactRoot,
            manifestPath: report.manifestPath, expectedManifest: plan.baseline, publicKeyPem: keyPair.publicKeyPem,
            commandRunner: runtime.commandRunner, fetchImpl: runtime.fetchImpl, ...plan.targets });
        report.published.service = { local: result.localPublishedPaths, remote: result.remotePublishedPaths };
        report.cleanupErrors.push(...result.cleanupErrors);
        await saveReport(reportPath, report);
    }
    if (plan.selected.includes('full')) {
        // 独立 full 索引也检查当前版本，防止恢复旧报告导致 APK 降级和清理新版本。
        for (const base of [plan.targets.localVerifyUrl, plan.targets.remoteVerifyUrl]) {
            const current = await readFullApkManifest(base, keyPair.publicKeyPem, { fetchImpl: runtime.fetchImpl });
            if (current && current.payload.apkFull.versionCode > plan.versions.full) throw new Error('发布源已有更高 full APK 版本');
        }
        runtime.signal?.throwIfAborted();
        const result = await publishOfflineFullApk({ ...report.full, ...plan.targets, ...(await androidTools()),
            commandRunner: runtime.commandRunner, fetchImpl: runtime.fetchImpl });
        report.published.full = { local: result.localPublishedPaths, remote: result.remotePublishedPaths };
        report.cleanupErrors.push(...result.cleanupErrors);
        await saveReport(reportPath, report);
    }
    if (plan.selected.includes('node')) {
        if (await readRemoteNodeVersion(plan.targets.remote, runtime) > plan.versions.node) throw new Error('WAN 已有更高 Node 版本，请重新出包');
        const localVersions = { code: 0, deps: 0, task: 0, node: 0, apk: 0 };
        await scanVersions(plan.targets.localRoot, localVersions);
        if (localVersions.node > plan.versions.node) throw new Error('LAN 已有更高 Node 版本，请重新出包');
        const result = await publishVoiceDisplayNodePackage({ version: plan.versions.node, artifactRoot: plan.artifactRoot,
            publicKeyPem: keyPair.publicKeyPem, commandRunner: runtime.commandRunner, fetchImpl: runtime.fetchImpl, ...plan.targets });
        report.published.node = result;
        for (const target of ['local', 'remote']) report.cleanupErrors.push(...(result[target]?.cleanup.errors || []));
        await saveReport(reportPath, report);
        if (result.errors.length) throw new Error(`Node 发布失败: ${JSON.stringify(result.errors)}`);
    }
    runtime.signal?.throwIfAborted();
    report.phase = report.cleanupErrors.length ? 'cleanup-pending' : 'published';
    await saveReport(reportPath, report);
    if (report.cleanupErrors.length) throw new Error('发布已生效，旧资源清理待重试，请使用 --resume');
}

async function acquireLock(artifactRoot) {
    await fs.mkdir(artifactRoot, { recursive: true });
    const file = path.join(artifactRoot, '.release-offline.lock');
    let handle;
    try { handle = await fs.open(file, 'wx'); }
    catch (error) {
        if (error.code === 'EEXIST') throw new Error(`已有出包任务或遗留锁，请核对进程后处理: ${file}`);
        throw error;
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); }
    catch (error) { await handle.close(); await fs.unlink(file); throw error; }
    const owned = await handle.stat();
    return async () => {
        await handle.close();
        const current = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (current && current.ino === owned.ino && current.dev === owned.dev && !current.isSymbolicLink()) await fs.unlink(file);
    };
}

async function verifyReportFiles(report, markPending = false) {
    try {
        for (const expected of report.files) {
            const actual = await describeFile(expected.path);
            if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new Error(`报告产物已改变: ${expected.path}`);
        }
        if (await sourceFingerprint(report.plan.projectRoot) !== report.sourceFingerprint) {
            throw new Error('当前源码已不同于报告快照；用 --fresh 原号重做未发布任务，或用 --new 创建递增版本');
        }
    } catch (error) {
        if (markPending) await updateStatus(report.plan, report.plan.selected, true);
        throw error;
    }
}

async function resumePlan(report, markPending = false) {
    await verifyReportFiles(report, markPending);
    // 用户要求恢复不升号；未完成步骤只能使用原任务已预留的编号。
    return report.plan;
}

async function latestMatchingTask(plan) {
    const directory = path.join(plan.artifactRoot, 'releases');
    const stat = await fs.lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return null;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('报告目录必须是普通目录');
    const names = (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile()
        && entry.name === entry.name.trim() && /^release-[0-9TZ]+-[0-9]+\.json$/u.test(entry.name)).map(entry => entry.name).sort().reverse();
    for (const name of names) {
        const file = path.join(directory, name);
        const report = await readJson(file);
        if (report.schemaVersion === 1 && report.plan?.projectRoot === plan.projectRoot && report.plan.artifactRoot === plan.artifactRoot
            && canonicalJson(report.plan.targets) === canonicalJson(plan.targets)) return { file, report };
    }
    return null;
}

/** 最近的新任务取代更早任务；不因旧报告仍未完成而在新任务结束后再次接管旧报告。 */
async function findResumeReport(options) {
    const artifactRoot = path.resolve(options.outputDir || path.join(ROOT, 'release/offline-update/output'));
    const directory = path.join(artifactRoot, 'releases');
    const stat = await fs.lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return null;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`报告目录必须是普通目录: ${directory}`);
    const names = (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile()
        && entry.name === entry.name.trim() && /^release-[0-9TZ]+-[0-9]+\.json$/u.test(entry.name)).map(entry => entry.name).sort().reverse();
    const targets = targetOptions(options);
    for (const name of names) {
        const file = path.join(directory, name);
        const report = await readJson(file);
        if (report.schemaVersion !== 1 || report.plan?.projectRoot !== ROOT || report.plan.artifactRoot !== artifactRoot ||
            canonicalJson(report.plan.targets) !== canonicalJson(targets)) continue;
        if (options.only && canonicalJson([...options.only].sort()) !== canonicalJson([...report.plan.requested].sort())) continue;
        if (options.manifestFile && report.plan.baselinePath !== path.resolve(options.manifestFile)) continue;
        if (options.dependencyRoots && report.plan.dependencyRoots !== path.resolve(options.dependencyRoots)) continue;
        if (options.nodeAbi && report.plan.nodeAbi !== options.nodeAbi) continue;
        const recoverable = ['building', 'publishing', 'cleanup-pending'].includes(report.phase) ||
            (report.phase === 'built' && (options.publish || options.resume === 'auto'));
        return recoverable ? file : null;
    }
    return null;
}

async function runCli(argv = process.argv.slice(2)) {
    let releaseLock;
    let report;
    let reportPath;
    const controller = new AbortController();
    const runtime = {
        signal: controller.signal,
        commandRunner: (file, args, options = {}) => execFileAsync(file, args, { ...options, signal: controller.signal }),
        fetchImpl: (url, options = {}) => fetch(url, { ...options, signal: options.signal
            ? AbortSignal.any([controller.signal, options.signal]) : controller.signal })
    };
    // 正常关闭等待在途步骤退出后再释放锁；SIGKILL/断电无法被捕获，遗留锁保留给人工核对。
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const handlers = signals.map(signal => {
        const handler = () => {
            if (controller.signal.aborted) return;
            console.error(`收到 ${signal}，正在停止当前步骤并保存报告，请等待退出。`);
            controller.abort(new Error(`任务被 ${signal} 中断，可按报告恢复`));
        };
        process.on(signal, handler);
        return handler;
    });
    try {
        const options = parseArguments(argv);
        if (options.help) { console.log(HELP); return; }
        if (!options.fresh && !options.new && (!options.resume || options.resume === 'auto')) {
            const automatic = await findResumeReport(options);
            if (automatic) {
                console.log(JSON.stringify({ stage: 'auto-resume', report: automatic }));
                // 已匹配原目录/目标/选择，恢复阶段统一使用报告内参数，防止入口参数覆盖快照。
                for (const key of Object.keys(options)) if (!['publish', 'dryRun'].includes(key)) delete options[key];
                options.resume = automatic;
            } else if (options.resume === 'auto') {
                console.log('没有可恢复的任务；直接执行 release:offline 可开始按状态出包。'); return;
            }
        }
        if (options.resume) {
            reportPath = path.resolve(options.resume);
            report = await readJson(reportPath);
            if (report.schemaVersion !== 1 || !report.plan || !Array.isArray(report.files) ||
                !Array.isArray(report.plan.selected) || !Array.isArray(report.completed) ||
                !report.plan.selected.every(kind => KINDS.includes(kind)) ||
                report.completed.some(kind => !report.plan.selected.includes(kind)) ||
                !['building', 'built', 'publishing', 'published', 'cleanup-pending'].includes(report.phase) ||
                (report.phase !== 'building' && report.plan.selected.some(kind => !report.completed.includes(kind)))) throw new Error('报告格式不完整，不能恢复');
            if (Object.keys(options).some(key => !['resume', 'publish', 'dryRun'].includes(key))) throw new Error('恢复发布使用报告内的原目标，不能覆盖路径参数');
            if (options.dryRun) {
                console.log(JSON.stringify({ resume: reportPath, plan: await resumePlan(report), phase: report.phase }, null, 2)); return;
            }
            controller.signal.throwIfAborted();
            releaseLock = await acquireLock(report.plan.artifactRoot);
            report.plan = await resumePlan(report, true);
            report.cleanupErrors = [];
            delete report.error;
            const needsKey = report.phase === 'building' || options.publish;
            const keyPair = needsKey ? report.plan.selected.length ? await loadOfflineUpdateKeyPair() : await loadOfflineUpdatePublicKey() : null;
            if (report.phase === 'building') {
                await reserveVersions(report.plan);
                await saveReport(reportPath, report);
                await updateStatus(report.plan, report.plan.selected.filter(kind => !report.completed.includes(kind)), true);
                if (report.freshRequested && !report.freshCleanup?.complete) {
                    await cleanupFreshRelease(report, reportPath, saveReport, keyPair.publicKeyPem, runtime);
                }
                await buildRelease(report.plan, report, reportPath, keyPair, { ...runtime, resuming: true });
            }
            if (options.publish) await publishRelease(report, reportPath, keyPair, runtime);
            if (!options.publish && ['publishing', 'cleanup-pending'].includes(report.phase)) {
                console.log('检测到尚未完成的发布/清理；重新执行 npm run release:offline -- --publish 继续。');
            }
            console.log(JSON.stringify({ phase: report.phase, report: reportPath }));
            return;
        }
        let plan = await createPlan(options);
        controller.signal.throwIfAborted();
        if (!plan.selected.length && !options.fresh) { console.log('无需出包：没有待处理产物；可用 --only 手动指定。'); return; }
        console.log(JSON.stringify({ requested: plan.requested, selected: plan.selected, reasons: plan.reasons,
            versions: plan.versions, steps: plannedSteps(plan), publish: !!options.publish, dryRun: !!options.dryRun, targets: plan.targets,
            freshCleanup: options.fresh ? { ...(await collectFreshCleanup(plan)),
                note: '仅候选；正式执行时核对LAN/WAN签名引用、实际目录与HTTP，已发布或无法确认的产物保留' } : undefined }, null, 2));
        if (options.dryRun) return;
        controller.signal.throwIfAborted();
        releaseLock = await acquireLock(plan.artifactRoot);
        plan = await createPlan(options);
        if (!plan.selected.length && !options.fresh) { console.log('无需出包：待处理状态已被其他任务完成。'); return; }
        const keyPair = plan.selected.length ? await loadOfflineUpdateKeyPair() : await loadOfflineUpdatePublicKey();
        const id = `release-${new Date().toISOString().replace(/[-:.]/gu, '')}-${process.pid}`;
        reportPath = path.join(plan.artifactRoot, 'releases', `${id}.json`);
        report = { schemaVersion: 1, id, plan, phase: 'building', completed: [], files: [], published: {}, cleanupErrors: [],
            freshRequested: !!options.fresh, sourceFingerprint: await sourceFingerprint(plan.projectRoot), createdAt: new Date().toISOString() };
        await reserveVersions(plan);
        await saveReport(reportPath, report);
        await updateStatus(plan, plan.selected, true);
        console.log(JSON.stringify({ stage: 'reserved', report: reportPath, versions: plan.versions }));
        if (report.freshRequested) await cleanupFreshRelease(report, reportPath, saveReport, keyPair.publicKeyPem, runtime);
        await buildRelease(plan, report, reportPath, keyPair, runtime);
        if (options.publish) await publishRelease(report, reportPath, keyPair, runtime);
        console.log(JSON.stringify({ phase: report.phase, report: reportPath,
            resume: ['npm', 'run', 'release:offline', '--', `--resume=${reportPath}`, '--publish'] }));
    } catch (error) {
        if (releaseLock && report && reportPath) {
            report.error = error.message;
            await saveReport(reportPath, report).catch(saveError => console.error(`保存报告失败: ${saveError.message}`));
        }
        console.error(`Offline 出包/发布失败: ${error.message}`);
        if (reportPath) console.error(`已保留报告: ${reportPath}`);
        process.exitCode = 1;
    } finally {
        signals.forEach((signal, index) => process.off(signal, handlers[index]));
        if (releaseLock) await releaseLock();
    }
}

if (require.main === module) runCli().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { KINDS, STATUS_FIELDS, parseArguments, createPlan, scanVersions, sourceFingerprint,
    buildRelease, publishRelease, runCli };
