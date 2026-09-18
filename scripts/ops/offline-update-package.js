'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { loadOfflineUpdateKeyPair } = require('./offline-update-signing');

const execFileAsync = promisify(execFile);
const CODE_ENTRYPOINT = 'src/apps/server/boot/server-launcher.js';
const SIGNATURE_ALGORITHM = 'SHA256withRSA';
const UPDATE_BASE_URLS = Object.freeze([
    'http://192.168.1.39/mnt/aasc-offline/',
    'http://c.aasc.us/mnt/aasc-offline/'
]);

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
    }
    return value;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value));
}

function signManifestPayload(payload, privateKeyPem) {
    if (!privateKeyPem) throw new Error('Offline 更新清单签名私钥未提供');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(canonicalJson(payload), 'utf8');
    signer.end();
    return {
        algorithm: SIGNATURE_ALGORITHM,
        value: signer.sign(privateKeyPem, 'base64')
    };
}

function verifySignedManifest(manifest, publicKeyPem) {
    if (!manifest || typeof manifest !== 'object' || !manifest.payload || !manifest.signature) {
        throw new Error('Offline 更新清单格式无效');
    }
    if (!publicKeyPem) throw new Error('Offline 更新清单验证公钥未提供');
    if (manifest.signature.algorithm !== SIGNATURE_ALGORITHM ||
        typeof manifest.signature.value !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.signature.value)) {
        throw new Error('Offline 更新清单签名字段无效');
    }
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonicalJson(manifest.payload), 'utf8');
    verifier.end();
    if (!verifier.verify(publicKeyPem, manifest.signature.value, 'base64')) {
        throw new Error('Offline 更新清单签名验证失败');
    }
    return true;
}

function isSha256(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validateArtifactEntry(entry, name) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Offline 清单 ${name} 组件无效`);
    }
    assertVersion(entry.version, `${name}.version`);
    if (typeof entry.relativeUrl !== 'string' || entry.relativeUrl.trim() === '' ||
        entry.relativeUrl.startsWith('/') || entry.relativeUrl.includes('\\') ||
        entry.relativeUrl.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error(`Offline 清单 ${name}.relativeUrl 不安全`);
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 1 || !isSha256(entry.sha256)) {
        throw new Error(`Offline 清单 ${name} 大小或 SHA-256 无效`);
    }
}

function validateManifestComponents(manifest) {
    if (manifest.payload.schemaVersion !== 1 ||
        !manifest.payload.components || typeof manifest.payload.components !== 'object' ||
        Array.isArray(manifest.payload.components)) {
        throw new Error('Offline 更新清单 schemaVersion/components 无效');
    }
    const { code, dependencies, apkMin } = manifest.payload.components;
    validateArtifactEntry(code, 'code');
    validateArtifactEntry(dependencies, 'dependencies');
    assertVersion(code.requiredDependencyVersion, 'code.requiredDependencyVersion');
    if (code.requiredDependencyVersion !== dependencies.version ||
        !isSha256(code.requiredLockSha256) || code.requiredLockSha256 !== dependencies.lockSha256 ||
        !isSha256(dependencies.lockSha256)) {
        throw new Error('Offline 清单 code/dependencies 版本或 lockfile 指纹不匹配');
    }
    if (apkMin !== undefined) {
        validateArtifactEntry({ ...apkMin, version: apkMin.versionCode }, 'apkMin');
        if (typeof apkMin.versionName !== 'string' || apkMin.versionName.trim() === '') {
            throw new Error('Offline 清单 apkMin.versionName 无效');
        }
        if (apkMin.packageName !== 'com.aasc.display.offline' ||
            !isSha256(apkMin.signerSha256) || !isSha256(apkMin.modelCompatibilitySha256)) {
            throw new Error('Offline 清单 apkMin 包名、签名证书或模型兼容指纹无效');
        }
    }
}

function publicKeyFromPrivateKey(privateKeyPem) {
    return crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem))
        .export({ type: 'spki', format: 'pem' });
}

async function fetchCurrentManifestFromNetwork(options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 运行时不支持 fetch');
    const baseUrls = options.baseUrls || UPDATE_BASE_URLS;
    if (!Array.isArray(baseUrls) || baseUrls.length === 0) throw new Error('Offline 更新源列表不能为空');
    let notFoundCount = 0;
    let lastNetworkError = null;
    for (const baseUrl of baseUrls) {
        let response;
        try {
            response = await fetchImpl(new URL('manifest.json', baseUrl), {
                signal: AbortSignal.timeout(options.timeoutMs || 5000)
            });
        } catch (error) {
            lastNetworkError = error;
            continue;
        }
        if (response.status === 404) {
            notFoundCount += 1;
            continue;
        }
        if (!response.ok) {
            lastNetworkError = new Error(`读取更新清单失败，HTTP ${response.status}: ${baseUrl}`);
            continue;
        }
        try {
            return JSON.parse(await response.text());
        } catch (error) {
            throw new Error(`更新源返回的 manifest.json 不是有效 JSON: ${error.message}`, { cause: error });
        }
    }
    if (lastNetworkError) {
        throw new Error(`无法从局域网或外网读取当前 Offline 更新清单: ${lastNetworkError.message}`, {
            cause: lastNetworkError
        });
    }
    if (notFoundCount === baseUrls.length) return null;
    throw new Error('局域网和外网更新源均未返回清单');
}

function assertVersion(value, name) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} 必须是大于 0 的安全整数`);
    }
}

function assertNewVersion(next, previous, name) {
    assertVersion(next, name);
    if (Number.isSafeInteger(previous) && next <= previous) {
        throw new Error(`${name} 必须大于当前已发布版本 ${previous}`);
    }
}

function sha256Buffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

async function describeArtifact(filePath, relativeUrl) {
    const stat = await fs.promises.stat(filePath);
    return {
        relativeUrl,
        size: stat.size,
        sha256: await sha256File(filePath)
    };
}

function createOutputTemporaryPath(destinationPath) {
    return path.join(
        path.dirname(destinationPath),
        `.${path.basename(destinationPath)}.tmp-${process.pid}-${crypto.randomUUID()}`
    );
}

async function atomicallyCopyToOutput(sourcePath, destinationPath) {
    const temporaryPath = createOutputTemporaryPath(destinationPath);
    try {
        await fs.promises.copyFile(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
        await fs.promises.rename(temporaryPath, destinationPath);
    } finally {
        await fs.promises.rm(temporaryPath, { force: true });
    }
}

async function atomicallyWriteOutput(destinationPath, contents) {
    const temporaryPath = createOutputTemporaryPath(destinationPath);
    try {
        await fs.promises.writeFile(temporaryPath, contents, { flag: 'wx' });
        await fs.promises.rename(temporaryPath, destinationPath);
    } finally {
        await fs.promises.rm(temporaryPath, { force: true });
    }
}

async function copyCodeSnapshot(projectRoot, stagingDirectory) {
    const sourceRoot = path.join(projectRoot, 'src');
    const targetRoot = path.join(stagingDirectory, 'src');
    const sourceStat = await fs.promises.lstat(sourceRoot).catch(() => null);
    if (!sourceStat?.isDirectory()) throw new Error(`服务源码目录不存在: ${sourceRoot}`);
    if (sourceStat.isSymbolicLink()) throw new Error(`服务源码根目录不能是符号链接: ${sourceRoot}`);

    await fs.promises.mkdir(targetRoot, { recursive: true });
    const excludedPath = path.resolve(sourceRoot, 'apps', 'android-display');
    const copySelectedTree = async (relativePath = '') => {
        const sourceDirectory = path.join(sourceRoot, relativePath);
        const entries = await fs.promises.readdir(sourceDirectory, { withFileTypes: true });
        for (const entry of entries) {
            const childRelativePath = path.join(relativePath, entry.name);
            const sourcePath = path.join(sourceRoot, childRelativePath);
            if (path.resolve(sourcePath) === excludedPath || path.resolve(sourcePath).startsWith(`${excludedPath}${path.sep}`)) {
                continue;
            }
            const stat = await fs.promises.lstat(sourcePath);
            if (stat.isSymbolicLink()) throw new Error(`源码发布包不允许符号链接: ${childRelativePath}`);
            const targetPath = path.join(targetRoot, childRelativePath);
            if (stat.isDirectory()) {
                await fs.promises.mkdir(targetPath, { recursive: true });
                await copySelectedTree(childRelativePath);
            } else if (stat.isFile()) {
                await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.promises.copyFile(sourcePath, targetPath);
            } else {
                throw new Error(`源码发布包包含不支持的文件类型: ${childRelativePath}`);
            }
        }
    };
    await copySelectedTree();
    for (const fileName of ['package.json', 'package-lock.json']) {
        const sourcePath = path.join(projectRoot, fileName);
        const stat = await fs.promises.lstat(sourcePath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${fileName} 必须是普通文件`);
        await fs.promises.copyFile(sourcePath, path.join(stagingDirectory, fileName));
    }
    if (!fs.existsSync(path.join(stagingDirectory, CODE_ENTRYPOINT))) {
        throw new Error(`源码发布包缺少服务器入口: ${CODE_ENTRYPOINT}`);
    }
}

async function createZip(stagingDirectory, archivePath, commandRunner) {
    await fs.promises.mkdir(path.dirname(archivePath), { recursive: true });
    await commandRunner('zip', ['-X', '-q', '-r', archivePath, '.'], { cwd: stagingDirectory });
    if (!fs.existsSync(archivePath) || (await fs.promises.stat(archivePath)).size === 0) {
        throw new Error(`生成更新档案失败: ${archivePath}`);
    }
}

async function assertTreeHasNoSpecialEntries(rootDirectory, label) {
    const pendingDirectories = [rootDirectory];
    while (pendingDirectories.length > 0) {
        const currentDirectory = pendingDirectories.pop();
        const entries = await fs.promises.readdir(currentDirectory, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDirectory, entry.name);
            const stat = await fs.promises.lstat(fullPath);
            const relativePath = path.relative(rootDirectory, fullPath);
            if (stat.isSymbolicLink()) throw new Error(`${label} 不允许符号链接: ${relativePath}`);
            if (stat.isDirectory()) pendingDirectories.push(fullPath);
            else if (!stat.isFile()) throw new Error(`${label} 包含不支持的文件类型: ${relativePath}`);
        }
    }
}

async function removeNpmToolShimDirectories(rootDirectory, relativePath = '') {
    const currentDirectory = path.join(rootDirectory, relativePath);
    const entries = await fs.promises.readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
        const childRelativePath = path.join(relativePath, entry.name);
        const childPath = path.join(rootDirectory, childRelativePath);
        const stat = await fs.promises.lstat(childPath);
        if (entry.name === '.bin') {
            if (!stat.isDirectory() || stat.isSymbolicLink()) {
                throw new Error(`Android production dependencies 的 npm .bin 必须是普通目录: ${childRelativePath}`);
            }
            // APK Node Runtime 不运行 npm CLI，.bin 仅是 npm 生成的可执行入口软链接。
            // 移除整个工具目录，避免把主机路径软链接带进 Android 更新 ZIP。
            await fs.promises.rm(childPath, { recursive: true, force: true });
            continue;
        }
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
            await removeNpmToolShimDirectories(rootDirectory, childRelativePath);
        }
    }
}

async function readManifest(value) {
    if (typeof value === 'string') {
        return JSON.parse(await fs.promises.readFile(value, 'utf8'));
    }
    return value;
}

async function runNpmCi(stagingDirectory, commandRunner) {
    const npmCommand = process.env.npm_execpath || 'npm';
    await commandRunner(npmCommand, ['ci', '--omit=dev', '--ignore-scripts'], {
        cwd: stagingDirectory,
        env: process.env
    });
}

async function buildDependencyArchive(options) {
    const { projectRoot, workDirectory, dependencyVersion, lockSha256, commandRunner, zipRunner } = options;
    const stagingDirectory = path.join(workDirectory, 'dependencies');
    await fs.promises.mkdir(stagingDirectory, { recursive: true });
    await fs.promises.copyFile(path.join(projectRoot, 'package.json'), path.join(stagingDirectory, 'package.json'));
    await fs.promises.copyFile(path.join(projectRoot, 'package-lock.json'), path.join(stagingDirectory, 'package-lock.json'));
    await runNpmCi(stagingDirectory, commandRunner);

    const packageJson = JSON.parse(await fs.promises.readFile(path.join(stagingDirectory, 'package.json'), 'utf8'));
    const nodeModules = path.join(stagingDirectory, 'node_modules');
    const expressPackage = path.join(nodeModules, 'express', 'package.json');
    if (!packageJson.dependencies?.express || !fs.existsSync(expressPackage)) {
        throw new Error('Android production dependencies 缺少 express');
    }
    await removeNpmToolShimDirectories(nodeModules);
    await assertTreeHasNoSpecialEntries(nodeModules, 'Android production dependencies');
    await fs.promises.rm(path.join(stagingDirectory, 'package.json'));
    await fs.promises.rm(path.join(stagingDirectory, 'package-lock.json'));
    await fs.promises.writeFile(path.join(stagingDirectory, 'dependency-manifest.json'), JSON.stringify({
        version: dependencyVersion,
        lockSha256
    }, null, 2) + '\n');

    const archivePath = path.join(workDirectory, `dependencies-v${dependencyVersion}.zip`);
    await createZip(stagingDirectory, archivePath, zipRunner);
    return {
        archivePath,
        relativeUrl: `dependencies/${path.basename(archivePath)}`
    };
}

async function loadCurrentManifest(options, publicKeyPem) {
    if (options.currentManifest) {
        const manifest = await readManifest(options.currentManifest);
        verifySignedManifest(manifest, publicKeyPem);
        validateManifestComponents(manifest);
        return manifest;
    }
    if (!options.fetchCurrentManifest) return null;
    const manifest = await options.fetchCurrentManifest(UPDATE_BASE_URLS);
    if (!manifest) return null;
    verifySignedManifest(manifest, publicKeyPem);
    validateManifestComponents(manifest);
    return manifest;
}

async function createOfflineUpdateArtifacts(options = {}) {
    const mode = String(options.mode || '').trim();
    if (!['code-only', 'all'].includes(mode)) throw new Error('更新模式必须是 code-only 或 all');
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const outputDir = path.resolve(options.outputDir || path.join(projectRoot, 'release/offline-update/output'));
    const codeVersion = Number(options.codeVersion);
    assertVersion(codeVersion, 'codeVersion');

    const keyPair = await loadOfflineUpdateKeyPair(options);
    const { privateKeyPem, publicKeyPem } = keyPair;
    const currentManifest = await loadCurrentManifest(options, publicKeyPem);
    const currentComponents = currentManifest?.payload?.components || {};
    if (currentManifest && currentManifest.payload.schemaVersion !== 1) {
        throw new Error('当前 Offline 更新清单 schemaVersion 不支持');
    }
    assertNewVersion(codeVersion, currentComponents.code?.version, 'codeVersion');

    const packageLockPath = path.join(projectRoot, 'package-lock.json');
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const [packageJsonText, packageLockBuffer] = await Promise.all([
        fs.promises.readFile(packageJsonPath, 'utf8'),
        fs.promises.readFile(packageLockPath)
    ]);
    const packageJson = JSON.parse(packageJsonText);
    const lockSha256 = sha256Buffer(packageLockBuffer);
    let dependencyVersion = null;
    if (mode === 'code-only') {
        const currentDependencies = currentComponents.dependencies;
        if (!currentDependencies || !Number.isSafeInteger(currentDependencies.version)) {
            throw new Error('code-only 需要有效的已发布 dependencies 版本');
        }
        if (lockSha256 !== currentDependencies.lockSha256) {
            throw new Error('package-lock.json 指纹与已发布 dependencies 不一致；请使用 all 模式');
        }
        if (!packageJson.dependencies || !Object.keys(packageJson.dependencies).length) {
            throw new Error('服务 package.json 缺少 production dependencies');
        }
        dependencyVersion = currentDependencies.version;
    } else {
        dependencyVersion = Number(options.dependencyVersion);
        assertVersion(dependencyVersion, 'dependencyVersion');
        assertNewVersion(dependencyVersion, currentComponents.dependencies?.version, 'dependencyVersion');
    }

    const zipRunner = options.zipRunner || execFileAsync;
    const commandRunner = options.commandRunner || execFileAsync;
    const workDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-offline-update-'));
    const stagedCodeArchive = path.join(workDirectory, `code-v${codeVersion}.zip`);
    let codeArchivePath = null;
    let dependenciesArchivePath = null;
    try {
        const codeDirectory = path.join(workDirectory, 'code');
        await fs.promises.mkdir(codeDirectory, { recursive: true });
        await copyCodeSnapshot(projectRoot, codeDirectory);
        await createZip(codeDirectory, stagedCodeArchive, zipRunner);

        const codeDestinationDirectory = path.join(outputDir, 'code');
        const codeDestination = path.join(codeDestinationDirectory, path.basename(stagedCodeArchive));
        if (fs.existsSync(codeDestination)) throw new Error(`代码包版本文件已存在，拒绝覆盖: ${codeDestination}`);
        await fs.promises.mkdir(codeDestinationDirectory, { recursive: true });

        let stagedDependencies = null;
        let finalDependenciesArchivePath = null;
        if (mode === 'all') {
            finalDependenciesArchivePath = path.join(outputDir, 'dependencies', `dependencies-v${dependencyVersion}.zip`);
            if (fs.existsSync(finalDependenciesArchivePath)) {
                throw new Error(`依赖包版本文件已存在，拒绝覆盖: ${finalDependenciesArchivePath}`);
            }
            stagedDependencies = await buildDependencyArchive({
                projectRoot,
                workDirectory,
                outputDir,
                dependencyVersion,
                lockSha256,
                commandRunner,
                zipRunner
            });
            dependenciesArchivePath = stagedDependencies.archivePath;
        }

        const payload = {
            schemaVersion: 1,
            generatedAt: options.generatedAt || new Date().toISOString(),
            components: {
                ...currentComponents,
                code: {
                    version: codeVersion,
                    requiredDependencyVersion: dependencyVersion,
                    requiredLockSha256: lockSha256,
                    ...(await describeArtifact(stagedCodeArchive, `code/${path.basename(codeDestination)}`))
                }
            }
        };
        if (mode === 'all') {
            payload.components.dependencies = {
                version: dependencyVersion,
                lockSha256,
                ...(await describeArtifact(dependenciesArchivePath, `dependencies/${path.basename(dependenciesArchivePath)}`))
            };
        }
        const manifest = {
            payload,
            signature: signManifestPayload(payload, privateKeyPem)
        };
        verifySignedManifest(manifest, publicKeyPem);
        validateManifestComponents(manifest);
        const manifestDirectory = path.join(outputDir, 'manifests');
        const manifestPath = path.join(manifestDirectory, `manifest-code-v${codeVersion}.json`);
        if (fs.existsSync(manifestPath)) throw new Error(`更新清单版本文件已存在，拒绝覆盖: ${manifestPath}`);

        await atomicallyCopyToOutput(stagedCodeArchive, codeDestination);
        codeArchivePath = codeDestination;
        if (mode === 'all') {
            await fs.promises.mkdir(path.dirname(finalDependenciesArchivePath), { recursive: true });
            await atomicallyCopyToOutput(dependenciesArchivePath, finalDependenciesArchivePath);
            dependenciesArchivePath = finalDependenciesArchivePath;
        }
        await fs.promises.mkdir(manifestDirectory, { recursive: true });
        await atomicallyWriteOutput(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        return {
            mode,
            manifest,
            manifestPath,
            codeArchivePath,
            dependenciesArchivePath,
            publicKeyPem,
            publicKeyPath: keyPair.publicKeyPath
        };
    } catch (error) {
        throw new Error(`生成 Offline 更新包失败: ${error.message}`, { cause: error });
    } finally {
        await fs.promises.rm(workDirectory, { recursive: true, force: true });
    }
}

function parseCliArguments(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`不支持的位置参数: ${token}`);
        const equalIndex = token.indexOf('=');
        const key = equalIndex >= 0 ? token.slice(2, equalIndex) : token.slice(2);
        if (key === 'bootstrap') {
            if (equalIndex >= 0) throw new Error('参数 --bootstrap 不接收值');
            if (Object.hasOwn(parsed, 'bootstrap')) throw new Error('参数 --bootstrap 不能重复');
            parsed.bootstrap = true;
            continue;
        }
        const value = equalIndex >= 0 ? token.slice(equalIndex + 1) : argv[++index];
        if (!['mode', 'code-version', 'dependency-version', 'output-dir', 'manifest-file'].includes(key)) {
            throw new Error(`未知构建参数: --${key}`);
        }
        if (typeof value !== 'string' || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
        const fieldName = key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        if (Object.prototype.hasOwnProperty.call(parsed, fieldName)) throw new Error(`参数 --${key} 不能重复`);
        parsed[fieldName] = key.endsWith('version') ? Number(value) : value;
    }
    return parsed;
}

async function runCli(argv = process.argv.slice(2)) {
    try {
        const cliOptions = parseCliArguments(argv);
        if (cliOptions.bootstrap && cliOptions.mode !== 'all') {
            throw new Error('--bootstrap 仅允许和 --mode=all 一起使用');
        }
        const currentManifest = cliOptions.manifestFile
            ? await readManifest(path.resolve(cliOptions.manifestFile))
            : cliOptions.bootstrap ? null : await fetchCurrentManifestFromNetwork();
        delete cliOptions.manifestFile;
        delete cliOptions.bootstrap;
        const projectRoot = path.resolve(__dirname, '../..');
        const result = await createOfflineUpdateArtifacts({
            ...cliOptions,
            currentManifest,
            projectRoot
        });
        console.log(`更新模式: ${result.mode}`);
        console.log(`代码包: ${result.codeArchivePath}`);
        if (result.dependenciesArchivePath) console.log(`依赖包: ${result.dependenciesArchivePath}`);
        console.log(`签名清单: ${result.manifestPath}`);
        console.log(`验证公钥: ${result.publicKeyPath || '由调用方提供'}`);
    } catch (error) {
        console.error(`Offline 更新包构建失败: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) runCli();

module.exports = {
    createOfflineUpdateArtifacts,
    canonicalJson,
    signManifestPayload,
    verifySignedManifest,
    validateManifestComponents,
    publicKeyFromPrivateKey,
    sha256Buffer,
    UPDATE_BASE_URLS,
    fetchCurrentManifestFromNetwork,
    parseCliArguments,
    runCli
};
