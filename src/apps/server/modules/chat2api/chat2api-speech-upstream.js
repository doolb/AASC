'use strict';

const path = require('node:path');
const { DEFAULT_ROOT_DIR } = require('./chat2api-data-store');
const { createDoubaoSpeechQueue } = require('./chat2api-doubao-speech-queue');

// 千问 API 按账号控制请求启动频率。等待项不设数量上限，避免聊天分句因本地队列满而丢失。
function createQwenApiRateGate({ intervalMs = 500 } = {}) {
    if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new Error('千问请求间隔必须为正整数');
    const lanes = new Map();
    const abortError = () => Object.assign(new Error('TTS 上游请求已取消'), { name: 'AbortError', code: 'ABORT_ERR' });
    const timeoutError = () => Object.assign(new Error('TTS 上游请求超时'), { code: 'TTS_PROVIDER_TIMEOUT' });

    const arm = (key, lane) => {
        clearTimeout(lane.timer);
        if (lane.waiting.length) {
            lane.timer = setTimeout(() => drain(key, lane), Math.max(1, lane.nextAt - Date.now()));
            return;
        }
        // 最后一次启动的间隔结束后释放账号状态；新请求在此之前仍须遵守间隔。
        lane.timer = setTimeout(() => {
            if (lanes.get(key) === lane && !lane.waiting.length) lanes.delete(key);
        }, Math.max(1, lane.nextAt - Date.now()));
        lane.timer.unref();
    };
    const drain = (key, lane) => {
        clearTimeout(lane.timer);
        while (lane.waiting.length) {
            const now = Date.now();
            if (now < lane.nextAt) break;
            const item = lane.waiting[0];
            if (item.signal?.aborted) { item.finish(abortError()); continue; }
            if (item.deadline !== undefined && now >= item.deadline) { item.finish(timeoutError()); continue; }
            lane.nextAt = now + intervalMs;
            item.finish();
            break;
        }
        arm(key, lane);
    };
    return {
        waitForStart(key, { signal, deadline } = {}) {
            if (signal?.aborted) return Promise.reject(abortError());
            if (deadline !== undefined && (!Number.isFinite(deadline) || Date.now() >= deadline)) {
                return Promise.reject(timeoutError());
            }
            let lane = lanes.get(key);
            if (!lane) {
                lane = { nextAt: 0, waiting: [], timer: null };
                lanes.set(key, lane);
            }
            return new Promise((resolve, reject) => {
                let settled = false;
                let deadlineTimer;
                const onAbort = () => { item.finish(abortError()); drain(key, lane); };
                const item = { signal, deadline, finish(error) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(deadlineTimer);
                    signal?.removeEventListener('abort', onAbort);
                    const index = lane.waiting.indexOf(item);
                    if (index >= 0) lane.waiting.splice(index, 1);
                    if (error) reject(error);
                    else resolve();
                } };
                lane.waiting.push(item);
                signal?.addEventListener('abort', onAbort, { once: true });
                if (deadline !== undefined) deadlineTimer = setTimeout(() => {
                    item.finish(timeoutError()); drain(key, lane);
                }, Math.max(1, deadline - Date.now()));
                if (signal?.aborted) onAbort();
                else drain(key, lane);
            });
        }
    };
}

// 对应.src/framework/tts-provider-configuration.md：由应用持有，聊天与代理注入共享准入队列，不使用进程全局单例。
function createSpeechUpstreamController({ getDoubaoConcurrency } = {}) {
    const queue = createDoubaoSpeechQueue({ getConcurrency: getDoubaoConcurrency });
    const qwenGate = createQwenApiRateGate();
    return {
        forRoot(rootDir) {
            const root = path.resolve(rootDir || DEFAULT_ROOT_DIR);
            return {
                acquire: (accountId, context) => queue.acquire(JSON.stringify([root, accountId]), context),
                qwenApiRateGate: { waitForStart: (accountId, model, context) => qwenGate.waitForStart(
                    JSON.stringify([root, 'qwen-api', accountId, model]), context) },
                qwenChatRateGate: { waitForStart: (accountId, model, context) => qwenGate.waitForStart(
                    JSON.stringify([root, 'qwen-chat', accountId, model]), context) }
            };
        },
        refresh: () => queue.refresh()
    };
}

module.exports = { createSpeechUpstreamController, createQwenApiRateGate };
