'use strict';
const { doubaoSpeechError } = require('./chat2api-doubao-speech-protocol');

// 队列只属于一个适配器实例；同账号跨批次共享执行权，不引入进程全局状态。
function createDoubaoSpeechQueue({ maxWaitingPerAccount = 16, maxWaitingTotal = 256 } = {}) {
    const accounts = new Map();
    let waitingTotal = 0;
    const failure = code => Object.assign(doubaoSpeechError(code), { speechQueueFailure: true });
    const invalid = ({ signal, deadline }) => {
        if (signal?.aborted) return failure('doubao_speech_cancelled');
        if (!Number.isFinite(deadline) || Date.now() >= deadline) return failure('doubao_speech_timeout');
        return null;
    };
    const lease = (accountId, slot) => {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            // 清除无效等待项后才移交；调用方收齐上游音频便释放，不等待WAV解码。
            while (slot.waiting.length) {
                const item = slot.waiting[0];
                const error = invalid(item);
                item.finish(error, error ? undefined : lease(accountId, slot));
                if (!error) return;
            }
            accounts.delete(accountId);
        };
    };
    return {
        acquire(accountId, { signal, deadline }) {
            const error = invalid({ signal, deadline });
            if (error) throw error;
            let slot = accounts.get(accountId);
            if (!slot) {
                slot = { waiting: [] };
                accounts.set(accountId, slot);
                // 空闲账号同步领取，维持原适配器首项立即创建连接的行为。
                return lease(accountId, slot);
            }
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
                } };
                slot.waiting.push(item);
                waitingTotal++;
                signal?.addEventListener('abort', abort, { once: true });
                timer = setTimeout(() => item.finish(failure('doubao_speech_timeout')), deadline - Date.now());
                // 注册后复查，避免在入队边界遗漏取消。
                if (signal?.aborted) abort();
            });
        }
    };
}
module.exports = { createDoubaoSpeechQueue };
