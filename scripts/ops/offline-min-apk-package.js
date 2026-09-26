'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
    signManifestPayload,
    verifySignedManifest,
    validateManifestComponents
} = require('./offline-update-package');
const { loadOfflineUpdateKeyPair } = require('./offline-update-signing');

const execFileAsync = promisify(execFile);
const MAX_RELEASE_NOTES_CHARS = 4096;

function normalizeReleaseNotes(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    if ([...normalized].length > MAX_RELEASE_NOTES_CHARS) {
        throw new Error(`发布更新日志不能超过 ${MAX_RELEASE_NOTES_CHARS} 个 Unicode 字符`);
    }
    return normalized || null;
}

async function readReleaseNotes(options = {}) {
    if (options.releaseNotesFile) {
        const filePath = path.resolve(options.projectRoot || process.cwd(), options.releaseNotesFile);
        return normalizeReleaseNotes(await fs.promises.readFile(filePath, 'utf8'));
    }
    return normalizeReleaseNotes(options.releaseNotes);
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

async function readSignerSha256(apkPath, options = {}) {
    const commandRunner = options.commandRunner || execFileAsync;
    const result = await commandRunner(options.apksignerPath || process.env.AASC_APKSIGNER || 'apksigner', [
        'verify', '--print-certs', apkPath
    ], { encoding: 'utf8' });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const digests = [...output.matchAll(/certificate SHA-256 digest:\s*([a-f0-9:]+)/giu)]
        .map((match) => match[1].replace(/:/gu, '').toLowerCase());
    if (digests.length !== 1 || !/^[a-f0-9]{64}$/u.test(digests[0])) {
        throw new Error('无法从 apksigner 输出解析唯一的 APK signer SHA-256');
    }
    return digests[0];
}

async function readBuildMetadata(options) {
    const buildManifestPath = path.resolve(options.buildManifestPath || '');
    const apkPath = path.resolve(options.apkPath || '');
    const [manifest, apkStat, actualSha256] = await Promise.all([
        fs.promises.readFile(buildManifestPath, 'utf8').then(JSON.parse),
        fs.promises.stat(apkPath),
        sha256File(apkPath)
    ]);
    if (manifest.profile !== 'allserver-min' || manifest.updateOnly !== true) {
        throw new Error('APK build-manifest 必须来自 allserver-min update-only profile');
    }
    if (!Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1 ||
        typeof manifest.versionName !== 'string' || manifest.versionName.trim() === '') {
        throw new Error('APK build-manifest 缺少有效 versionCode/versionName');
    }
    if (!apkStat.isFile() || manifest.apk !== path.basename(apkPath) || manifest.sha256 !== actualSha256) {
        throw new Error('min APK 与 build-manifest 的文件名或 SHA-256 不一致');
    }
    return { manifest, apkPath, size: apkStat.size, sha256: actualSha256 };
}

async function createOfflineMinApkArtifact(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const artifactRoot = path.resolve(options.outputDir || path.join(projectRoot, 'release/offline-update/output'));
    const apkPath = path.resolve(options.apkPath || path.join(
        projectRoot,
        'release/apkbuild/allserver-min/output/aasc-display-offline-min.apk'
    ));
    const buildManifestPath = path.resolve(options.buildManifestPath || path.join(
        path.dirname(apkPath), 'build-manifest.json'
    ));
    const modelCompatibilityPath = path.resolve(options.modelCompatibilityPath || path.join(
        projectRoot,
        'release/apkbuild/allserver/runtime/assets/offline-model-compatibility.json'
    ));
    const currentManifestPath = options.currentManifestPath
        ? path.resolve(options.currentManifestPath)
        : null;
    if (!currentManifestPath) throw new Error('必须通过 currentManifestPath 指定当前已签名服务清单');

    const { privateKeyPem, publicKeyPem } = await loadOfflineUpdateKeyPair(options);
    const currentManifest = JSON.parse(await fs.promises.readFile(currentManifestPath, 'utf8'));
    verifySignedManifest(currentManifest, publicKeyPem);
    validateManifestComponents(currentManifest);

    const { manifest: buildManifest, apkPath: verifiedApkPath, size, sha256 } = await readBuildMetadata({
        apkPath,
        buildManifestPath
    });
    const compatibility = JSON.parse(await fs.promises.readFile(modelCompatibilityPath, 'utf8'));
    if (compatibility.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(compatibility.modelCompatibilitySha256 || '')) {
        throw new Error('完整 Offline APK 的 model compatibility 清单无效');
    }
    const signerSha256 = await readSignerSha256(verifiedApkPath, options);
    const releaseNotes = await readReleaseNotes({
        projectRoot,
        releaseNotes: options.releaseNotes,
        releaseNotesFile: options.releaseNotesFile
    });
    const previousVersion = currentManifest.payload.components.apkMin?.versionCode;
    if (Number.isSafeInteger(previousVersion) && buildManifest.versionCode <= previousVersion) {
        throw new Error(`min APK versionCode 必须大于已发布版本 ${previousVersion}`);
    }

    const relativeUrl = `apk/aasc-display-offline-min-v${buildManifest.versionCode}.apk`;
    const apkMin = {
        versionCode: buildManifest.versionCode,
        versionName: buildManifest.versionName,
        packageName: 'com.aasc.display.offline',
        signerSha256,
        modelCompatibilitySha256: compatibility.modelCompatibilitySha256,
        relativeUrl,
        size,
        sha256,
        ...(buildManifest.source ? { source: buildManifest.source } : {}),
        ...(releaseNotes ? { releaseNotes } : {})
    };
    const payload = {
        ...currentManifest.payload,
        generatedAt: options.generatedAt || new Date().toISOString(),
        components: {
            ...currentManifest.payload.components,
            apkMin
        }
    };
    const manifest = { payload, signature: signManifestPayload(payload, privateKeyPem) };
    verifySignedManifest(manifest, publicKeyPem);
    validateManifestComponents(manifest);

    const apkDestination = path.resolve(artifactRoot, ...relativeUrl.split('/'));
    const manifestPath = path.join(artifactRoot, 'manifests', `manifest-apk-min-v${buildManifest.versionCode}.json`);
    if (fs.existsSync(apkDestination)) throw new Error(`min APK artifact 已存在，拒绝覆盖: ${apkDestination}`);
    if (fs.existsSync(manifestPath)) throw new Error(`min APK manifest 已存在，拒绝覆盖: ${manifestPath}`);
    await fs.promises.mkdir(path.dirname(apkDestination), { recursive: true });
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });

    const temporaryApk = `${apkDestination}.tmp-${process.pid}-${Date.now()}`;
    const temporaryManifest = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
    try {
        await fs.promises.copyFile(verifiedApkPath, temporaryApk, fs.constants.COPYFILE_EXCL);
        if (await sha256File(temporaryApk) !== sha256) throw new Error('min APK 暂存副本 SHA-256 校验失败');
        await fs.promises.rename(temporaryApk, apkDestination);
        await fs.promises.writeFile(temporaryManifest, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
        await fs.promises.rename(temporaryManifest, manifestPath);
    } finally {
        await fs.promises.rm(temporaryApk, { force: true });
        await fs.promises.rm(temporaryManifest, { force: true });
    }
    return { manifest, manifestPath, apkPath: apkDestination, buildManifest };
}

function parseCliArguments(argv) {
    const supported = new Set([
        'apk', 'build-manifest', 'model-compatibility', 'manifest-file', 'output-dir', 'release-notes-file'
    ]);
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`不支持的位置参数: ${token}`);
        const equalIndex = token.indexOf('=');
        const key = equalIndex >= 0 ? token.slice(2, equalIndex) : token.slice(2);
        const value = equalIndex >= 0 ? token.slice(equalIndex + 1) : argv[++index];
        if (!supported.has(key)) throw new Error(`未知参数: --${key}`);
        if (typeof value !== 'string' || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
        const normalizedKey = key.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
        if (Object.hasOwn(parsed, normalizedKey)) throw new Error(`参数 --${key} 不能重复`);
        parsed[normalizedKey] = value;
    }
    return parsed;
}

async function runCli(argv = process.argv.slice(2)) {
    try {
        const cli = parseCliArguments(argv);
        if (!cli.manifestFile) throw new Error('请通过 --manifest-file 指定当前已签名服务清单');
        const result = await createOfflineMinApkArtifact({
            apkPath: cli.apk,
            buildManifestPath: cli.buildManifest,
            modelCompatibilityPath: cli.modelCompatibility,
            currentManifestPath: cli.manifestFile,
            releaseNotesFile: cli.releaseNotesFile,
            outputDir: cli.outputDir
        });
        console.log(`min APK: ${result.apkPath}`);
        console.log(`签名清单: ${result.manifestPath}`);
    } catch (error) {
        console.error(`生成 Offline min APK 更新清单失败: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) runCli();

module.exports = {
    createOfflineMinApkArtifact,
    normalizeReleaseNotes,
    readReleaseNotes,
    readSignerSha256,
    parseCliArguments,
    runCli
};
