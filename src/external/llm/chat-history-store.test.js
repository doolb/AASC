'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createChatHistoryStore } = require('./chat-history-store');

const createTempHistoryDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-chat-history-'));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const groupMessage = (content, timestamp = 1788228000000) => ({
    id: `group-${content}`,
    timestamp,
    role: 'control',
    name: '控制端',
    content,
    mode: 'group',
    target: null,
    sessionId: 'default',
    profileName: 'qwen3.5',
    templateId: 'default'
});

const privateMessage = (target, content, sessionId = 'default', timestamp = 1788228000000) => ({
    id: `${target}-${content}`,
    timestamp,
    role: 'user',
    name: '控制端',
    content,
    mode: 'private',
    target,
    sessionId,
    profileName: 'qwen3.5',
    templateId: target
});

test('普通群聊保存不会删除内存快照中缺失的私聊文件', () => {
    const historyDir = createTempHistoryDir();
    try {
        const privateFile = path.join(historyDir, 'chat-history-小爱.json');
        fs.writeFileSync(privateFile, JSON.stringify([privateMessage('小爱', '旧私聊')]), 'utf8');
        const store = createChatHistoryStore({ historyDir, now: () => 1788228000000 });

        store.saveSnapshot([groupMessage('新的群聊')], { changedFiles: ['chat-history.json'] });

        assert.deepEqual(readJson(privateFile).map((message) => message.content), ['旧私聊']);
        assert.deepEqual(readJson(path.join(historyDir, 'chat-history.json')).map((message) => message.content), ['新的群聊']);
    } finally {
        fs.rmSync(historyDir, { recursive: true, force: true });
    }
});

test('显式清空标记的私聊文件会写入空数组，但不会影响其他私聊', () => {
    const historyDir = createTempHistoryDir();
    try {
        const xiaoaiFile = path.join(historyDir, 'chat-history-小爱.json');
        const dajiFile = path.join(historyDir, 'chat-history-妲己.json');
        fs.writeFileSync(xiaoaiFile, JSON.stringify([privateMessage('小爱', '待清空')]), 'utf8');
        fs.writeFileSync(dajiFile, JSON.stringify([privateMessage('妲己', '保留')]), 'utf8');
        const store = createChatHistoryStore({ historyDir, now: () => 1788228000000 });

        store.saveSnapshot([privateMessage('妲己', '保留')], {
            changedFiles: ['chat-history-小爱.json', 'chat-history-妲己.json']
        });

        assert.deepEqual(readJson(xiaoaiFile), []);
        assert.deepEqual(readJson(dajiFile).map((message) => message.content), ['保留']);
    } finally {
        fs.rmSync(historyDir, { recursive: true, force: true });
    }
});

test('上一天备份只保留一份 aasc-user 完整配置快照，并在日期变化时替换旧备份', () => {
    const historyDir = createTempHistoryDir();
    let now = Date.parse('2026-09-01T10:00:00+08:00');
    try {
        fs.mkdirSync(path.join(historyDir, 'chat2api'), { recursive: true });
        fs.writeFileSync(path.join(historyDir, 'chat-history.json'), JSON.stringify([groupMessage('当前历史')]), 'utf8');
        fs.writeFileSync(path.join(historyDir, 'chat-session.json'), JSON.stringify({ mode: 'group' }), 'utf8');
        fs.writeFileSync(path.join(historyDir, 'chat2api', 'config.json'), JSON.stringify({ enabled: true }), 'utf8');
        fs.writeFileSync(path.join(historyDir, 'server.log'), 'runtime log', 'utf8');
        fs.writeFileSync(path.join(historyDir, 'server.pid'), '123', 'utf8');
        const store = createChatHistoryStore({ historyDir, now: () => now, timeZone: 'Asia/Shanghai' });
        store.ensurePreviousDayBackup();

        const backupDir = path.join(path.dirname(historyDir), 'aasc-user-backups');
        let backupFiles = fs.readdirSync(backupDir);
        assert.deepEqual(backupFiles, ['aasc-user-previous-day-2026-08-31']);
        const backupRoot = path.join(backupDir, backupFiles[0]);
        assert.deepEqual(readJson(path.join(backupRoot, 'chat-history.json')).map((message) => message.content), ['当前历史']);
        assert.deepEqual(readJson(path.join(backupRoot, 'chat2api', 'config.json')), { enabled: true });
        assert.equal(fs.existsSync(path.join(backupRoot, 'server.log')), false);
        assert.equal(fs.existsSync(path.join(backupRoot, 'server.pid')), false);

        now = Date.parse('2026-09-02T10:00:00+08:00');
        fs.writeFileSync(path.join(historyDir, 'chat-history.json'), JSON.stringify([groupMessage('新日期快照')]), 'utf8');
        store.ensurePreviousDayBackup();

        backupFiles = fs.readdirSync(backupDir);
        assert.deepEqual(backupFiles, ['aasc-user-previous-day-2026-09-01']);
        assert.deepEqual(readJson(path.join(backupDir, backupFiles[0], 'chat-history.json')).map((message) => message.content), ['新日期快照']);
    } finally {
        fs.rmSync(historyDir, { recursive: true, force: true });
        fs.rmSync(path.join(path.dirname(historyDir), 'aasc-user-backups'), { recursive: true, force: true });
    }
});

test('aasc-user 目录导出和导入保留相对路径并跳过运行时文件', () => {
    const sourceDir = createTempHistoryDir();
    const targetDir = createTempHistoryDir();
    try {
        fs.mkdirSync(path.join(sourceDir, 'chat2api'), { recursive: true });
        fs.writeFileSync(path.join(sourceDir, 'chat2api', 'config.json'), JSON.stringify({ model: 'qwen' }), 'utf8');
        fs.writeFileSync(path.join(sourceDir, 'userconfig.json'), JSON.stringify({ theme: 'dark' }), 'utf8');
        fs.writeFileSync(path.join(sourceDir, 'worker.log'), 'runtime log', 'utf8');
        const sourceStore = createChatHistoryStore({ historyDir: sourceDir, now: () => 1788228000000 });
        const payload = sourceStore.createUserConfigExport();

        assert.equal(payload.format, 'aasc-user-config');
        assert.equal(payload.version, 1);
        assert.deepEqual(payload.files.map((file) => file.path), ['chat2api/config.json', 'userconfig.json']);

        const targetStore = createChatHistoryStore({ historyDir: targetDir, now: () => 1788228000000 });
        const result = targetStore.importUserConfig(payload);
        assert.equal(result.writtenCount, 2);
        assert.deepEqual(readJson(path.join(targetDir, 'chat2api', 'config.json')), { model: 'qwen' });
        assert.deepEqual(readJson(path.join(targetDir, 'userconfig.json')), { theme: 'dark' });
        assert.equal(result.restartRequired, true);

        fs.writeFileSync(path.join(targetDir, 'old-config.json'), '{}', 'utf8');
        fs.writeFileSync(path.join(targetDir, 'runtime.log'), 'keep me', 'utf8');
        const replaceResult = targetStore.importUserConfig(payload, { mode: 'replace', confirmed: true });
        assert.equal(replaceResult.deletedCount, 1);
        assert.equal(fs.existsSync(path.join(targetDir, 'old-config.json')), false);
        assert.equal(fs.existsSync(path.join(targetDir, 'runtime.log')), true);
    } finally {
        fs.rmSync(sourceDir, { recursive: true, force: true });
        fs.rmSync(targetDir, { recursive: true, force: true });
        fs.rmSync(path.join(path.dirname(sourceDir), 'aasc-user-backups'), { recursive: true, force: true });
        fs.rmSync(path.join(path.dirname(targetDir), 'aasc-user-backups'), { recursive: true, force: true });
    }
});

test('aasc-user 目录导入拒绝路径穿越和运行时文件', () => {
    const historyDir = createTempHistoryDir();
    try {
        const store = createChatHistoryStore({ historyDir });
        assert.throws(() => store.importUserConfig({
            format: 'aasc-user-config', version: 1, root: 'aasc-user', files: []
        }, { mode: 'replace' }), /替换配置导入需要明确确认/u);
        assert.throws(() => store.importUserConfig({
            format: 'aasc-user-config',
            version: 1,
            root: 'aasc-user',
            files: [{ path: '../outside.json', content: '', encoding: 'base64' }]
        }), /配置文件路径无效/u);
        assert.throws(() => store.importUserConfig({
            format: 'aasc-user-config',
            version: 1,
            root: 'aasc-user',
            files: [{ path: 'server.log', content: '', encoding: 'base64' }]
        }), /运行时文件不允许导入/u);
    } finally {
        fs.rmSync(historyDir, { recursive: true, force: true });
    }
});

test('导出使用版本化 JSON，合并导入按 ID 和稳定指纹去重', () => {
    const historyDir = createTempHistoryDir();
    try {
        const store = createChatHistoryStore({ historyDir, now: () => 1788228000000 });
        const existing = [groupMessage('已有消息')];
        const payload = store.createExport(existing);

        assert.equal(payload.format, 'aasc-chat-history');
        assert.equal(payload.version, 1);
        assert.ok(payload.exportedAt);
        assert.deepEqual(payload.messages, existing);

        const result = store.mergeImport(existing, {
            format: 'aasc-chat-history',
            version: 1,
            messages: [
                groupMessage('已有消息'),
                { ...groupMessage('新消息'), id: 'new-message' }
            ]
        });
        assert.equal(result.importedCount, 1);
        assert.equal(result.skippedCount, 1);
        assert.deepEqual(result.messages.map((message) => message.content), ['已有消息', '新消息']);
    } finally {
        fs.rmSync(historyDir, { recursive: true, force: true });
    }
});

test('导入拒绝无效格式和无内容消息', () => {
    const historyDir = createTempHistoryDir();
    try {
        const store = createChatHistoryStore({ historyDir });
        assert.throws(() => store.mergeImport([], { format: 'other', version: 1, messages: [] }), /导入文件格式不支持/u);
        assert.throws(() => store.mergeImport([], { format: 'aasc-chat-history', version: 1, messages: [{ role: 'user' }] }), /消息内容无效/u);
    } finally {
        fs.rmSync(historyDir, { recursive: true, force: true });
    }
});
