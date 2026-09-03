#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { runCli } = require('./common');

const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 48;
const MAX_WIDTH = 140;

function displayWidth(value) {
    return [...String(value ?? '')].reduce((total, character) => {
        const code = character.codePointAt(0) || 0;
        const isWide = code >= 0x1100 && (
            code <= 0x115f
            || code === 0x2329 || code === 0x232a
            || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
            || (code >= 0xac00 && code <= 0xd7a3)
            || (code >= 0xf900 && code <= 0xfaff)
            || (code >= 0xfe10 && code <= 0xfe6f)
            || (code >= 0xff01 && code <= 0xff60)
            || (code >= 0x1f300 && code <= 0x1f9ff)
        );
        return total + (isWide ? 2 : 1);
    }, 0);
}

function stripTerminalControl(value) {
    return String(value ?? '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
}

function truncate(value, maxWidth) {
    const text = stripTerminalControl(value);
    if (displayWidth(text) <= maxWidth) return text;
    let result = '';
    let width = 0;
    for (const character of text) {
        const characterWidth = displayWidth(character);
        if (width + characterWidth + 1 > maxWidth) break;
        result += character;
        width += characterWidth;
    }
    return result + '…';
}

function wrapText(value, maxWidth) {
    const text = stripTerminalControl(value);
    if (!text) return ['（空）'];
    const lines = [];
    for (const sourceLine of text.split(/\r?\n/u)) {
        let line = '';
        let width = 0;
        for (const character of sourceLine) {
            const characterWidth = displayWidth(character);
            if (line && width + characterWidth > maxWidth) {
                lines.push(line);
                line = '';
                width = 0;
            }
            line += character;
            width += characterWidth;
        }
        lines.push(line || ' ');
    }
    return lines;
}

function panel(title, lines, width) {
    const innerWidth = width - 4;
    const titleText = ' ' + truncate(title, innerWidth - 2) + ' ';
    const top = '┌' + titleText
        + '─'.repeat(Math.max(0, width - 2 - displayWidth(titleText))) + '┐';
    const body = lines
        .flatMap((line) => wrapText(line, innerWidth))
        .map((line) => '│ ' + line + ' '.repeat(Math.max(0, innerWidth - displayWidth(line))) + ' │');
    return [top, ...body, '└' + '─'.repeat(width - 2) + '┘'];
}

function parseWidth(value) {
    const width = Number(value);
    if (!Number.isInteger(width) || width < MIN_WIDTH || width > MAX_WIDTH) {
        throw new Error('--width 必须是 ' + MIN_WIDTH + '..' + MAX_WIDTH + ' 的整数');
    }
    return width;
}

function formatTimestamp(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return '时间未知';
    return date.toLocaleString('zh-CN', { hour12: false });
}

function roleLabel(message, fallback) {
    if (message.role === 'assistant') return message.name || '助手';
    if (message.role === 'control' || message.role === 'user') return message.name || '用户';
    return message.name || message.role || fallback;
}

function messageLines(message, fallbackRole) {
    const metadata = roleLabel(message, fallbackRole) + ' · ' + formatTimestamp(message.timestamp);
    return [metadata, ...wrapText(message.content ?? '', 1_000_000)];
}

function historyLines(message) {
    if (message && (message.user !== undefined || message.assistant !== undefined)) {
        return [
            '对话 · ' + formatTimestamp(message.timestamp),
            ...wrapText('用户：' + (message.user ?? ''), 1_000_000),
            ...wrapText('助手：' + (message.assistant ?? ''), 1_000_000)
        ];
    }
    return messageLines(message || {}, '消息');
}

function sessionLines(session) {
    if (typeof session === 'string') return session;
    const target = session.target || '未知角色';
    const name = session.name || '默认会话';
    return `${target} · ${name}`;
}

/**
 * 渲染只读 session 列表。
 *
 * 该入口专门服务于 `chat-history.js --sessions`，所以面板正文只展示
 * 私聊角色名和 session 名，不渲染聊天消息、session ID 或创建时间。
 */
function formatSessions(payload, requestedWidth = DEFAULT_WIDTH) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('session API 返回必须是 JSON 对象');
    }
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(requestedWidth) || DEFAULT_WIDTH));
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const status = payload.status || (payload.success === false ? 'error' : 'success');
    const summary = ['状态：' + status, '会话数：' + sessions.length];
    if (status === 'error' || payload.success === false) {
        summary.push('错误：' + (payload.message || payload.error || '未知错误'));
    }
    const sessionContent = sessions.length > 0
        ? sessions.map(sessionLines)
        : ['（暂无 session）'];
    return [
        ...panel('会话列表', summary, width),
        ...panel('角色名 · session 名', sessionContent, width)
    ].join('\n');
}

function formatChatHistory(payload, requestedWidth = DEFAULT_WIDTH) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('聊天 API 返回必须是 JSON 对象');
    }
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(requestedWidth) || DEFAULT_WIDTH));
    const history = Array.isArray(payload.history) ? payload.history : [];
    const status = payload.status || (payload.success === false ? 'error' : 'success');
    const summary = ['状态：' + status, '消息数：' + history.length];
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : null;
    if (sessions) summary.push('会话数：' + sessions.length);
    if (payload.requestId) summary.push('请求：' + payload.requestId);
    if (status === 'error' || payload.success === false) {
        summary.push('错误：' + (payload.message || payload.error || '未知错误'));
    }

    const lines = panel('聊天历史', summary, width);
    if (sessions) {
        const sessionContent = sessions.length > 0
            ? sessions.map(sessionLines)
            : ['（暂无 session）'];
        lines.push(...panel('会话列表', sessionContent, width));
    }
    if (history.length === 0) {
        lines.push(...panel('消息', ['（暂无聊天记录）'], width));
        return lines.join('\n');
    }
    history.forEach((message, index) => {
        const metadata = [
            '#' + (index + 1),
            message.mode || 'group',
            message.target || '默认目标',
            message.sessionId || 'default',
            message.profileName || '当前配置'
        ].join(' · ');
        lines.push(...panel(metadata, historyLines(message), width));
    });
    return lines.join('\n');
}

function parseArgs(argv) {
    const options = { width: DEFAULT_WIDTH, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--width') {
            if (argv[index + 1] === undefined) throw new Error('--width 缺少参数');
            options.width = parseWidth(argv[++index]);
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error('未知参数：' + arg);
        }
    }
    return options;
}

function printHelp() {
    process.stdout.write(
        '用法：chat-tui.js [--width N] < chat-history.json\n\n'
        + '将 /api/chat/history 返回的 JSON 渲染为只读终端聊天面板。\n\n'
        + '选项：\n'
        + '  --width N    面板宽度，范围 ' + MIN_WIDTH + '..' + MAX_WIDTH + '，默认 ' + DEFAULT_WIDTH + '\n'
        + '  --help       显示帮助\n'
    );
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        printHelp();
        return;
    }
    const input = fs.readFileSync(0, 'utf8');
    const payload = JSON.parse(input);
    process.stdout.write(formatChatHistory(payload, options.width) + '\n');
    if (payload.status === 'error' || payload.success === false) process.exitCode = 1;
}

module.exports = {
    DEFAULT_WIDTH,
    MAX_WIDTH,
    MIN_WIDTH,
    displayWidth,
    formatChatHistory,
    formatSessions,
    main,
    parseArgs,
    parseWidth,
    panel,
    wrapText
};

if (require.main === module) runCli(main);
