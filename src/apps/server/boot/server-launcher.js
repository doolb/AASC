'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');

const DEFAULT_RESTART_DELAY_MS = 1000;
const MAX_CRASH_RESTARTS = 5;

function createServerLauncher(options = {}) {
    const serverPath = options.serverPath || path.join(__dirname, 'server-app.js');
    const processArguments = Array.isArray(options.processArguments)
        ? options.processArguments.slice()
        : process.argv.slice(2);
    const environment = options.environment || process.env;
    const spawnChild = options.spawnChild || ((file, args, spawnOptions) => fork(file, args, spawnOptions));
    const schedule = options.schedule || ((callback, delayMs) => setTimeout(callback, delayMs));
    const cancelSchedule = options.cancelSchedule || ((timer) => clearTimeout(timer));
    const exit = options.exit || ((code) => process.exit(code));

    let child = null;
    let stopping = false;
    let restartRequested = false;
    let restartTimer = null;
    let crashCount = 0;

    function clearRestartTimer() {
        if (restartTimer === null) return;
        cancelSchedule(restartTimer);
        restartTimer = null;
    }

    function handleChildMessage(message) {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'restartRequested') {
            restartRequested = true;
            return;
        }
        if (message.type === 'serverReady') {
            crashCount = 0;
        }
    }

    function handleChildExit(code, signal) {
        child = null;

        if (stopping) {
            clearRestartTimer();
            exit(typeof code === 'number' ? code : 0);
            return;
        }

        if (restartRequested) {
            restartRequested = false;
            crashCount = 0;
            clearRestartTimer();
            spawnServerChild();
            return;
        }

        // TUI 按 q 退出时返回 0，按正常结束处理，不把用户主动退出误判为崩溃。
        if (code === 0) {
            exit(0);
            return;
        }

        crashCount += 1;
        if (crashCount >= MAX_CRASH_RESTARTS) {
            exit(typeof code === 'number' && code !== 0 ? code : 1);
            return;
        }

        clearRestartTimer();
        restartTimer = schedule(() => {
            restartTimer = null;
            spawnServerChild();
        }, DEFAULT_RESTART_DELAY_MS);
    }

    function spawnServerChild() {
        if (stopping || child) return child;

        try {
            child = spawnChild(serverPath, processArguments, {
                stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
                env: { ...environment, AASC_SERVER_CHILD: '1' }
            });
            // 服务器启动成功和主动重启是两个独立消息，必须持续监听整个子进程生命周期。
            child.on('message', handleChildMessage);
            child.once('exit', handleChildExit);
            child.once('error', (error) => {
                console.error(`[启动器] 服务器子进程错误: ${error.message}`);
            });
            return child;
        } catch (error) {
            child = null;
            console.error(`[启动器] 启动服务器子进程失败: ${error.message}`);
            handleChildExit(1, null);
            return null;
        }
    }

    function requestStop(signal = 'SIGTERM') {
        stopping = true;
        restartRequested = false;
        clearRestartTimer();

        if (child && typeof child.kill === 'function') {
            child.kill(signal);
            return;
        }
        exit(signal === 'SIGINT' ? 130 : 143);
    }

    function start() {
        if (stopping || child) return child;
        return spawnServerChild();
    }

    return {
        start,
        requestStop,
        handleChildMessage,
        handleChildExit,
        constants: {
            DEFAULT_RESTART_DELAY_MS,
            MAX_CRASH_RESTARTS
        }
    };
}

function main() {
    const launcher = createServerLauncher();
    process.once('SIGINT', () => launcher.requestStop('SIGINT'));
    process.once('SIGTERM', () => launcher.requestStop('SIGTERM'));
    launcher.start();
    return launcher;
}

if (require.main === module) {
    main();
}

module.exports = {
    DEFAULT_RESTART_DELAY_MS,
    MAX_CRASH_RESTARTS,
    createServerLauncher,
    main
};
