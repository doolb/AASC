'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { normalizeOutputVideos } = require('../../../../core/utils/chat-output-videos');
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const error = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

/** 任务持久化仅保存上游定位字段；提交中断而无定位字段时绝不重新提交。 */
function createVideoJobs({ rootDir, start, poll, intervalMs = 3000, timeoutMs = 20 * 60 * 1000 }) {
    const jobs = new Map(); const running = new Map(); let writes = Promise.resolve(); let stopped = false;
    const file = rootDir && path.join(rootDir, 'video-jobs.json');
    const ready = (async () => {
        if (!file) return;
        try {
            const stat = await fs.lstat(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw error('video_store_invalid', '视频任务文件无效');
            const stored = JSON.parse(await fs.readFile(file, 'utf8'));
            for (const job of Array.isArray(stored) ? stored.slice(-128) : []) {
                if (!/^video_[a-f0-9-]{36}$/.test(job.id || '') || !['doubaochat','qwen','glm'].includes(job.providerId)) continue;
                if (!TERMINAL.has(job.status) && !job.upstream) { job.status = 'interrupted'; job.error = '提交时中断，未重复创建视频'; }
                jobs.set(job.id, job);
            }
        } catch (cause) { if (cause.code !== 'ENOENT') throw error('video_store_invalid', '读取视频任务状态失败'); }
    })();
    // 构造阶段只加载；实际调用方通过create/get/resume接收错误，避免未启动任务时产生未处理拒绝。
    void ready.catch(()=>{});
    const persist = () => {
        if (!file) return Promise.resolve();
        const snapshot = JSON.stringify([...jobs.values()].slice(-128));
        const task = writes.catch(() => {}).then(async () => {
            await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
            const temporary = `${file}.${randomUUID()}.tmp`;
            try { await fs.writeFile(temporary, snapshot, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, file); }
            finally { await fs.unlink(temporary).catch(() => {}); }
        });
        writes = task; return task;
    };
    const snapshot = job => ({ id: job.id, object: 'video.generation', provider: job.providerId, model: job.model,
        status: job.status, created: job.created, data: [...(job.videos || [])], ...(job.error ? { error: job.error } : {}) });
    const launch = (job, input) => {
        if (running.has(job.id) || TERMINAL.has(job.status) || stopped) return;
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
        const task = (async () => {
            try {
                if (input) {
                    job.status = 'submitted'; await persist();
                    const initial = await start(job, input, signal);
                    // 创建接口只调用一次，拿到上游标识立即落盘；状态未知不自动重试。
                    job.upstream = initial.upstream;
                    job.videos = normalizeOutputVideos(initial.videos);
                    job.done = initial.done ?? Boolean(job.videos.length);
                    await persist();
                }
                if (!job.done && !job.upstream) throw error('video_task_missing', '上游未返回可查询的视频任务');
                while (!job.done) {
                    if (Date.now() - job.created * 1000 > timeoutMs) throw error('video_timeout', '视频生成等待超时', 504);
                    signal.throwIfAborted(); job.status = 'running';
                    const result = await poll(job, signal);
                    if (result.error) throw error('video_generation_failed', result.error, 502);
                    job.videos = normalizeOutputVideos([...(job.videos||[]),...(result.videos||[])]);
                    job.done = result.done ?? Boolean(result.videos?.length);
                    if(result.pending===true)job.done=false;
                    await persist();
                    if (!job.done) await delay(intervalMs, undefined, { signal });
                }
                job.status = 'completed';
            } catch (cause) {
                const uncertain=!job.upstream&&input&&(/^(ECONNRESET|ECONNABORTED|ETIMEDOUT|ERR_CANCELED|doubao_browser_timeout|doubao_browser_upstream)$/.test(cause.code||'')||signal.aborted);
                job.status = stopped ? job.upstream ? 'running' : 'interrupted' : controller.signal.aborted ? 'cancelled' : uncertain ? 'interrupted' : 'failed';
                job.error = stopped ? undefined : signal.aborted ? '视频任务等待已停止或超时' : String(cause.message || '视频生成失败').slice(0, 256);
            }
            await persist();
        })().finally(() => running.delete(job.id));
        running.set(job.id, { task, controller });
        task.catch(() => {});
    };
    async function create({ providerId, accountId, model, upstream, input }) {
        await ready;
        if (stopped) throw error('video_unavailable', '视频服务已停止', 503);
        if (upstream) {
            const existing = [...jobs.values()].find(job => job.providerId === providerId && job.accountId === accountId
                && JSON.stringify(job.upstream) === JSON.stringify(upstream));
            if (existing) { launch(existing); return snapshot(existing); }
        }
        if ([...jobs.values()].filter(job => !TERMINAL.has(job.status)).length >= 16) throw error('video_capacity', '视频任务队列已满', 503);
        const job = { id: `video_${randomUUID()}`, providerId, accountId, model, status: 'queued', created: Math.floor(Date.now() / 1000), videos: [], ...(upstream ? { upstream } : {}) };
        jobs.set(job.id, job);
        for (const [id, old] of jobs) if (jobs.size > 128 && TERMINAL.has(old.status)) jobs.delete(id);
        await persist(); launch(job, input); return snapshot(job);
    }
    async function get(id) { await ready; const job = jobs.get(id); if (!job) throw error('video_not_found', '视频任务不存在', 404); launch(job); return snapshot(job); }
    async function wait(id, { signal } = {}) {
        if(signal?.aborted){running.get(id)?.controller.abort();signal.throwIfAborted();}
        await get(id);
        const abort = () => { const job = jobs.get(id); running.get(id)?.controller.abort(); if (job) { job.status = 'cancelled'; void persist().catch(() => {}); } };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            while (running.has(id)) { signal?.throwIfAborted(); await delay(100, undefined, { signal }); }
            signal?.throwIfAborted(); const job = jobs.get(id);
            if (job.status !== 'completed') throw error('video_generation_failed', job.error || '视频任务未完成', 502);
            return snapshot(job);
        } finally { signal?.removeEventListener('abort', abort); }
    }
    return { create, get, wait,
        async stop() { stopped = true; for (const work of running.values()) work.controller.abort(); await Promise.allSettled([...running.values()].map(work => work.task)); await writes; },
        async resume() { await ready; for (const job of jobs.values()) launch(job); } };
}
module.exports = { createVideoJobs, videoError: error };
