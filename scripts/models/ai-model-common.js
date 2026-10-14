'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MODEL_ROOT = path.resolve(__dirname, '../../res/models');
const SOURCE_URL = 'https://c.aasc.us/mnt/aimodel/';
// 分类采用固定目录，模型格式按文件名筛选，避免把测试音频、脚本和缓存上传。
const RULES = Object.freeze({
    yolo11: /^yolo\d+[nsmlx](?:-[a-z]+)?\.(?:onnx|pt|classes\.json)(?:\.sha256)?$/u,
    sensevoice: /^(?:model(?:\.[A-Za-z0-9_-]+)*\.onnx|tokens\.txt)(?:\.sha256)?$/u,
    'streaming-zipformer': /^(?:(?:encoder|decoder|joiner)(?:\.[A-Za-z0-9_-]+)*\.onnx|tokens\.txt)(?:\.sha256)?$/u,
    voiceprint: /^(?:3dspeaker_[A-Za-z0-9_-]+|pyannote_[A-Za-z0-9_-]+)\.onnx(?:\.sha256)?$/u,
    'speech-enhancement': /^gtcrn_[A-Za-z0-9_-]+\.onnx(?:\.sha256)?$/u,
    tts: /^(?:manifest\.json|2052\.INI|MSTTSLoc(?:EnUS\.dat|ZhCN\.(?:dat|ini))|Tokens\.xml|ZhCN\.(?:address|message|mixlingual|name)\.dat|am_v5_(?:decoder|encoder)\.bin|device_vocoder_v6_streaming\.bin|phones\.txt|punc\.txt)$/u,
    llm: /^manifest\.json$/u
});
const GROUPS = Object.freeze(Object.keys(RULES));
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 ** 3;
const MAX_TOTAL_BYTES = 10 * 1024 ** 3;
const TTS_FILE_NAMES = require('../../src/apps/server/modules/model-distribution/offline-model-catalog.json')
    .models.find(model => model.modelId === 'tts').files.map(file => file.name);

function allowedPath(value) {
    if (typeof value !== 'string') return false;
    const parts = value.split('/');
    if (parts.length === 3 && parts[0] === 'llm') {
        return /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(parts[1])
            && /^(?:config(?:uration)?\.json|llm_config\.json|llm\.mnn(?:\.weight|\.json)?|tokenizer\.txt|visual\.mnn(?:\.weight)?)$/u.test(parts[2]);
    }
    return parts.length === 2 && Object.hasOwn(RULES, parts[0])
        && (['README.md', 'LICENSE'].includes(parts[1]) || RULES[parts[0]].test(parts[1]));
}

function validateManifest(value) {
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.files)
        || !value.files.length || value.files.length > 1000) throw new Error('模型清单结构或数量无效');
    const seen = new Set();
    let total = 0;
    for (const file of value.files) {
        if (!file || !allowedPath(file.path) || seen.has(file.path)) throw new Error('模型清单包含非法或重复路径');
        if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES
            || !/^[a-f0-9]{64}$/u.test(file.sha256)) throw new Error(`模型清单大小或哈希无效：${file.path}`);
        total += file.size;
        seen.add(file.path);
    }
    if (total > MAX_TOTAL_BYTES || total !== value.totalBytes) throw new Error('模型清单总大小无效');
    return { schemaVersion: 1, files: value.files.map(({ path: name, size, sha256 }) => ({ path: name, size, sha256 }))
        .sort((a, b) => a.path.localeCompare(b.path, 'en')), totalBytes: total };
}

function manifestBytes(manifest) {
    return Buffer.from(JSON.stringify(validateManifest(manifest), null, 2) + '\n');
}

// 逐层检查根目录、分类和目标文件并拒绝符号链接；allowManifest只给镜像入口开放已校验根清单，不放宽模型项白名单。
async function safeFile(root, relativePath, options = {}) {
    const isRootManifest = options.allowManifest === true && relativePath === 'manifest.json';
    if (!isRootManifest && !allowedPath(relativePath)) throw new Error('模型路径不在允许范围');
    const absoluteRoot = path.resolve(root);
    const target = path.join(absoluteRoot, ...relativePath.split('/'));
    const parsed = path.parse(absoluteRoot);
    let current = parsed.root;
    const parts = path.relative(parsed.root, target).split(path.sep);
    for (const part of parts) {
        current = path.join(current, part);
        try {
            const info = await fs.promises.lstat(current);
            if (info.isSymbolicLink()) throw new Error(`模型路径不允许符号链接：${current}`);
            if (current !== target && !info.isDirectory()) throw new Error('模型父路径不是目录');
            if (current === target && !info.isFile()) throw new Error('模型目标不是普通文件');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return target;
}

async function hashFile(file) {
    const hash = crypto.createHash('sha256');
    let size = 0;
    for await (const bytes of fs.createReadStream(file)) { hash.update(bytes); size += bytes.length; }
    return { size, sha256: hash.digest('hex') };
}

async function matchesFile(root, item) {
    const file = await safeFile(root, item.path);
    try {
        const info = await fs.promises.stat(file);
        if (info.size !== item.size) return false;
        return (await hashFile(file)).sha256 === item.sha256;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return false;
    }
}

async function collectModels(root = MODEL_ROOT) {
    const files = [];
    for (const group of GROUPS) {
        await safeFile(root, `${group}/README.md`);
        let entries;
        try { entries = await fs.promises.readdir(path.join(root, group), { withFileTypes: true }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
        // 声明驱动的分类在下方统一校验，不能把不完整目录当作零散文件发布。
        if (group === 'tts' || group === 'llm') continue;
        for (const entry of entries) {
            const name = `${group}/${entry.name}`;
            if (!allowedPath(name)) continue;
            const source = await safeFile(root, name);
            const before = await fs.promises.stat(source);
            const result = await hashFile(source);
            const after = await fs.promises.stat(source);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || result.size !== after.size) {
                throw new Error(`扫描期间模型发生变化：${name}`);
            }
            files.push({ path: name, ...result });
        }
    }
    await collectDeclaredModels(root, files);
    return validateManifest({ schemaVersion: 1, files, totalBytes: files.reduce((sum, item) => sum + item.size, 0) });
}

async function collectDeclaredModels(root, files) {
    const add = async (relativePath, declaration) => {
        const source = await safeFile(root, relativePath);
        const actual = await hashFile(source);
        if (declaration && (actual.sha256 !== declaration.sha256
            || (declaration.size !== undefined && actual.size !== declaration.size))) {
            throw new Error(`声明模型文件不完整或校验失败：${relativePath}`);
        }
        files.push({ path: relativePath, ...actual });
    };
    for (const group of ['tts', 'llm']) {
        const manifestPath = `${group}/manifest.json`;
        const manifestFile = await safeFile(root, manifestPath);
        let definition;
        try { definition = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (group === 'tts') {
            if (!Array.isArray(definition) || definition.length !== TTS_FILE_NAMES.length
                || new Set(definition.map(file => file.name)).size !== TTS_FILE_NAMES.length
                || definition.some(file => !TTS_FILE_NAMES.includes(file.name))) throw new Error('TTS 模型声明不完整或重复');
            for (const file of definition) await add(`tts/${file.name}`, file);
        } else {
            if (!Array.isArray(definition.models)) throw new Error('LLM 模型声明无效');
            const ids = new Set();
            for (const model of definition.models) {
                if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(model.modelId)
                    || ids.has(model.modelId) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(model.directory)) {
                    throw new Error('LLM 模型 ID 或目录无效');
                }
                ids.add(model.modelId);
                const directory = path.join(root, 'llm', model.directory);
                const stat = await fs.promises.lstat(directory).catch(error => {
                    if (error.code === 'ENOENT') return null;
                    throw error;
                });
                if (!stat) continue;
                if (!stat.isDirectory() || stat.isSymbolicLink() || !model.files?.length) {
                    throw new Error('LLM 模型目录或声明无效');
                }
                for (const file of model.files) await add(`llm/${model.directory}/${file.name}`, file);
            }
        }
        await add(manifestPath);
    }
}

function normalizeSource(value = SOURCE_URL) {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('模型源必须是无凭证、无查询参数的HTTP(S)目录');
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
}

async function readManifest(source, fetchImpl = fetch) {
    const response = await fetchImpl(new URL('manifest.json', normalizeSource(source)), {
        redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' }
    });
    if (!response.ok || !response.body) throw new Error(`模型清单HTTP ${response.status}`);
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
        length += chunk.length;
        if (length > MAX_MANIFEST_BYTES) { await response.body.cancel().catch(() => {}); throw new Error('模型清单过大'); }
        chunks.push(Buffer.from(chunk));
    }
    return validateManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

// 下载和纯校验共用流式完整性检查；写入回调只在下载临时文件时提供。
async function streamRemote(source, item, write, fetchImpl = fetch) {
    const response = await fetchImpl(new URL(item.path, normalizeSource(source)), {
        redirect: 'error', signal: AbortSignal.timeout(15 * 60 * 1000), headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' }
    });
    if (!response.ok || !response.body) throw new Error(`模型HTTP ${response.status}：${item.path}`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > item.size) throw new Error(`模型长度超过清单：${item.path}`);
        hash.update(chunk);
        if (write) await write(chunk);
    }
    if (size !== item.size || hash.digest('hex') !== item.sha256) throw new Error(`模型大小/SHA-256校验失败：${item.path}`);
}

function parseArgs(argv, allowed) {
    const options = {};
    for (let index = 0; index < argv.length; index++) {
        const key = argv[index].replace(/^--/u, '');
        if (argv[index] === '--help') { options.help = true; continue; }
        if (!argv[index].startsWith('--') || !allowed.includes(key) || !argv[index + 1]
            || argv[index + 1].startsWith('--') || Object.hasOwn(options, key)) throw new Error(`参数无效：${argv[index]}`);
        options[key] = argv[++index];
    }
    return options;
}

async function saveReport(file, report) {
    if (!file) return;
    await fs.promises.mkdir(path.dirname(path.resolve(file)), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(report, null, 2) + '\n');
}

module.exports = { MODEL_ROOT, SOURCE_URL, RULES, GROUPS, allowedPath, validateManifest, manifestBytes,
    safeFile, hashFile, matchesFile, collectModels, normalizeSource, readManifest, streamRemote, parseArgs, saveReport };
