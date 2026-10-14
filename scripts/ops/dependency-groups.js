'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const shared = require('../../src/apps/server/modules/aasc/shared-update-manifest');
const archive = require('../../src/apps/server/modules/aasc/update-archive');
const closure = require('../../src/apps/server/modules/aasc/dependency-closure');
const execFileAsync = promisify(execFile);

function matches(values, value) {
    if (!values) return true;
    const list = Array.isArray(values) ? values : [values];
    return !list.includes(`!${value}`) && (!list.some(item => !item.startsWith('!')) || list.includes(value) || list.includes('any'));
}
function packageAllows(metadata, target) { return matches(metadata.os, target.os) && matches(metadata.cpu, target.arch) && matches(metadata.libc, target.libc); }
function prebuildTarget(relative) {
    const patterns = [/(?:^|\/)(android|linux|win32|windows|darwin)[-_\/](arm64|aarch64|x64|x86_64|ia32|arm)(?:[-_/.]|$)/i,
        /(?:^|\/)(linux|android|win32|windows|darwin)(?:[-_\/])(x86|x86-64)(?:[-_/.]|$)/i];
    const match = patterns.map(pattern => relative.match(pattern)).find(Boolean);
    if (!match) return null;
    return { os: match[1].toLowerCase().replace('windows', 'win32'), arch: ({ aarch64: 'arm64', x86_64: 'x64', 'x86-64': 'x64', x86: 'ia32' })[match[2]] || match[2] };
}
/** 从ELF/PE头识别架构；路径标签用来区分同为ELF的Android Bionic与Linux。 */
function binaryTarget(buffer) {
    if (buffer.length >= 20 && buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
        const machine = buffer[5] === 2 ? buffer.readUInt16BE(18) : buffer.readUInt16LE(18);
        return { os: 'elf', arch: ({ 62: 'x64', 183: 'arm64', 40: 'arm', 3: 'ia32' })[machine] || 'unknown' };
    }
    if (buffer.length >= 64 && buffer.toString('ascii', 0, 2) === 'MZ') {
        const position = buffer.readUInt32LE(60);
        if (position + 6 > buffer.length || buffer.toString('ascii', position, position + 4) !== 'PE\0\0') throw new Error('PE原生文件头无效');
        return { os: 'win32', arch: ({ 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'ia32' })[buffer.readUInt16LE(position + 4)] || 'unknown' };
    }
    if (buffer.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(buffer.readUInt32BE(0))) return { os: 'darwin', arch: 'unknown' };
    return null;
}
async function packageOwner(file, nodeModules) {
    let directory = path.dirname(file);
    while (directory.startsWith(`${nodeModules}${path.sep}`)) {
        const metadata = path.join(directory, 'package.json');
        if (fs.existsSync(metadata)) return JSON.parse(await fs.promises.readFile(metadata, 'utf8'));
        directory = path.dirname(directory);
    }
    return {};
}
async function selectFiles(nodeModules, target) {
    const result = new Map();
    for (const entry of await archive.treeFiles(nodeModules)) {
        const metadata = await packageOwner(path.join(nodeModules, entry.path), nodeModules);
        if (!packageAllows(metadata, target)) continue;
        const tagged = prebuildTarget(entry.path);
        if (tagged && (tagged.os !== target.os || tagged.arch !== target.arch)) continue;
        if (/(?:^|[-_.\/])musl(?:[-_.\/]|$)/i.test(entry.path) && target.libc !== 'musl') continue;
        const file = path.join(nodeModules, entry.path);
        const handle = await fs.promises.open(file);
        let header;
        try { header = Buffer.alloc(4096); const read = await handle.read(header, 0, header.length, 0); header = header.subarray(0, read.bytesRead); }
        finally { await handle.close(); }
        const binary = binaryTarget(header);
        if (binary && (binary.arch !== target.arch || (binary.os !== 'elf' && binary.os !== target.os))) continue;
        if (binary?.os === 'elf' && target.os === 'win32') continue;
        const nativeExtension = /\.(node|so(?:\.\d+)*|dll|dylib|exe|a)$/i.test(entry.path);
        if (nativeExtension && !binary && !tagged && !metadata.os) throw new Error(`无法识别原生文件目标：${entry.path}`);
        if (binary?.os === 'elf' && target.os === 'android' && !tagged && !matches(metadata.os, 'android')) continue;
        // ELF的ABI不可单靠架构判断；Android未带目标声明的宿主二进制禁止混入。
        if (binary?.os === 'elf' && target.os === 'android' && !tagged && !metadata.os?.includes('android')) throw new Error(`Android原生文件缺少Bionic目标声明：${entry.path}`);
        result.set(entry.path, { ...entry, source: file, platformSpecific: !!(metadata.os || metadata.cpu || metadata.libc || tagged || binary || nativeExtension) });
    }
    return result;
}
async function removeToolEntries(directory) {
    for (const name of await fs.promises.readdir(directory)) {
        const file = path.join(directory, name);
        const stat = await fs.promises.lstat(file);
        if (name === '.bin' && stat.isDirectory() && !stat.isSymbolicLink()) { await fs.promises.rm(file, { recursive: true }); continue; }
        if (name === '.package-lock.json' && stat.isFile()) { await fs.promises.unlink(file); continue; }
        if (stat.isDirectory() && !stat.isSymbolicLink()) await removeToolEntries(file);
    }
}
/** 可导入已在目标平台验证的生产树；默认通过npm明确的os/cpu/libc覆写准备预编译依赖。 */
async function prepareTrees(options) {
    const trees = {};
    for (const name of ['android', 'linux64', 'win64']) {
        const target = shared.TARGETS[name];
        const directory = path.join(options.workDirectory, `target-${name}`);
        await fs.promises.mkdir(directory, { recursive: true });
        for (const file of ['package.json', 'package-lock.json']) await fs.promises.copyFile(path.join(options.projectRoot, file), path.join(directory, file));
        if (options.dependencyRoots?.[name]) {
            const supplied = path.resolve(options.dependencyRoots[name]);
            const contract = JSON.parse(await fs.promises.readFile(path.join(supplied, 'dependency-target.json'), 'utf8'));
            if (Object.entries(target).some(([key, value]) => contract[key] !== value) || contract.lockSha256 !== options.lockSha256) throw new Error(`导入依赖树${name}目标/锁指纹不匹配`);
            await archive.mergeTree(path.join(supplied, 'node_modules'), path.join(directory, 'node_modules'));
        } else {
            const npmExec = process.env.npm_execpath;
            await (options.commandRunner || execFileAsync)(npmExec ? process.execPath : 'npm', [
                ...(npmExec ? [npmExec] : []), 'ci', '--omit=dev', '--ignore-scripts', '--bin-links=false',
                `--os=${target.os}`, `--cpu=${target.arch}`, ...(target.libc !== 'none' ? [`--libc=${target.libc}`] : [])
            ], { cwd: directory, env: { ...process.env, CI: '1', npm_config_audit: 'false', npm_config_fund: 'false' }, timeout: 5 * 60000, maxBuffer: 8 * 1024 ** 2 });
        }
        const nodeModules = path.join(directory, 'node_modules');
        await removeToolEntries(nodeModules);
        if (!fs.existsSync(path.join(nodeModules, 'express/package.json'))) throw new Error(`${name}生产依赖缺少express`);
        trees[name] = await selectFiles(nodeModules, target);
    }
    return trees;
}
/** 共有且内容完全一致的跨平台文件只出现一次；原生包/资源全部进入对应平台层。 */
async function buildDependencyGroups(options) {
    const trees = await prepareTrees(options);
    const packageJson = JSON.parse(await fs.promises.readFile(path.join(options.projectRoot, 'package.json'), 'utf8'));
    const taskIds = Object.keys(shared.TASK_DEPENDENCIES).filter(id =>
        (shared.TASK_DEPENDENCIES[id].optionalNames || [id]).every(name => Object.hasOwn(packageJson.optionalDependencies || {}, name)));
    const lock = JSON.parse(await fs.promises.readFile(path.join(options.projectRoot, 'package-lock.json'), 'utf8'));
    const exclusive = closure.piExclusivePackages(packageJson, lock);
    const packageKeys = new Set(Object.keys(lock.packages || {}));
    const outputs = Object.fromEntries(shared.GROUPS.map(name => [name, path.join(options.workDirectory, `group-${name}`)]));
    for (const directory of Object.values(outputs)) await fs.promises.mkdir(path.join(directory, 'node_modules'), { recursive: true });
    const common = new Set([...trees.android.keys()].filter(file => Object.values(trees).every(tree => tree.get(file) &&
        !tree.get(file).platformSpecific && tree.get(file).sha256 === trees.android.get(file).sha256)));
    for (const [name, files] of Object.entries(trees)) {
        for (const [relative, entry] of files) {
            // 可选任务包仅进入独立制品，不因跨平台内容相同而混入common。
            if (exclusive.has(closure.packageOwnerKey(relative, packageKeys)) || taskIds.some(id =>
                !shared.TASK_DEPENDENCIES[id].targetName && relative.startsWith(`${shared.TASK_DEPENDENCIES[id].packagePath}/`))) continue;
            if (common.has(relative) && name !== 'android') continue;
            const destination = path.join(outputs[common.has(relative) ? 'common' : name], 'node_modules', relative);
            await fs.promises.mkdir(path.dirname(destination), { recursive: true });
            await fs.promises.copyFile(entry.source, destination);
        }
    }
    const groups = {}; const artifacts = [];
    for (const name of shared.GROUPS) {
        const directory = outputs[name];
        const contentSha256 = await archive.contentHash(path.join(directory, 'node_modules'));
        // 默认原生Node模块绑定出包Node ABI；NAPI标签明确的模块仅要求对应NAPI版本。
        const files = await archive.treeFiles(path.join(directory, 'node_modules'));
        const nativeModules = files.filter(file => file.path.endsWith('.node'));
        const nativeContracts = [];
        for (const file of nativeModules) {
            const bytes = await fs.promises.readFile(path.join(directory, 'node_modules', file.path));
            const napi = /napi/i.test(file.path) || bytes.includes(Buffer.from('napi_register_module_v1')) || bytes.includes(Buffer.from('node_api_module_get_api_version_v1'));
            const abi = bytes.toString('latin1').match(/node_register_module_v([0-9]+)/)?.[1];
            if (!napi && !abi && !options.nodeAbi) throw new Error(`原生模块缺少明确Node ABI/NAPI声明：${name}/${file.path}`);
            nativeContracts.push(napi ? { napiVersion: Number(process.versions.napi) } : { nodeAbi: abi || String(options.nodeAbi) });
        }
        const abiValues = new Set(nativeContracts.map(contract => contract.nodeAbi).filter(Boolean));
        if (abiValues.size > 1) throw new Error(`${name}依赖包含不一致的Node ABI`);
        const target = name === 'common' ? null : { ...shared.TARGETS[name],
            ...(abiValues.size ? { nodeAbi: [...abiValues][0] } : {}),
            ...(nativeContracts.some(contract => contract.napiVersion) ? { napiVersion: Number(process.versions.napi) } : {}) };
        const previous = options.currentDependencies?.groups?.[name];
        if (previous?.contentSha256 === contentSha256 && shared.canonicalJson(previous.target) === shared.canonicalJson(target)) {
            const destination = path.join(options.outputDir, previous.relativeUrl);
            const source = path.join(options.currentArtifactRoot || '/mnt/aasc-offline', previous.relativeUrl);
            const file = fs.existsSync(destination) ? destination : source;
            require('../../src/apps/server/modules/aasc/dependency-tree').assertNoLinks(fs.existsSync(destination) ? options.outputDir : (options.currentArtifactRoot || '/mnt/aasc-offline'), file);
            if (!fs.existsSync(file) || (await fs.promises.stat(file)).size !== previous.size || await archive.hashFile(file) !== previous.sha256) throw new Error(`复用依赖组缺少可验证的原文件：${previous.relativeUrl}`);
            groups[name] = previous;
            if (file !== destination) artifacts.push({ archivePath: file, relativeUrl: previous.relativeUrl, reused: true });
            continue;
        }
        const version = previous ? previous.version + 1 : options.dependencyVersion;
        const metadata = { group: name, version, contentSha256, target };
        await fs.promises.writeFile(path.join(directory, 'dependency-group.json'), `${JSON.stringify(metadata)}\n`);
        const archivePath = path.join(options.workDirectory, `${name}-dependencies-v${version}.zip`);
        await deterministicZip(directory, archivePath);
        const relativeUrl = `dependencies/${name}/dependencies-v${version}.zip`;
        groups[name] = { ...metadata, relativeUrl, size: (await fs.promises.stat(archivePath)).size, sha256: await archive.hashFile(archivePath) };
        delete groups[name].group;
        artifacts.push({ archivePath, relativeUrl });
    }
    const dependencies = { version: options.dependencyVersion, lockSha256: options.lockSha256, source: options.source,
        groups, sha256: shared.hash(shared.canonicalJson(groups)), size: Object.values(groups).reduce((sum, group) => sum + group.size, 0) };
    shared.validateDependencies(dependencies);
    const taskDependencies = await buildTaskDependencyArtifacts(options, trees, taskIds, artifacts);
    return { dependencies, taskDependencies, artifacts };
}

/** 任务包只允许三目标共有的浏览器资源；每包独立指纹与版本，变更无关组时可复用。 */
async function buildTaskDependencyArtifacts(options, trees, ids, artifacts) {
    const result = {};
    const lock = JSON.parse(await fs.promises.readFile(path.join(options.projectRoot, 'package-lock.json'), 'utf8'));
    for (const id of ids) {
        const definition = shared.TASK_DEPENDENCIES[id];
        if (definition.targetName) {
            result[id] = await buildPiDependencyArtifact(options, trees[definition.targetName], lock, id, artifacts);
            continue;
        }
        const selected = [...trees.android.entries()].filter(([relative]) => relative.startsWith(`${definition.packagePath}/`));
        const packageVersion = lock.packages?.[`node_modules/${definition.packagePath}`]?.version;
        if (!selected.length || !packageVersion) throw new Error(`任务依赖${id}缺少真实生产包或锁版本`);
        if (Object.values(trees).some(tree => [...tree.keys()].filter(file => file.startsWith(`${definition.packagePath}/`)).length !== selected.length)) {
            throw new Error(`任务依赖${id}三个目标文件集合不一致`);
        }
        const directory = path.join(options.workDirectory, definition.directory);
        for (const [relative, entry] of selected) {
            if (Object.values(trees).some(tree => !tree.get(relative) || tree.get(relative).platformSpecific || tree.get(relative).sha256 !== entry.sha256)) {
                throw new Error(`任务依赖${id}不是三目标相同的跨平台文件：${relative}`);
            }
            const destination = path.join(directory, 'node_modules', relative);
            await fs.promises.mkdir(path.dirname(destination), { recursive: true });
            await fs.promises.copyFile(entry.source, destination);
        }
        const installed = JSON.parse(await fs.promises.readFile(path.join(directory, 'node_modules', definition.packagePath, 'package.json'), 'utf8'));
        if (installed.name !== id || installed.version !== packageVersion) throw new Error(`任务依赖${id}真实包版本不符`);
        const contentSha256 = await archive.contentHash(path.join(directory, 'node_modules'));
        const previous = options.currentTaskDependencies?.[id];
        if (previous?.contentSha256 === contentSha256 && previous.packageVersion === packageVersion) {
            shared.validateTaskDependencies({ [id]: previous });
            const destination = path.join(options.outputDir, previous.relativeUrl);
            const root = fs.existsSync(destination) ? options.outputDir : options.currentArtifactRoot || '/mnt/aasc-offline';
            const file = path.join(root, previous.relativeUrl);
            require('../../src/apps/server/modules/aasc/dependency-tree').assertNoLinks(root, file);
            if (!fs.existsSync(file) || (await fs.promises.stat(file)).size !== previous.size || await archive.hashFile(file) !== previous.sha256) {
                throw new Error(`复用任务依赖${id}缺少校验通过的原文件`);
            }
            result[id] = previous;
            if (file !== destination) artifacts.push({ archivePath: file, relativeUrl: previous.relativeUrl, reused: true });
            continue;
        }
        const version = previous ? previous.version + 1 : options.dependencyVersion;
        const metadata = { group: definition.directory, version, contentSha256, target: null, packageName: id, packageVersion };
        await fs.promises.writeFile(path.join(directory, 'dependency-group.json'), `${JSON.stringify(metadata)}\n`);
        const archivePath = path.join(options.workDirectory, `${definition.directory}-dependencies-v${version}.zip`);
        await deterministicZip(directory, archivePath);
        const relativeUrl = `dependencies/${definition.directory}/dependencies-v${version}.zip`;
        result[id] = { version, contentSha256, target: null, packageName: id, packageVersion, relativeUrl,
            size: (await fs.promises.stat(archivePath)).size, sha256: await archive.hashFile(archivePath) };
        artifacts.push({ archivePath, relativeUrl });
    }
    shared.validateTaskDependencies(result);
    return result;
}

/** Pi包含完整依赖闭包，独立缓存中的ESM可以直接解析；原生资源只来自相应目标生产树。 */
async function buildPiDependencyArtifact(options, tree, lock, id, artifacts) {
    const definition = shared.TASK_DEPENDENCIES[id];
    const keys = closure.dependencyClosure(lock, closure.PI_PACKAGES);
    const allKeys = new Set(Object.keys(lock.packages));
    const selected = [...tree.entries()].filter(([file]) => keys.has(closure.packageOwnerKey(file, allKeys)));
    const directory = path.join(options.workDirectory, definition.directory);
    const packageVersions = {};
    for (const [relative, entry] of selected) {
        const destination = path.join(directory, 'node_modules', relative);
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.copyFile(entry.source, destination);
        if (relative.endsWith('/package.json')) {
            const key = `node_modules/${relative.slice(0, -'/package.json'.length)}`;
            if (keys.has(key)) {
                const installed = JSON.parse(await fs.promises.readFile(destination, 'utf8'));
                if (installed.version !== lock.packages[key].version) throw new Error(`Pi真实生产包与锁版本不符：${key}`);
                packageVersions[key] = installed.version;
            }
        }
    }
    const packageVersion = lock.packages[`node_modules/${definition.packagePath}`]?.version;
    if (!packageVersion || !closure.PI_PACKAGES.every(name => packageVersions[`node_modules/${name}`])) throw new Error('Pi目标生产树缺少根SDK');
    for (const key of keys) {
        if (!packageVersions[key] && !lock.packages[key].optional && packageAllows(lock.packages[key], shared.TARGETS[definition.targetName])) {
            throw new Error(`Pi目标生产树缺少必需依赖：${key}`);
        }
        if (packageVersions[key]) {
            const metadata = JSON.parse(await fs.promises.readFile(path.join(directory, key, 'package.json'), 'utf8'));
            for (const name of Object.keys(metadata.dependencies || {})) {
                if (!metadata.optionalDependencies?.[name] && !closure.resolveLockedPackage(packageVersions, key, name)) {
                    throw new Error(`Pi独立制品缺少必需依赖：${key}/${name}`);
                }
            }
        }
    }
    const target = { ...shared.TARGETS[definition.targetName] };
    for (const [relative, entry] of selected.filter(([file]) => file.endsWith('.node'))) {
        const bytes = await fs.promises.readFile(entry.source);
        const napi = /napi/i.test(relative) || bytes.includes(Buffer.from('napi_register_module_v1')) || bytes.includes(Buffer.from('node_api_module_get_api_version_v1'));
        if (napi) { target.napiVersion = Number(process.versions.napi); continue; }
        const abi = bytes.toString('latin1').match(/node_register_module_v([0-9]+)/)?.[1] || options.nodeAbi;
        if (!abi || (target.nodeAbi && String(target.nodeAbi) !== String(abi))) throw new Error('Pi原生依赖缺少一致的Node ABI契约');
        target.nodeAbi = String(abi);
    }
    const contentSha256 = await archive.contentHash(path.join(directory, 'node_modules'));
    const previous = options.currentTaskDependencies?.[id];
    if (previous?.contentSha256 === contentSha256 && shared.canonicalJson(previous.target) === shared.canonicalJson(target) &&
        shared.canonicalJson(previous.packageVersions) === shared.canonicalJson(packageVersions)) {
        shared.validateTaskDependencies({ [id]: previous });
        const destination = path.join(options.outputDir, previous.relativeUrl);
        const root = fs.existsSync(destination) ? options.outputDir : options.currentArtifactRoot || '/mnt/aasc-offline';
        const file = path.join(root, previous.relativeUrl);
        require('../../src/apps/server/modules/aasc/dependency-tree').assertNoLinks(root, file);
        if (!fs.existsSync(file) || (await fs.promises.stat(file)).size !== previous.size || await archive.hashFile(file) !== previous.sha256) throw new Error('Pi复用制品校验失败');
        if (file !== destination) artifacts.push({ archivePath: file, relativeUrl: previous.relativeUrl, reused: true });
        return previous;
    }
    const version = previous ? previous.version + 1 : options.dependencyVersion;
    const metadata = { group: definition.directory, version, contentSha256, target, packageName: id, packageVersion, packageVersions };
    await fs.promises.writeFile(path.join(directory, 'dependency-group.json'), `${JSON.stringify(metadata)}\n`);
    const archivePath = path.join(options.workDirectory, `${definition.directory}-dependencies-v${version}.zip`);
    await deterministicZip(directory, archivePath);
    const relativeUrl = `dependencies/${definition.directory}/dependencies-v${version}.zip`;
    artifacts.push({ archivePath, relativeUrl });
    const entry = { ...metadata, relativeUrl, size: (await fs.promises.stat(archivePath)).size, sha256: await archive.hashFile(archivePath) };
    delete entry.group;
    return entry;
}
async function deterministicZip(directory, destination) {
    const yazl = require('yazl'); const { pipeline } = require('node:stream/promises'); const zip = new yazl.ZipFile();
    zip.addEmptyDirectory('node_modules/', { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o40755 });
    // 固定时间与权限，使同一组的内容不受不同出包时间影响。
    for (const file of await archive.treeFiles(directory)) zip.addFile(path.join(directory, file.path), file.path, { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100644 });
    const output = pipeline(zip.outputStream, fs.createWriteStream(destination, { flags: 'wx' }));
    zip.end(); await output;
}
module.exports = { buildDependencyGroups, selectFiles, binaryTarget, prebuildTarget, packageAllows, deterministicZip };
