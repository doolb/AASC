'use strict';

const MAX_ORDERED_TASK_CONCURRENCY = 2;

function normalizeConcurrency(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 1) return 1;
    return Math.min(MAX_ORDERED_TASK_CONCURRENCY, Math.floor(numericValue));
}

/**
 * 创建有序并发任务调度器。
 *
 * 任务本身可以并发执行，但返回给调用方的 Promise 会按照入队顺序完成。
 * TTS 使用它只并行 WAV 生成，音频发送仍由前序句子依次触发，从而避免
 * 后生成的句子先抵达显示端而打乱播放顺序。
 */
function createOrderedTaskScheduler({ concurrency = 1 } = {}) {
    const maxConcurrency = normalizeConcurrency(concurrency);
    const pendingTasks = [];
    const completedTasks = new Map();
    const idleWaiters = [];
    let activeCount = 0;
    let nextTaskIndex = 0;
    let nextReleaseIndex = 0;

    const isIdle = () => pendingTasks.length === 0 &&
        activeCount === 0 &&
        completedTasks.size === 0;

    const resolveIdleWaiters = () => {
        if (!isIdle()) return;
        while (idleWaiters.length > 0) {
            idleWaiters.shift()();
        }
    };

    const releaseCompletedTasks = () => {
        while (completedTasks.has(nextReleaseIndex)) {
            const outcome = completedTasks.get(nextReleaseIndex);
            completedTasks.delete(nextReleaseIndex);
            nextReleaseIndex += 1;
            if (!outcome.succeeded) outcome.reject(outcome.error);
            else outcome.resolve(outcome.value);
        }
    };

    const finishTask = (record, succeeded, value) => {
        activeCount -= 1;
        // Promise 的 resolve/reject 引用随任务保存，避免任务完成顺序与句子顺序
        // 不同时丢失调用方的等待结果。
        completedTasks.set(record.index, {
            succeeded,
            value: succeeded ? value : undefined,
            error: succeeded ? undefined : value,
            resolve: record.resolve,
            reject: record.reject
        });

        releaseCompletedTasks();
        drainTasks();
        resolveIdleWaiters();
    };

    const startTask = (record) => {
        activeCount += 1;
        Promise.resolve()
            .then(() => record.task())
            .then(
                (value) => finishTask(record, true, value),
                (error) => finishTask(record, false, error)
            );
    };

    function drainTasks() {
        while (activeCount < maxConcurrency && pendingTasks.length > 0) {
            startTask(pendingTasks.shift());
        }
    }

    const enqueue = (task) => {
        if (typeof task !== 'function') {
            return Promise.reject(new TypeError('有序任务必须是函数'));
        }

        const index = nextTaskIndex++;
        const promise = new Promise((resolve, reject) => {
            pendingTasks.push({ index, task, resolve, reject });
        });
        drainTasks();
        return promise;
    };

    const waitForIdle = () => {
        if (isIdle()) return Promise.resolve();
        return new Promise((resolve) => idleWaiters.push(resolve));
    };

    return {
        concurrency: maxConcurrency,
        enqueue,
        waitForIdle
    };
}

module.exports = {
    MAX_ORDERED_TASK_CONCURRENCY,
    createOrderedTaskScheduler
};
