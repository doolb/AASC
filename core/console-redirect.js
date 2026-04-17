const util = require('util');

// 说明：在 blessed TUI 模式下，任何直接写 stdout/stderr 的输出都会破坏屏幕渲染。
// 这里将 console.* 重定向到调用方提供的 writeLog(level, message)。

function _formatConsoleArgs(args) {
    // 与 Node.js console 行为接近：支持 %s/%d/%j 等格式化。
    // 若只传一个参数且为 Error，优先输出 stack。
    if (!args || args.length === 0) return '';
    if (args.length === 1 && args[0] instanceof Error) {
        return args[0].stack || args[0].message || String(args[0]);
    }
    return util.format(...args);
}

function installConsoleRedirect(options = {}) {
    const enabled = options.enabled === true;
    const writeLog = typeof options.writeLog === 'function' ? options.writeLog : null;

    if (!enabled || !writeLog) {
        return { restore: () => {} };
    }

    // 避免重复安装造成多次包装。
    if (console.__tuiRedirectInstalled) {
        return { restore: console.__tuiRedirectRestore || (() => {}) };
    }

    const original = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug
    };

    const safeWrite = (level, args) => {
        try {
            writeLog(level, _formatConsoleArgs(args));
        } catch (e) {
            // 兜底：写入失败时回退到原始 console.error，避免完全吞错。
            try {
                original.error('[TUI] console redirect failed:', e && e.message ? e.message : e);
            } catch (_) {
                // ignore
            }
        }
    };

    console.log = (...args) => safeWrite('log', args);
    console.info = (...args) => safeWrite('info', args);
    console.warn = (...args) => safeWrite('warn', args);
    console.error = (...args) => safeWrite('error', args);
    console.debug = (...args) => safeWrite('debug', args);

    console.__tuiRedirectInstalled = true;
    console.__tuiRedirectRestore = () => {
        console.log = original.log;
        console.info = original.info;
        console.warn = original.warn;
        console.error = original.error;
        console.debug = original.debug;
        delete console.__tuiRedirectInstalled;
        delete console.__tuiRedirectRestore;
    };

    return { restore: console.__tuiRedirectRestore };
}

module.exports = {
    installConsoleRedirect
};
