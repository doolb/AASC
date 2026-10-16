'use strict';

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { cursorTo, clearLine } = require('node:readline');
const { verifySignedManifest } = require('./offline-update-package');
const { dependencyArtifacts } = require('../../src/apps/server/modules/aasc/shared-update-manifest');

/** 将清单中的普通组件、平台依赖和任务依赖统一展开，保留签名清单里的权威描述。 */
function manifestArtifacts(manifest) {
    return Object.entries(manifest.payload.components).flatMap(([name, component]) => {
        if (!component) return [];
        if (name === 'taskDependencies') return Object.values(component);
        if (component.groups) return dependencyArtifacts(component);
        return component.relativeUrl ? [component] : [];
    });
}

/** 显式范围仅用于选路径，大小和摘要始终取签名清单；旧调用未传范围时继续完整校验。 */
function verificationArtifacts(manifest, selected) {
    const known = new Map(manifestArtifacts(manifest).map(artifact => [artifact.relativeUrl, artifact]));
    if (selected === undefined) return [...known.values()];
    if (!Array.isArray(selected)) throw new Error('HTTP 校验范围必须是本次发布资源列表');
    return [...new Set(selected.map(artifact => artifact?.relativeUrl))].map(relative => {
        if (!known.has(relative)) throw new Error(`HTTP 校验资源不在签名清单内: ${relative}`);
        return known.get(relative);
    });
}

/** 计时器覆盖等待响应和流暂停，每秒报告一次；结束时必须清理，不能阻止进程退出。 */
function createProgress(baseUrl, artifacts, options) {
    const started = performance.now();
    const state = { target: options.target || baseUrl, baseUrl, stage: 'manifest', relativePath: 'manifest.json',
        fileIndex: 0, fileCount: artifacts.length, received: 0, expectedSize: 0, completedBytes: 0,
        totalBytes: artifacts.reduce((total, artifact) => total + artifact.size, 0) };
    let onProgress = options.onProgress;
    let lastDataAt = started;
    const emit = (event, updates = {}) => {
        Object.assign(state, updates);
        if (typeof onProgress !== 'function') return;
        const now = performance.now();
        const elapsedMs = now - started;
        try {
            onProgress({ ...state, event, elapsedMs, idleMs: now - lastDataAt,
                bytesPerSecond: (state.completedBytes + state.received) * 1000 / Math.max(1, elapsedMs) });
        } catch {
            // 日志观察者异常不改变大小/SHA-256的校验结论，停用观察者以免定时器抛出未捕获异常。
            onProgress = undefined;
        }
    };
    const timer = typeof onProgress === 'function' ? setInterval(() => emit('progress'), 1000) : null;
    timer?.unref();
    return { emit, state, stop: () => clearInterval(timer), received: size => {
        state.received = size;
        lastDataAt = performance.now();
    } };
}

async function streamHash(response, progress) {
    if (!response.ok || !response.body) throw new Error(`HTTP 下载校验失败: ${response.status}`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        hash.update(buffer);
        progress.received(size);
    }
    return { size, sha256: hash.digest('hex') };
}

/** 先验证公开清单，再只回读本次选择归档；全程保持流式SHA-256，不缓存整个大包。 */
async function verifyHttpTarget(baseUrl, manifest, publicKeyPem, fetchImpl = globalThis.fetch, options = {}) {
    verifySignedManifest(manifest, publicKeyPem);
    const artifacts = verificationArtifacts(manifest, options.artifacts);
    const progress = createProgress(baseUrl, artifacts, options);
    try {
        progress.emit('start');
        const response = await fetchImpl(new URL('manifest.json', baseUrl));
        if (!response.ok) throw new Error(`HTTP 无法读取已发布清单: ${response.status} ${baseUrl}`);
        const publishedManifest = await response.json();
        verifySignedManifest(publishedManifest, publicKeyPem);
        if (JSON.stringify(publishedManifest) !== JSON.stringify(manifest)) {
            throw new Error(`HTTP 返回的已发布清单与本次清单不一致: ${baseUrl}`);
        }
        progress.emit('manifest-verified', { stage: 'manifest-verified' });
        for (const [index, artifact] of artifacts.entries()) {
            progress.emit('file-start', { stage: 'downloading', relativePath: artifact.relativeUrl,
                fileIndex: index + 1, received: 0, expectedSize: artifact.size });
            const artifactResponse = await fetchImpl(new URL(artifact.relativeUrl, baseUrl));
            const actual = await streamHash(artifactResponse, progress);
            if (actual.size !== artifact.size || actual.sha256 !== artifact.sha256) {
                throw new Error(`HTTP 已发布 ${artifact.relativeUrl} 包大小或 SHA-256 不匹配: ${baseUrl}`);
            }
            progress.emit('file-verified', { stage: 'file-verified', received: 0,
                completedBytes: progress.state.completedBytes + actual.size });
        }
        progress.emit('complete', { stage: 'complete' });
    } catch (error) {
        progress.emit('error', { stage: 'error', message: error.message });
        throw error;
    } finally {
        progress.stop();
    }
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** 阶段结果始终完整保留，周期进度交给打印器按输出环境刷新或节流。 */
function formatVerificationProgress(progress) {
    const prefix = `[发布校验 ${progress.target}]`;
    const total = formatBytes(progress.totalBytes);
    const events = {
        start: () => `${prefix} 核对签名清单 ${progress.baseUrl}；本次 ${progress.fileCount} 个包，共 ${total}`,
        'manifest-verified': () => `${prefix} 签名清单通过`,
        'file-start': () => `${prefix} ${progress.fileIndex}/${progress.fileCount} 开始 ${progress.relativePath}（${formatBytes(progress.expectedSize)}）`,
        'file-verified': () => `${prefix} ${progress.fileIndex}/${progress.fileCount} 大小/SHA-256通过 ${progress.relativePath}`,
        complete: () => `${prefix} 本次包校验完成：${total}，耗时 ${(progress.elapsedMs / 1000).toFixed(1)} 秒`,
        error: () => `${prefix} 失败 ${progress.relativePath}：${progress.message}`
    };
    if (events[progress.event]) return { boundary: true, text: events[progress.event]() };
    const received = progress.completedBytes + progress.received;
    const percent = progress.totalBytes ? Math.min(100, received * 100 / progress.totalBytes).toFixed(1) : '0.0';
    const filePercent = progress.expectedSize ? Math.min(100, progress.received * 100 / progress.expectedSize).toFixed(1) : '0.0';
    const wait = progress.idleMs >= 2000 ? `，等待数据 ${(progress.idleMs / 1000).toFixed(0)} 秒` : '';
    return { boundary: false, prefix, percent, filePercent, received, total, wait,
        text: `${prefix} ${progress.fileIndex}/${progress.fileCount} ${progress.relativePath} ` +
        `${filePercent}% ${formatBytes(progress.received)}/${formatBytes(progress.expectedSize)}；总计 ${percent}% ` +
        `${formatBytes(received)}/${total}，平均 ${formatBytes(progress.bytesPerSecond)}/s${wait}` };
}

/** 中文及其他非ASCII字符保守按双列计算，宁可少放内容，也不触发终端自动折行。 */
function terminalWidth(text) {
    return Array.from(text).reduce((width, character) => width + (character.codePointAt(0) > 0x7f ? 2 : 1), 0);
}

function fitTerminalLine(text, columns) {
    const clean = text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
    if (terminalWidth(clean) <= columns) return clean;
    let result = '';
    let width = 0;
    for (const character of clean) {
        const size = character.codePointAt(0) > 0x7f ? 2 : 1;
        if (width + size > Math.max(0, columns - 3)) break;
        result += character;
        width += size;
    }
    return result + '.'.repeat(Math.min(3, columns));
}

/** 按窗口宽度逐级减少大小和文件名字段，优先保留文件/总体百分比和下载速度。 */
function formatTerminalProgress(progress, formatted, columns) {
    const fileName = progress.relativePath.split('/').pop()
        .replace(/^aasc-display-offline-min-/, 'min-')
        .replace(/^aasc-display-offline-/, 'full-');
    const count = `${progress.fileIndex}/${progress.fileCount}`;
    const speed = `${formatBytes(progress.bytesPerSecond)}/s`;
    const summary = `${count} 文件${formatted.filePercent}% 总计${formatted.percent}% ${speed}`;
    const candidates = [
        `${formatted.prefix} ${count} ${fileName} ${formatted.filePercent}% ` +
            `${formatBytes(progress.received)}/${formatBytes(progress.expectedSize)}；总计 ${formatted.percent}% ` +
            `${formatBytes(formatted.received)}/${formatted.total} ${speed}${formatted.wait}`,
        `${formatted.prefix} ${fileName} ${summary}${formatted.wait}`,
        `${formatted.prefix} ${summary}${formatted.wait}`,
        `${progress.target} ${summary}`,
        `${count} ${formatted.filePercent}%/${formatted.percent}% ${speed}`
    ];
    return fitTerminalLine(candidates.find(line => terminalWidth(line) <= columns) || candidates.at(-1), columns);
}

/** 每个打印器独立保存行与时间状态，不改变校验回调频率，也不注册进程级信号处理器。 */
function createVerificationProgressPrinter({ stream = process.stdout } = {}) {
    let lineVisible = false;
    let lastPlainAt = null;
    return progress => {
        const formatted = formatVerificationProgress(progress);
        const now = performance.now();
        if (formatted.boundary) {
            if (lineVisible) stream.write('\n');
            lineVisible = false;
            stream.write(`${formatted.text}\n`);
            lastPlainAt = now;
            return;
        }
        if (stream.isTTY) {
            const columns = Number.isInteger(stream.columns) && stream.columns > 0 ? stream.columns : 80;
            cursorTo(stream, 0);
            clearLine(stream, 0);
            stream.write(formatTerminalProgress(progress, formatted, columns - 1));
            lineVisible = true;
            return;
        }
        if (lastPlainAt !== null && now - lastPlainAt < 10000) return;
        stream.write(`${formatted.text}\n`);
        lastPlainAt = now;
    };
}

const printVerificationProgress = createVerificationProgressPrinter();

module.exports = { verifyHttpTarget, printVerificationProgress, createVerificationProgressPrinter };
