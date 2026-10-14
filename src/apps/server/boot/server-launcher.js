'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');
const { hasReleaseFlag } = require('../../../core/release-runtime-context');
const { readStartupContext, createMainServerSubserverUpdater } = require('../modules/aasc/subserver-main-update');

const DEFAULT_RESTART_DELAY_MS = 1000;
const MAX_CRASH_RESTARTS = 5;

function createServerLauncher(options = {}) {
    const serverPath = options.serverPath || path.join(__dirname, 'server-app.js');
    const processArguments = Array.isArray(options.processArguments)
        ? options.processArguments.slice()
        : process.argv.slice(2);
    const environment = options.environment || process.env;
    const projectRoot = path.resolve(options.projectRoot || environment.AASC_PROJECT_ROOT || path.resolve(__dirname, '../../../..'));
    // 普通APK和Termux共享主服务器更新指针；Offline APK保留原生管理器指针。
    let activeContext = environment.AASC_OFFLINE_MODE === '1' ? null : readStartupContext(projectRoot);
    const releaseMode = hasReleaseFlag(processArguments);
    const spawnChild = options.spawnChild || ((file, args, spawnOptions) => fork(file, args, spawnOptions));
    const schedule = options.schedule || ((callback, delayMs) => setTimeout(callback, delayMs));
    const cancelSchedule = options.cancelSchedule || ((timer) => clearTimeout(timer));
    const exit = options.exit || ((code) => process.exit(code));

    let child = null;
    let stopping = false;
    let restartRequested = false;
    let restartTimer = null;
    let crashCount = 0;
    let updateInProgress = false;
    let updatePromise = null;

    async function stopChildForUpdate() {
        const current = child;
        if (!current) return;
        clearRestartTimer();
        await new Promise((resolve, reject) => {
            let forcedTimeout = null;
            const timeout = setTimeout(() => {
                forcedTimeout = setTimeout(() => reject(new Error('子服务器进程无法停止')), 3000);
                current.kill('SIGKILL');
            }, 12000);
            current.once('exit', () => { clearTimeout(timeout); if (forcedTimeout) clearTimeout(forcedTimeout); resolve(); });
            current.kill('SIGTERM');
        });
    }

    function requestServiceUpdate(message) {
        if (stopping || updateInProgress || typeof message.requestId !== 'string' ||
            !/^[a-zA-Z0-9-]{1,128}$/.test(message.requestId) || typeof message.force !== 'boolean') return;
        updateInProgress = true;
        const createUpdater = options.createUpdater || createMainServerSubserverUpdater;
        const updater = createUpdater({
            projectRoot, healthUrl: message.healthUrl,
            serverUrl: message.mainServerUrl, android: environment.AASC_ANDROID_NODE === '1',
            isRunning: () => !!child,
            serviceController: {
                stop: stopChildForUpdate,
                async start(context) {
                    if (stopping) throw new Error('启动器正在退出，取消更新启动');
                    activeContext = context;
                    spawnServerChild();
                }
            }
        });
        updatePromise = updater.update(message).then(result => {
            console.log(`[启动器] 主服务器代码更新结果: ${JSON.stringify(result)}`);
            return result;
        }).catch(error => {
            console.error(`[启动器] 主服务器代码更新失败: ${error.message}`);
        }).finally(() => {
            updateInProgress = false;
            // 准备阶段旧子进程若自行退出且准备失败，恢复监督，不能让节点停在无进程状态。
            if (!child && !stopping) spawnServerChild();
        });
    }

    function clearRestartTimer() {
        if (restartTimer === null) return;
        cancelSchedule(restartTimer);
        restartTimer = null;
    }

    function handleChildMessage(message) {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'serverUpdateRequested') {
            requestServiceUpdate(message);
            return;
        }
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

        // 更新事务显式管理stop/start，不能在切换窗口触发自动重启旧代码。
        if (updateInProgress) return;

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
            const childEnvironment = { ...environment, AASC_SERVER_CHILD: '1', AASC_SUBSERVER_UPDATE_IPC: '1' };
            const selectedServerPath = activeContext?.codeVersion
                ? path.join(activeContext.codeRoot, 'src/apps/server/boot/server-app.js') : serverPath;
            if (activeContext?.codeVersion) {
                childEnvironment.AASC_PROJECT_ROOT = projectRoot;
                childEnvironment.AASC_NODE_MODULES_DIR = activeContext.nodeModulesRoot;
                childEnvironment.NODE_PATH = [activeContext.nodeModulesRoot, environment.NODE_PATH].filter(Boolean).join(path.delimiter);
            }
            if (releaseMode) childEnvironment.AASC_RELEASE_MODE = '1';
            child = spawnChild(selectedServerPath, processArguments, {
                stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
                env: childEnvironment
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
        requestServiceUpdate,
        getUpdatePromise: () => updatePromise,
        constants: {
            DEFAULT_RESTART_DELAY_MS,
            MAX_CRASH_RESTARTS
        }
    };
}

function main() {
    // 完整退出后使用最新版本的launcher实现；正在运行的监督器稳定完成本次更新事务。
    if (process.env.AASC_OFFLINE_MODE !== '1') {
        const root = path.resolve(process.env.AASC_PROJECT_ROOT || path.resolve(__dirname, '../../../..'));
        const context = readStartupContext(root);
        if (context.codeVersion) {
            const launcherPath = path.join(context.codeRoot, 'src/apps/server/boot/server-launcher.js');
            if (path.resolve(launcherPath) !== path.resolve(__filename)) {
                process.env.AASC_PROJECT_ROOT = root;
                return require(launcherPath).main();
            }
        }
    }
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
