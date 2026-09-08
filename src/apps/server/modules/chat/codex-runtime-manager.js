'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const CodexBridge = require('../ai-roles/codex-bridge');
const {
    normalizeAgentProfile,
    normalizeChatTemplate,
    buildChatSessionKey
} = require('./pi-runtime-policy');

const DEFAULT_RUNTIME_ROOT = path.join(os.tmpdir(), 'aasc-codex-chat-runtime');

/**
 * 管理普通聊天使用的 Codex app-server 会话。
 * 普通聊天和工作 Agent 使用不同的管理器及目录，避免 thread、进程和权限互相污染。
 */
class CodexRuntimeManager {
    constructor(options = {}) {
        this.projectRoot = options.projectRoot || process.cwd();
        this.runtimeRoot = options.runtimeRoot || DEFAULT_RUNTIME_ROOT;
        this.commandPath = options.commandPath || process.env.CODEX_COMMAND_PATH || 'codex';
        this.proxy = options.proxy;
        this.disabled = options.disabled === true;
        this.readTimeoutMs = options.readTimeoutMs;
        this.bridgeFactory = options.bridgeFactory || ((bridgeOptions) => new CodexBridge(bridgeOptions));
        this.logger = typeof options.logger === 'function' ? options.logger : () => {};
        this.sessions = new Map();
    }

    async chatStream(profile, template, prompt, callbacks = {}, options = {}) {
        if (this.disabled) {
            const error = new Error('Android APK 节点不支持能力: externalCli');
            error.code = 'androidCapabilityUnavailable';
            error.feature = 'externalCli';
            throw error;
        }
        const normalizedProfile = normalizeAgentProfile(profile);
        if (normalizedProfile.mode !== 'agent' || normalizedProfile.backend !== 'codex') {
            throw new Error('Codex Runtime 只接受 agent/codex profile');
        }
        const normalizedTemplate = normalizeChatTemplate(template);
        const key = this.getSessionKey(normalizedProfile, normalizedTemplate, options.conversationKey);
        const session = this.getOrCreateSession(
            key,
            normalizedProfile,
            normalizedTemplate,
            options.developerInstructions || ''
        );
        let callbackErrorReported = false;
        const bridgeCallbacks = {
            ...callbacks,
            onError: (error) => {
                callbackErrorReported = true;
                callbacks.onError?.(error instanceof Error ? error.message : String(error));
            }
        };
        const request = session.queue.then(async () => {
            if (session.closed || this.sessions.get(key) !== session) {
                throw new Error('Codex Runtime 会话已停止');
            }
            const content = session.initialized
                ? String(options.continuationPrompt || prompt || '')
                : String(prompt || '');
            const result = await session.bridge.chat(content, bridgeCallbacks);
            session.initialized = true;
            return result;
        });
        session.queue = request.catch(() => undefined);
        try {
            return await request;
        } catch (error) {
            this.terminateSession(session);
            if (!callbackErrorReported) {
                callbacks.onError?.(error instanceof Error ? error.message : String(error));
            }
            throw error;
        } finally {
            if (options.ephemeral === true) this.terminateSession(session);
        }
    }

    getSessionKey(profile, template, conversationKey = 'default') {
        const baseKey = buildChatSessionKey({
            profileName: profile.name || 'default',
            templateId: template.id || template.name || 'default',
            mode: 'agent'
        });
        return `${baseKey}:permission:${template.permissionProfile}:conversation:${conversationKey}`;
    }

    getOrCreateSession(key, profile, template, developerInstructions = '') {
        const configurationFingerprint = JSON.stringify({
            profile,
            template,
            developerInstructions
        });
        const existing = this.sessions.get(key);
        if (existing && !existing.closed && existing.configurationFingerprint === configurationFingerprint) {
            return existing;
        }
        if (existing && !existing.closed) this.terminateSession(existing);

        const sessionHash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
        const bridgeOptions = {
            dir: path.join(this.runtimeRoot, sessionHash),
            name: `chat-${sessionHash}`,
            commandPath: this.commandPath,
            cwd: this.projectRoot,
            ...(this.proxy !== undefined ? { proxy: this.proxy } : {}),
            ...(this.readTimeoutMs !== undefined ? { readTimeoutMs: this.readTimeoutMs } : {}),
            approvalPolicy: 'never',
            sandboxPolicy: { type: 'readOnly' }
        };
        const bridge = this.bridgeFactory(bridgeOptions);
        bridge.setPrompt?.(developerInstructions);
        const session = {
            key,
            bridge,
            queue: Promise.resolve(),
            initialized: false,
            closed: false,
            configurationFingerprint,
            profile,
            template
        };
        this.sessions.set(key, session);
        return session;
    }

    resetSession(profile, template, conversationKey = 'default') {
        const normalizedProfile = normalizeAgentProfile(profile);
        const normalizedTemplate = normalizeChatTemplate(template);
        const key = this.getSessionKey(normalizedProfile, normalizedTemplate, conversationKey);
        const session = this.sessions.get(key);
        if (!session) return false;
        this.terminateSession(session);
        return true;
    }

    async stopAll() {
        for (const session of [...this.sessions.values()]) this.terminateSession(session);
    }

    terminateSession(session) {
        if (!session || session.closed) return;
        session.closed = true;
        this.sessions.delete(session.key);
        try {
            session.bridge.stop?.();
        } catch (error) {
            this.log(`Codex 会话清理失败: ${error.message}`, { sessionKey: session.key });
        }
    }

    getSessionCount() {
        return this.sessions.size;
    }

    log(message, details = {}) {
        try {
            this.logger(message, details);
        } catch (error) {
            // 诊断日志不能影响会话清理。
        }
    }
}

module.exports = { CodexRuntimeManager };
