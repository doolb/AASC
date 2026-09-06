'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_SERVER_URL = 'https://192.168.1.39:8081';
const DEFAULT_SERVICE_NAME = 'aasc-server-test';
const RELEASE_FILES = ['src', 'package.json', 'package-lock.json'];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Termux 节点 Bootstrap。
 *
 * run 模式只负责承接主服务器的双进程启动模型；update 模式是一次性更新命令，
 * 不作为第三个常驻进程运行。所有代码替换都限定在 RELEASE_FILES 白名单内。
 */
function createBootstrap(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || process.env.AASC_PROJECT_ROOT || process.cwd());
    const serverUrl = options.serverUrl || process.env.AASC_MAIN_SERVER_URL || DEFAULT_SERVER_URL;
    const serviceName = options.serviceName || process.env.AASC_SERVICE_NAME || DEFAULT_SERVICE_NAME;
    const temporaryRoot = path.resolve(options.temporaryRoot || path.join(projectRoot, '.aasc-update'));
    const requestJson = options.requestJson || ((url) => requestJsonByHttp(url));
    const downloadPackage = options.downloadPackage || ((url, targetPath) => downloadFileByHttp(url, targetPath));
    const serviceController = options.serviceController || createRunitServiceController(serviceName);
    const healthCheck = options.healthCheck || (() => checkServerHealth(serverUrl));

    function run() {
        const launcherPath = path.join(projectRoot, 'src/apps/server/boot/server-launcher.js');
        const serverPath = path.join(projectRoot, 'src/apps/server/boot/server-app.js');
        const { createServerLauncher } = require(launcherPath);
        const launcher = createServerLauncher({
            serverPath,
            processArguments: ['--no-tui']
        });
        return launcher.start();
    }

    async function update(options = {}) {
        const force = options.force === true;
        let manifest = null;
        let backup = null;
        let temporaryDirectory = null;
        const updateId = `${Date.now()}-${process.pid}`;

        try {
            const manifestUrl = force
                ? appendQueryParameter(resolveUrl(serverUrl, '/server'), 'force', updateId)
                : resolveUrl(serverUrl, '/server');
            manifest = normalizeManifest(await requestJson(manifestUrl));
            validateManifest(manifest);

            temporaryDirectory = path.join(temporaryRoot, `${safeVersion(manifest.version)}-${updateId}`);
            const archivePath = path.join(temporaryDirectory, 'release.tar.gz');
            const stagingPath = path.join(temporaryDirectory, 'staging');
            await fs.promises.mkdir(stagingPath, { recursive: true });
            const packageUrl = resolveUrl(serverUrl, manifest.packageUrl);
            const downloadUrl = force
                ? appendQueryParameter(packageUrl, 'force', updateId)
                : packageUrl;
            await downloadPackage(downloadUrl, archivePath);
            await verifyArchive(archivePath, manifest);
            await extractAndValidate(archivePath, stagingPath);

            await serviceController.stop();
            backup = await backupRelease(projectRoot, updateId);
            await installRelease(stagingPath, projectRoot);
            await serviceController.start();
            if (!(await healthCheck())) {
                throw new Error('新版本健康检查失败');
            }

            await cleanupTemporaryDirectory(temporaryDirectory);
            return force
                ? { success: true, version: manifest.version, forced: true, rolledBack: false }
                : { success: true, version: manifest.version, rolledBack: false };
        } catch (error) {
            let rolledBack = false;
            if (backup) {
                try {
                    await serviceController.stop();
                    await restoreRelease(projectRoot, backup);
                    await serviceController.start();
                    rolledBack = true;
                } catch (rollbackError) {
                    error.message += `；回滚失败: ${rollbackError.message}`;
                }
            }
            await cleanupTemporaryDirectory(temporaryDirectory);
            const result = {
                success: false,
                version: manifest ? manifest.version : null,
                rolledBack,
                message: error.message
            };
            if (force) {
                result.forced = true;
            }
            return result;
        }
    }

    return { run, update };
}

function createRunitServiceController(serviceName) {
    return {
        async stop() {
            await execFileAsync('sv', ['stop', serviceName]);
        },
        async start() {
            await execFileAsync('sv', ['start', serviceName]);
        }
    };
}

function normalizeManifest(payload) {
    const manifest = payload && payload.manifest ? payload.manifest : payload;
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('主服务器版本清单格式无效');
    }
    return manifest;
}

function validateManifest(manifest) {
    if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
        throw new Error('版本清单缺少 version');
    }
    if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) {
        throw new Error('版本清单 size 无效');
    }
    if (typeof manifest.sha256 !== 'string' || !SHA256_PATTERN.test(manifest.sha256)) {
        throw new Error('版本清单 sha256 无效');
    }
    if (typeof manifest.packageUrl !== 'string' || manifest.packageUrl.trim() === '') {
        throw new Error('版本清单缺少 packageUrl');
    }
    if (!Array.isArray(manifest.files) || manifest.files.some(file => !RELEASE_FILES.includes(file))) {
        throw new Error('版本清单 files 超出代码白名单');
    }
}

async function verifyArchive(archivePath, manifest) {
    const stat = await fs.promises.stat(archivePath);
    if (stat.size !== manifest.size) {
        throw new Error(`代码包大小校验失败: ${stat.size} !== ${manifest.size}`);
    }
    const sha256 = await hashFile(archivePath);
    if (sha256 !== manifest.sha256) {
        throw new Error(`代码包 SHA-256 校验失败: ${sha256}`);
    }
}

async function extractAndValidate(archivePath, stagingPath) {
    const { stdout } = await execFileAsync('tar', ['-tzf', archivePath]);
    const entries = stdout.split('\n').map(entry => entry.trim()).filter(Boolean);
    for (const entry of entries) {
        validateArchiveEntry(entry);
    }
    await execFileAsync('tar', ['-xzf', archivePath, '-C', stagingPath]);

    for (const releaseFile of RELEASE_FILES) {
        const targetPath = path.join(stagingPath, releaseFile);
        if (!fs.existsSync(targetPath)) {
            throw new Error(`代码包缺少文件: ${releaseFile}`);
        }
    }
    if (!fs.existsSync(path.join(stagingPath, 'src/apps/server/boot/server-app.js'))) {
        throw new Error('代码包缺少 server-app.js');
    }
}

function validateArchiveEntry(entry) {
    const normalizedEntry = entry.replace(/^\.\//, '');
    const normalizedPath = path.posix.normalize(normalizedEntry);
    if (path.posix.isAbsolute(normalizedEntry)
        || normalizedPath === '..'
        || normalizedPath.startsWith('../')
        || normalizedEntry.includes('\\')) {
        throw new Error(`代码包包含危险路径: ${entry}`);
    }
    const allowed = RELEASE_FILES.some(file => normalizedPath === file || normalizedPath.startsWith(`${file}/`));
    if (!allowed) {
        throw new Error(`代码包包含非白名单路径: ${entry}`);
    }
}

async function backupRelease(projectRoot, updateId) {
    const backupRoot = path.join(projectRoot, '.aasc-previous', updateId);
    await fs.promises.mkdir(backupRoot, { recursive: true });
    const entries = [];
    for (const releaseFile of RELEASE_FILES) {
        const sourcePath = path.join(projectRoot, releaseFile);
        const backupPath = path.join(backupRoot, releaseFile);
        const existed = fs.existsSync(sourcePath);
        entries.push({ releaseFile, existed });
        if (existed) {
            await fs.promises.cp(sourcePath, backupPath, { recursive: true });
        }
    }
    return { root: backupRoot, entries };
}

async function installRelease(stagingPath, projectRoot) {
    for (const releaseFile of RELEASE_FILES) {
        const sourcePath = path.join(stagingPath, releaseFile);
        const targetPath = path.join(projectRoot, releaseFile);
        if (releaseFile === 'src') {
            // src 内含不随服务器包发布的 Android 工程等本地目录，只合并覆盖发布文件，不能整目录删除。
            await fs.promises.mkdir(targetPath, { recursive: true });
            await fs.promises.cp(sourcePath, targetPath, { recursive: true, force: true });
            continue;
        }
        await fs.promises.rm(targetPath, { recursive: true, force: true });
        await fs.promises.cp(sourcePath, targetPath, { recursive: true });
    }
}

async function restoreRelease(projectRoot, backup) {
    for (const { releaseFile, existed } of backup.entries) {
        const targetPath = path.join(projectRoot, releaseFile);
        await fs.promises.rm(targetPath, { recursive: true, force: true });
        if (existed) {
            await fs.promises.cp(path.join(backup.root, releaseFile), targetPath, { recursive: true });
        }
    }
}

async function cleanupTemporaryDirectory(directory) {
    if (!directory) {
        return;
    }
    try {
        await fs.promises.rm(directory, { recursive: true, force: true });
    } catch (error) {
        // 清理失败不应覆盖更新结果，下一次 Bootstrap 可以复用或清理临时目录。
    }
}

function requestJsonByHttp(url) {
    return requestByHttp(url, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => body += chunk);
        return new Promise((resolve, reject) => {
            response.once('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error(`主服务器 JSON 响应无效: ${error.message}`));
                }
            });
            response.once('error', reject);
        });
    });
}

function downloadFileByHttp(url, targetPath) {
    return requestByHttp(url, response => new Promise((resolve, reject) => {
        const output = fs.createWriteStream(targetPath);
        response.pipe(output);
        output.once('finish', resolve);
        output.once('error', reject);
        response.once('error', reject);
    }));
}

function requestByHttp(url, consumeResponse) {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const requestOptions = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        timeout: 30000
    };
    if (parsed.protocol === 'https:') {
        requestOptions.rejectUnauthorized = false;
    }

    return new Promise((resolve, reject) => {
        const request = client.request(requestOptions, async response => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
                response.resume();
                reject(new Error(`主服务器返回 HTTP ${response.statusCode}`));
                return;
            }
            try {
                resolve(await consumeResponse(response));
            } catch (error) {
                reject(error);
            }
        });
        request.once('timeout', () => request.destroy(new Error('主服务器请求超时')));
        request.once('error', reject);
        request.end();
    });
}

async function checkServerHealth(baseUrl) {
    for (const endpoint of ['/api/status', '/control', '/display', '/api/aasc/servers']) {
        await requestByHttp(resolveUrl(baseUrl, endpoint), response => {
            response.resume();
            return Promise.resolve();
        });
    }
    return true;
}

function resolveUrl(baseUrl, relativeUrl) {
    return new URL(relativeUrl, `${String(baseUrl).replace(/\/+$/, '')}/`).toString();
}

function appendQueryParameter(url, name, value) {
    const parsed = new URL(url);
    parsed.searchParams.set(name, value);
    return parsed.toString();
}

function safeVersion(version) {
    return String(version).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'unknown';
}

function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.once('error', reject);
        stream.once('end', () => resolve(hash.digest('hex')));
    });
}

function parseArguments(argumentsList) {
    const result = { command: argumentsList[0] || 'help' };
    for (let index = 1; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index];
        const nextValue = argumentsList[index + 1];
        if (argument === '--server-url' && nextValue) {
            result.serverUrl = nextValue;
            index += 1;
        } else if (argument === '--project-root' && nextValue) {
            result.projectRoot = nextValue;
            index += 1;
        } else if (argument === '--service-name' && nextValue) {
            result.serviceName = nextValue;
            index += 1;
        } else if (argument === '--force') {
            result.force = true;
        }
    }
    return result;
}

async function main(argumentsList = process.argv.slice(2)) {
    const argumentsConfig = parseArguments(argumentsList);
    const bootstrap = createBootstrap(argumentsConfig);
    if (argumentsConfig.command === 'run') {
        bootstrap.run();
        return;
    }
    if (argumentsConfig.command === 'update') {
        const result = await bootstrap.update({ force: argumentsConfig.force === true });
        console.log(JSON.stringify(result));
        if (!result.success) {
            process.exitCode = 1;
        }
        return;
    }
    console.log('用法: node aasc-server-bootstrap.cjs run|update [--force] [--server-url URL] [--project-root PATH] [--service-name NAME]');
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Bootstrap 执行失败: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_SERVER_URL,
    DEFAULT_SERVICE_NAME,
    RELEASE_FILES,
    checkServerHealth,
    createBootstrap,
    hashFile,
    normalizeManifest,
    parseArguments,
    validateArchiveEntry,
    validateManifest
};
