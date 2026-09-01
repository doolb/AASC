'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CHAT_HISTORY_FILE_PATTERN = /^chat-history(?:-[^/]+)?\.json$/u;
const BACKUP_PREFIX = 'aasc-user-previous-day-';
const USER_CONFIG_EXPORT_FORMAT = 'aasc-user-config';
const CHAT_HISTORY_EXPORT_FORMAT = 'aasc-chat-history';
const EXPORT_VERSION = 1;
const MAX_IMPORT_FILES = 5000;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

const toPosixPath = (value) => value.split(path.sep).join('/');

const isRuntimeFileName = (fileName) => /(?:\.log|\.pid|\.lock|\.tmp|\.sock|\.socket)$/iu.test(fileName)
    || /^(?:server|backend|worker)\.(?:log|pid|lock|sock)$/iu.test(fileName);

const isPersistentRelativePath = (relativePath) => {
    const normalized = toPosixPath(relativePath);
    const segments = normalized.split('/');
    const fileName = segments[segments.length - 1] || '';
    if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return false;
    if (segments.includes('..') || segments.includes('aasc-user-backups') || segments.includes('chat-history-backups')) return false;
    return !isRuntimeFileName(fileName);
};

const createLogger = (logger) => {
    if (typeof logger === 'function') return logger;
    return (level, message) => {
        const method = level === 'error' ? console.error : console.log;
        method(`[ChatStore] ${message}`);
    };
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const stableStringify = (value) => JSON.stringify(value, Object.keys(value).sort());

const getMessageFingerprint = (message) => crypto
    .createHash('sha256')
    .update(stableStringify({
        timestamp: message.timestamp || 0,
        role: message.role || '',
        name: message.name || '',
        content: message.content || '',
        mode: message.mode || 'group',
        target: message.target || null,
        sessionId: message.sessionId || 'default',
        profileName: message.profileName || 'default',
        templateId: message.templateId || 'default'
    }))
    .digest('hex');

const normalizeChatMessage = (message, defaults = {}) => {
    if (!message || typeof message !== 'object') {
        throw new Error('消息内容无效');
    }

    const legacyContent = typeof message.user === 'string'
        ? message.user
        : (typeof message.assistant === 'string' ? message.assistant : '');
    const content = typeof message.content === 'string' ? message.content : legacyContent;
    if (!content) throw new Error('消息内容无效');

    const mode = message.mode === 'private' ? 'private' : (message.mode || defaults.mode || 'group');
    const target = mode === 'private' ? (message.target || defaults.target || null) : null;
    const normalized = {
        ...message,
        id: String(message.id || ''),
        timestamp: Number.isFinite(Number(message.timestamp)) ? Number(message.timestamp) : Date.now(),
        role: message.role || (message.assistant !== undefined ? 'assistant' : 'user'),
        name: message.name || '',
        content,
        mode,
        target,
        sessionId: String(message.sessionId || defaults.sessionId || 'default'),
        profileName: String(message.profileName || defaults.profileName || 'default'),
        templateId: String(message.templateId || defaults.templateId || 'default')
    };
    if (!normalized.id) normalized.id = `import-${getMessageFingerprint(normalized)}`;
    return normalized;
};

const createChatHistoryStore = (options = {}) => {
    const historyDir = path.resolve(options.historyDir || process.cwd());
    const backupDir = path.resolve(options.backupDir || path.join(path.dirname(historyDir), 'aasc-user-backups'));
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const timeZone = options.timeZone || 'Asia/Shanghai';
    const logger = createLogger(options.logger);

    const ensureDirectory = (directory) => fs.mkdirSync(directory, { recursive: true });

    const atomicWriteFile = (filePath, content, mode = 0o600) => {
        const directory = path.dirname(filePath);
        ensureDirectory(directory);
        const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        try {
            fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode });
            fs.renameSync(temporaryPath, filePath);
        } catch (error) {
            try { fs.rmSync(temporaryPath, { force: true }); } catch (_) { /* 保留原始错误 */ }
            throw error;
        }
    };

    const getDateParts = (value) => {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date(value));
        return Object.fromEntries(parts
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]));
    };

    const getPreviousDay = () => {
        const current = getDateParts(now());
        const previous = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day)) - 86400000);
        return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`;
    };

    const validateHistoryFileName = (fileName) => {
        if (typeof fileName !== 'string' || !CHAT_HISTORY_FILE_PATTERN.test(fileName) || path.basename(fileName) !== fileName) {
            throw new Error(`历史文件名无效: ${fileName}`);
        }
        return fileName;
    };

    const getHistoryFileName = (message) => {
        const target = message && message.mode === 'private' && message.target ? String(message.target) : '';
        return validateHistoryFileName(target ? `chat-history-${target}.json` : 'chat-history.json');
    };

    const load = () => {
        if (!fs.existsSync(historyDir)) return [];
        const files = fs.readdirSync(historyDir)
            .filter((fileName) => CHAT_HISTORY_FILE_PATTERN.test(fileName))
            .sort();
        const messages = [];
        for (const fileName of files) {
            try {
                const value = JSON.parse(fs.readFileSync(path.join(historyDir, fileName), 'utf8'));
                if (!Array.isArray(value)) {
                    logger('error', `历史文件不是数组，已跳过: ${fileName}`);
                    continue;
                }
                messages.push(...value);
            } catch (error) {
                logger('error', `历史文件读取失败，已保留原文件: ${fileName}: ${error.message}`);
            }
        }
        return messages;
    };

    const saveSnapshot = (messages, options = {}) => {
        const grouped = new Map();
        for (const message of Array.isArray(messages) ? messages : []) {
            const fileName = getHistoryFileName(message);
            if (!grouped.has(fileName)) grouped.set(fileName, []);
            grouped.get(fileName).push(message);
        }

        const changedFiles = new Set((options.changedFiles || []).map(validateHistoryFileName));
        const writtenFiles = [];
        for (const [fileName, fileMessages] of grouped.entries()) {
            atomicWriteFile(path.join(historyDir, fileName), JSON.stringify(fileMessages, null, 2));
            writtenFiles.push(fileName);
        }
        for (const fileName of changedFiles) {
            if (grouped.has(fileName)) continue;
            atomicWriteFile(path.join(historyDir, fileName), '[]');
            writtenFiles.push(fileName);
        }
        return { writtenFiles };
    };

    const collectPersistentFiles = (rootDir = historyDir) => {
        if (!fs.existsSync(rootDir)) return [];
        const result = [];
        const walk = (currentDir, relativeDir) => {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
                const normalizedPath = toPosixPath(relativePath);
                if (entry.isSymbolicLink()) continue;
                if (entry.isDirectory()) {
                    if (isPersistentRelativePath(`${normalizedPath}/placeholder`)) walk(path.join(currentDir, entry.name), relativePath);
                    continue;
                }
                if (entry.isFile() && isPersistentRelativePath(normalizedPath)) result.push(normalizedPath);
            }
        };
        walk(rootDir, '');
        return result.sort();
    };

    const copyPersistentFiles = (targetDir) => {
        for (const relativePath of collectPersistentFiles()) {
            const sourcePath = path.join(historyDir, relativePath);
            const targetPath = path.join(targetDir, relativePath);
            ensureDirectory(path.dirname(targetPath));
            fs.copyFileSync(sourcePath, targetPath);
            try {
                fs.chmodSync(targetPath, fs.statSync(sourcePath).mode & 0o777);
            } catch (_) { /* 权限复制失败不影响内容备份 */ }
        }
    };

    const removeOldBackups = (keepName) => {
        if (!fs.existsSync(backupDir)) return;
        for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || !entry.name.startsWith(BACKUP_PREFIX) || entry.name === keepName) continue;
            fs.rmSync(path.join(backupDir, entry.name), { recursive: true, force: true });
        }
    };

    const ensurePreviousDayBackup = () => {
        const backupName = `${BACKUP_PREFIX}${getPreviousDay()}`;
        const backupPath = path.join(backupDir, backupName);
        if (fs.existsSync(backupPath)) return { created: false, path: backupPath };

        ensureDirectory(backupDir);
        const temporaryPath = path.join(backupDir, `.${backupName}.tmp-${process.pid}-${Date.now()}`);
        try {
            fs.rmSync(temporaryPath, { recursive: true, force: true });
            ensureDirectory(temporaryPath);
            copyPersistentFiles(temporaryPath);
            atomicWriteFile(path.join(temporaryPath, 'manifest.json'), JSON.stringify({
                format: USER_CONFIG_EXPORT_FORMAT,
                version: EXPORT_VERSION,
                root: 'aasc-user',
                backupDate: getPreviousDay(),
                createdAt: new Date(now()).toISOString()
            }, null, 2));
            fs.renameSync(temporaryPath, backupPath);
            removeOldBackups(backupName);
            logger('info', `已创建 aasc-user 上一天配置快照: ${backupName}`);
            return { created: true, path: backupPath };
        } catch (error) {
            try { fs.rmSync(temporaryPath, { recursive: true, force: true }); } catch (_) { /* 保留原始错误 */ }
            throw error;
        }
    };

    const createExport = (messages) => ({
        format: CHAT_HISTORY_EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: new Date(now()).toISOString(),
        messages: cloneJson(Array.isArray(messages) ? messages : [])
    });

    const parseChatImport = (payload) => {
        if (Array.isArray(payload)) return payload.map((message) => normalizeChatMessage(message));
        if (!payload || payload.format !== CHAT_HISTORY_EXPORT_FORMAT || payload.version !== EXPORT_VERSION || !Array.isArray(payload.messages)) {
            throw new Error('导入文件格式不支持');
        }
        return payload.messages.map((message) => normalizeChatMessage(message));
    };

    const mergeImport = (existing, payload) => {
        const current = (Array.isArray(existing) ? existing : []).map((message) => normalizeChatMessage(message));
        const imported = parseChatImport(payload);
        const ids = new Set(current.map((message) => String(message.id || '')));
        const fingerprints = new Set(current.map(getMessageFingerprint));
        const messages = [...current];
        let importedCount = 0;
        let skippedCount = 0;
        for (const message of imported) {
            const fingerprint = getMessageFingerprint(message);
            if (ids.has(String(message.id)) || fingerprints.has(fingerprint)) {
                skippedCount += 1;
                continue;
            }
            ids.add(String(message.id));
            fingerprints.add(fingerprint);
            messages.push(message);
            importedCount += 1;
        }
        return { messages, importedCount, skippedCount };
    };

    const validateUserConfigPayload = (payload) => {
        if (!payload || payload.format !== USER_CONFIG_EXPORT_FORMAT || payload.version !== EXPORT_VERSION || payload.root !== 'aasc-user' || !Array.isArray(payload.files)) {
            throw new Error('配置导入文件格式不支持');
        }
        if (payload.files.length > MAX_IMPORT_FILES) throw new Error('配置文件数量超过限制');

        const seen = new Set();
        let totalBytes = 0;
        const files = payload.files.map((file) => {
            if (!file || typeof file.path !== 'string') throw new Error('配置文件路径无效');
            const relativePath = toPosixPath(file.path);
            if (!isPersistentRelativePath(relativePath) || path.posix.normalize(relativePath) !== relativePath || relativePath.startsWith('../')) {
                if (isRuntimeFileName(path.posix.basename(relativePath))) throw new Error('运行时文件不允许导入');
                throw new Error('配置文件路径无效');
            }
            if (seen.has(relativePath)) throw new Error(`配置文件重复: ${relativePath}`);
            if (file.encoding !== 'base64' || typeof file.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(file.content)) {
                throw new Error(`配置文件内容无效: ${relativePath}`);
            }
            const content = Buffer.from(file.content, 'base64');
            totalBytes += content.length;
            if (totalBytes > MAX_IMPORT_BYTES) throw new Error('配置文件总大小超过限制');
            seen.add(relativePath);
            return {
                path: relativePath,
                content,
                mode: Number.isInteger(file.mode) ? file.mode & 0o777 : 0o600
            };
        });
        return files;
    };

    const createUserConfigExport = () => ({
        format: USER_CONFIG_EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: new Date(now()).toISOString(),
        root: 'aasc-user',
        files: collectPersistentFiles().map((relativePath) => {
            const filePath = path.join(historyDir, relativePath);
            const stat = fs.statSync(filePath);
            return {
                path: relativePath,
                encoding: 'base64',
                mode: stat.mode & 0o777,
                content: fs.readFileSync(filePath).toString('base64')
            };
        })
    });

    const pruneEmptyDirectories = () => {
        if (!fs.existsSync(historyDir)) return;
        const walk = (directory) => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
                walk(path.join(directory, entry.name));
            }
            if (directory === historyDir) return;
            if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
        };
        walk(historyDir);
    };

    const importUserConfig = (payload, options = {}) => {
        const mode = options.mode || 'merge';
        if (!['merge', 'replace'].includes(mode)) throw new Error('配置导入模式无效');
        if (mode === 'replace' && options.confirmed !== true) throw new Error('替换配置导入需要明确确认');
        const files = validateUserConfigPayload(payload);
        ensurePreviousDayBackup();
        ensureDirectory(historyDir);

        const importedPaths = new Set(files.map((file) => file.path));
        let deletedCount = 0;
        if (mode === 'replace') {
            for (const relativePath of collectPersistentFiles()) {
                if (importedPaths.has(relativePath)) continue;
                fs.rmSync(path.join(historyDir, relativePath), { force: true });
                deletedCount += 1;
            }
            pruneEmptyDirectories();
        }

        for (const file of files) {
            const targetPath = path.resolve(historyDir, file.path);
            if (!targetPath.startsWith(`${historyDir}${path.sep}`)) throw new Error('配置文件路径无效');
            const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            ensureDirectory(path.dirname(targetPath));
            try {
                fs.writeFileSync(temporaryPath, file.content, { mode: file.mode });
                fs.renameSync(temporaryPath, targetPath);
                try { fs.chmodSync(targetPath, file.mode); } catch (_) { /* 权限调整失败不影响导入内容 */ }
            } catch (error) {
                try { fs.rmSync(temporaryPath, { force: true }); } catch (_) { /* 保留原始错误 */ }
                throw error;
            }
        }
        logger('info', `aasc-user 配置导入完成: mode=${mode} written=${files.length} deleted=${deletedCount}`);
        return { writtenCount: files.length, deletedCount, restartRequired: true };
    };

    return {
        historyDir,
        backupDir,
        load,
        saveSnapshot,
        getHistoryFileName,
        collectPersistentFiles,
        ensurePreviousDayBackup,
        createExport,
        mergeImport,
        createUserConfigExport,
        importUserConfig,
        getMessageFingerprint,
        normalizeChatMessage
    };
};

module.exports = { createChatHistoryStore };
