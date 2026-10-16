'use strict';
const { doubaoSpeechError } = require('./chat2api-doubao-speech-protocol');
const { DEFAULT_DOUBAO_CONCURRENCY, MAX_DOUBAO_CONCURRENCY } = require('../tts/tts-upstream-concurrency');

// 对应.src/framework/tts-provider-configuration.md：实例注入共享队列，同账号跨入口/批次共用上游槽位。
function createDoubaoSpeechQueue({ concurrency = DEFAULT_DOUBAO_CONCURRENCY, getConcurrency = () => concurrency,
    maxWaitingPerAccount = 16, maxWaitingTotal = 256 } = {}) {
    const accounts = new Map();
    let waitingTotal = 0;
    const failure = code => Object.assign(doubaoSpeechError(code), { speechQueueFailure: true });
    const limit = () => {
        try {
            const value = getConcurrency();
            return Number.isInteger(value) && value >= 1 && value <= MAX_DOUBAO_CONCURRENCY ? value : DEFAULT_DOUBAO_CONCURRENCY;
        } catch (error) { return DEFAULT_DOUBAO_CONCURRENCY; }
    };
    const invalid = ({ signal, deadline }) => {
        if (signal?.aborted) return failure('doubao_speech_cancelled');
        if (!Number.isFinite(deadline) || Date.now() >= deadline) return failure('doubao_speech_timeout');
        return null;
    };
    const prune = (accountId, slot) => {
        if (!slot.active && !slot.waiting.length) accounts.delete(accountId);
    };
    const drain = (accountId, slot) => {
        const maximum = limit();
        while (slot.waiting.length) {
            const item = slot.waiting[0];
            const error = invalid(item);
            if (error) { item.finish(error); continue; }
            if (slot.active >= maximum) break;
            item.finish(null, lease(accountId, slot));
        }
        prune(accountId, slot);
    };
    const lease = (accountId, slot) => {
        slot.active++;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            slot.active--;
            // 收齐上游音频即释放，不等待本地解码；降低限额不取消其它在途请求。
            drain(accountId, slot);
        };
    };
    return {
        refresh() {
            // 配置升高后立即填补可用槽位，不等新请求或旧请求完成。
            for (const [accountId, slot] of accounts) drain(accountId, slot);
        },
        acquire(accountId, { signal, deadline }) {
            const error = invalid({ signal, deadline });
            if (error) throw error;
            const existing = accounts.get(accountId);
            if (existing) drain(accountId, existing);
            let slot = accounts.get(accountId);
            if (!slot) {
                slot = { active: 0, waiting: [] };
                accounts.set(accountId, slot);
            }
            if (!slot.waiting.length && slot.active < limit()) return lease(accountId, slot);
            if (slot.waiting.length >= maxWaitingPerAccount || waitingTotal >= maxWaitingTotal)
                throw failure('doubao_speech_busy');
            return new Promise((resolve, reject) => {
                let settled = false;
                let timer;
                const abort = () => item.finish(failure('doubao_speech_cancelled'));
                const item = { signal, deadline, finish(error, release) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', abort);
                    slot.waiting.splice(slot.waiting.indexOf(item), 1);
                    waitingTotal--;
                    if (error) reject(error);
                    else resolve(release);
                    prune(accountId, slot);
                } };
                slot.waiting.push(item);
                waitingTotal++;
                signal?.addEventListener('abort', abort, { once: true });
                timer = setTimeout(() => item.finish(failure('doubao_speech_timeout')), deadline - Date.now());
                if (signal?.aborted) abort();
            });
        }
    };
}
module.exports = { createDoubaoSpeechQueue };
