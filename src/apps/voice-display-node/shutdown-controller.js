'use strict';

/** 按键与操作系统信号共享同一清理Promise，避免重入或抢先退出。 */
function createShutdownController({ stopMonitor, stopDisplay, destroyTui, exit, onError = () => {} }) {
    let shutdownPromise = null;
    return exitCode => {
        if (shutdownPromise) return shutdownPromise;
        let finalCode = Number.isInteger(exitCode) ? exitCode : 0;
        const operations = [
            ['系统监控', stopMonitor],
            ['语音显示端', stopDisplay],
            ['终端界面', destroyTui]
        ];
        shutdownPromise = Promise.resolve().then(async () => {
            for (const [name, operation] of operations) {
                if (typeof operation !== 'function') continue;
                try { await operation(); }
                catch (error) {
                    if (finalCode === 0) finalCode = 1;
                    try { onError(error, name); } catch { /* 错误记录不能中断后续资源清理。 */ }
                }
            }
            exit(finalCode);
            return finalCode;
        });
        return shutdownPromise;
    };
}

module.exports = { createShutdownController };
