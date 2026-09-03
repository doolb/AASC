#!/usr/bin/env node
'use strict';

const { requestText, runCli } = require('./common');
const {
    DEFAULT_WIDTH,
    MAX_WIDTH,
    MIN_WIDTH,
    formatChatHistory,
    formatSessions,
    parseWidth
} = require('./chat-tui');

function requireValue(argv, index, option) {
    const value = argv[index + 1];
    if (value === undefined || !String(value).trim()) throw new Error(option + ' 缺少参数');
    return String(value).trim();
}

function parsePositiveInteger(value, option) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new Error(option + ' 必须是正整数');
    return number;
}

function parseArgs(argv) {
    const options = {
        mode: undefined,
        target: undefined,
        sessionId: undefined,
        profileName: undefined,
        limit: undefined,
        width: DEFAULT_WIDTH,
        tui: false,
        sessions: false,
        help: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--mode') {
            const value = requireValue(argv, index, arg);
            if (!['group', 'private'].includes(value)) throw new Error('--mode 必须是 group 或 private');
            options.mode = value;
            index += 1;
        } else if (arg === '--target') {
            options.target = requireValue(argv, index, arg);
            index += 1;
        } else if (arg === '--session') {
            options.sessionId = requireValue(argv, index, arg);
            index += 1;
        } else if (arg === '--profile') {
            options.profileName = requireValue(argv, index, arg);
            index += 1;
        } else if (arg === '--limit') {
            options.limit = parsePositiveInteger(requireValue(argv, index, arg), arg);
            index += 1;
        } else if (arg === '--width') {
            options.width = parseWidth(requireValue(argv, index, arg));
            index += 1;
        } else if (arg === '--tui') {
            options.tui = true;
        } else if (arg === '--sessions') {
            options.sessions = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error('未知参数：' + arg);
        }
    }
    return options;
}

function filterSessions(sessions, options = {}) {
    const entries = Array.isArray(sessions) ? sessions : [];
    return entries.filter((session) => {
        if (options.mode && (session.mode || 'private') !== options.mode) return false;
        if (options.target && String(session.target || '') !== options.target) return false;
        const sessionId = session.id || session.sessionId || 'default';
        if (options.sessionId && String(sessionId) !== options.sessionId) return false;
        return true;
    });
}

function filterHistory(history, options = {}) {
    const messages = Array.isArray(history) ? history : [];
    const filtered = messages.filter((message) => {
        if (options.mode && (message.mode || 'group') !== options.mode) return false;
        if (options.target && String(message.target || '') !== options.target) return false;
        if (options.sessionId && String(message.sessionId || 'default') !== options.sessionId) return false;
        if (options.profileName && String(message.profileName || '') !== options.profileName) return false;
        return true;
    });
    return options.limit ? filtered.slice(-options.limit) : filtered;
}

function toOutputPayload(payload, options = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('聊天 API 返回必须是 JSON 对象');
    }
    if (!Array.isArray(payload.history)) throw new Error('聊天 API 返回缺少 history 数组');
    return { ...payload, history: filterHistory(payload.history, options) };
}

/**
 * 将 session 接口的完整条目裁剪为只读查看需要的最小字段。
 *
 * 服务端为了兼容控制端仍会返回 mode、id、createdAt 等管理字段，但
 * `--sessions` 只负责查看，不应把这些内部字段或聊天记录继续暴露到
 * 命令行输出。因此先用原始字段完成过滤，再只保留 target（角色名）
 * 和 name（session 名）。带 target 的旧接口响应没有 target 时，使用
 * 请求参数补回角色名。
 */
function toSessionNamesPayload(payload, historyPayload, options = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('session API 返回必须是 JSON 对象');
    }
    if (!Array.isArray(payload.sessions)) throw new Error('session API 返回缺少 sessions 数组');
    if (!historyPayload || typeof historyPayload !== 'object' || Array.isArray(historyPayload)) {
        throw new Error('聊天 API 返回必须是 JSON 对象');
    }
    if (!Array.isArray(historyPayload.history)) throw new Error('聊天 API 返回缺少 history 数组');

    const sessions = payload.sessions.map((session) => ({
        mode: session.mode || 'private',
        target: String(session.target || options.target || '').trim(),
        id: session.id || session.sessionId || 'default',
        name: String(session.name || session.sessionName || '').trim()
    }));
    const groupMessages = historyPayload.history
        .filter((message) => (message.mode || 'group') === 'group')
        .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));
    // 群聊没有挂在私聊 sessions 映射下，只在查看结果中补一个虚拟条目；
    // 这里仅提取首条用户输入作为名称，绝不把完整 history 带入输出。
    if (!options.target && options.mode !== 'private' && (!options.sessionId || options.sessionId === 'default') && groupMessages.length > 0) {
        const firstUserMessage = groupMessages.find((message) => (
            message.role === 'user'
            || message.role === 'control'
            || message.user !== undefined
        )) || groupMessages[0];
        const groupName = String(firstUserMessage.content || firstUserMessage.user || '').replace(/\s+/gu, ' ').trim();
        sessions.unshift({
            mode: 'group',
            target: '群聊',
            id: 'default',
            name: groupName || '默认会话'
        });
    }
    return {
        status: payload.status || (payload.success === false ? 'error' : 'success'),
        sessions: filterSessions(sessions, options).map((session) => ({
            target: session.target || '未知角色',
            name: session.name || (session.id === 'default' ? '默认会话' : session.id)
        }))
    };
}

function sessionRoute(target) {
    const value = String(target || '').trim();
    return value ? '/api/chat/sessions?target=' + encodeURIComponent(value) : '/api/chat/sessions';
}

function printHelp() {
    process.stdout.write(
        '用法：chat-history.js [选项]\n\n'
        + '只读调用 GET /api/chat/history，默认输出 JSON。\n\n'
        + '选项：\n'
        + '  --mode group|private  按聊天模式过滤\n'
        + '  --target TARGET       按目标过滤\n'
        + '  --session SESSION_ID  按会话过滤\n'
        + '  --profile PROFILE     按聊天配置过滤\n'
        + '  --limit N             只保留最近 N 条\n'
        + '  --sessions            只获取 session 名称和私聊角色名，无需 target\n'
        + '  --tui                 使用终端面板显示\n'
        + '  --width N             TUI 宽度，范围 ' + MIN_WIDTH + '..' + MAX_WIDTH + '\n'
        + '  --help                显示帮助\n\n'
        + '示例：\n'
        + '  scripts/api/chat-history.js\n'
        + '  scripts/api/chat-history.js --limit 20 --tui\n'
        + '  scripts/api/chat-history.js --sessions --tui\n'
        + '  scripts/api/chat-history.js --mode private --target 小爱 --session default --tui\n'
        + '环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS\n'
    );
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        printHelp();
        return;
    }
    let output;
    if (options.sessions) {
        const sessionsResponse = await requestText('GET', sessionRoute(options.target));
        let sessionsPayload;
        try {
            sessionsPayload = JSON.parse(sessionsResponse);
        } catch (error) {
            throw new Error('session API 返回无效 JSON：' + error.message, { cause: error });
        }
        const historyResponse = await requestText('GET', '/api/chat/history');
        let historyPayload;
        try {
            historyPayload = JSON.parse(historyResponse);
        } catch (error) {
            throw new Error('聊天 API 返回无效 JSON：' + error.message, { cause: error });
        }
        output = toSessionNamesPayload(sessionsPayload, historyPayload, options);
    } else {
        const response = await requestText('GET', '/api/chat/history');
        let historyPayload;
        try {
            historyPayload = JSON.parse(response);
        } catch (error) {
            throw new Error('聊天 API 返回无效 JSON：' + error.message, { cause: error });
        }
        output = toOutputPayload(historyPayload, options);
    }
    if (options.tui) {
        const rendered = options.sessions
            ? formatSessions(output, options.width)
            : formatChatHistory(output, options.width);
        process.stdout.write(rendered + '\n');
    } else {
        process.stdout.write(JSON.stringify(output) + '\n');
    }
    if (output.status === 'error' || output.success === false) process.exitCode = 1;
}

module.exports = {
    filterHistory,
    filterSessions,
    main,
    parseArgs,
    printHelp,
    sessionRoute,
    toOutputPayload,
    toSessionNamesPayload
};

if (require.main === module) runCli(main);
