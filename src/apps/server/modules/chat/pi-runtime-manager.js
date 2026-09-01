'use strict';

const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn: defaultSpawn } = require('node:child_process');
const {
    normalizeAgentProfile,
    normalizeChatTemplate,
    resolvePermissionPolicy,
    normalizeOpenAiBaseUrl,
    buildChatSessionKey
} = require('./pi-runtime-policy');

const DEFAULT_REQUEST_TIMEOUT_MS = 600000;
const DEFAULT_REQUEST_QUEUE_TIMEOUT_MS = 30000;
const MAX_AUTOMATIC_RETRIES = 1;
const DEFAULT_EXTENSION_PATH = path.join(__dirname, 'pi-readonly-tools.mjs');

function formatPiUserPrompt(prompt) {
    const text = String(prompt || '');
    return text.startsWith('User:') ? text : `User:${text}`;
}

class PiRuntimeManager {
    constructor(options = {}) {
        this.projectRoot = options.projectRoot || process.cwd();
        this.extensionPath = options.extensionPath || DEFAULT_EXTENSION_PATH;
        this.spawn = options.spawn || defaultSpawn;
        this.commandPath = options.commandPath || process.env.PI_COMMAND_PATH || 'pi';
        this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
        this.requestQueueTimeoutMs = options.requestQueueTimeoutMs || DEFAULT_REQUEST_QUEUE_TIMEOUT_MS;
        this.responsesBaseUrl = options.responsesBaseUrl || '';
        this.logger = typeof options.logger === 'function' ? options.logger : () => {};
        this.sessions = new Map();
        this.requestSequence = 0;
    }

    buildSpawnArgs(profile, template, extensionPath = this.extensionPath) {
        const normalizedTemplate = normalizeChatTemplate(template);
        const policy = resolvePermissionPolicy(normalizedTemplate.permissionProfile);
        return [
            '--mode', 'rpc',
            '--no-session',
            '--no-context-files',
            '--no-extensions',
            '--extension', extensionPath,
            '--provider', 'aasc-openai',
            '--model', `aasc-openai/${profile.model || ''}`,
            '--tools', policy.tools.join(',')
        ];
    }

    async chatStream(profile, template, prompt, callbacks = {}, options = {}) {
        const normalizedProfile = normalizeAgentProfile(profile);
        if (normalizedProfile.mode !== 'agent' || normalizedProfile.backend !== 'pi') {
            throw new Error('Pi Runtime 只接受 agent/pi profile');
        }
        const normalizedTemplate = normalizeChatTemplate(template);
        const key = this.getSessionKey(normalizedProfile, normalizedTemplate, options.conversationKey);
        try {
            return await this.enqueueRequest({
                key,
                profile: normalizedProfile,
                template: normalizedTemplate,
                prompt,
                callbacks,
                options,
                attempt: 0,
                retryState: { count: 0 }
            });
        } finally {
            // 搜索等一次性任务不能把独立 Pi 进程留在 sessions 中，否则每次搜索都会叠加一个常驻进程。
            if (options.ephemeral === true) {
                const session = this.sessions.get(key);
                if (session) this.terminateSession(session);
            }
        }
    }

    enqueueRequest({ key, profile, template, prompt, callbacks, options, attempt, retryState }) {
        const session = this.getOrCreateSession(key, profile, template);
        const requestId = `aasc-${++this.requestSequence}`;
        const queuedAt = Date.now();
        let queueExpired = false;
        let queueTimer = null;
        let attemptError = null;
        const queueError = new Error('Pi 请求排队超时');
        const attemptCallbacks = {
            ...callbacks,
            onError: (error) => {
                attemptError = error instanceof Error ? error : new Error(String(error));
            }
        };

        this.logLifecycle(`Pi 请求入队 requestId=${requestId}`, {
            requestId,
            sessionKey: key,
            attempt
        });

        const queuedTask = session.queue.then(() => {
            if (queueTimer !== null) {
                clearTimeout(queueTimer);
                queueTimer = null;
            }
            if (queueExpired) throw queueError;
            if (session.closed || this.sessions.get(key) !== session) {
                if (retryState.count >= MAX_AUTOMATIC_RETRIES) {
                    throw createPiError('Pi 进程已退出，无法继续请求', 'PI_PROCESS_ERROR');
                }
                retryState.count += 1;
                return this.enqueueRequest({
                    key,
                    profile,
                    template,
                    prompt,
                    callbacks,
                    options,
                    attempt: retryState.count,
                    retryState
                });
            }
            return this.runRequest(session, session.initialized
                ? formatPiUserPrompt(options.continuationPrompt || prompt)
                : prompt, attemptCallbacks, {
                requestId,
                queuedAt
            });
        });
        session.queue = queuedTask.catch(() => undefined);

        const queueTimeout = new Promise((resolve, reject) => {
            queueTimer = setTimeout(() => {
                queueExpired = true;
                this.logLifecycle(`Pi 请求排队超时 requestId=${requestId}`, {
                    requestId,
                    sessionKey: key,
                    queueTimeoutMs: this.requestQueueTimeoutMs
                });
                reject(queueError);
            }, this.requestQueueTimeoutMs);
        });

        return Promise.race([queuedTask, queueTimeout]).catch((error) => {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            if (retryState.count < MAX_AUTOMATIC_RETRIES && isRetryableError(normalizedError)) {
                retryState.count += 1;
                this.logLifecycle(`Pi 会话重建 requestId=${requestId} attempt=${retryState.count}`, {
                    requestId,
                    sessionKey: key,
                    error: normalizedError.message
                });
                return this.enqueueRequest({
                    key,
                    profile,
                    template,
                    prompt,
                    callbacks,
                    options,
                    attempt: retryState.count,
                    retryState
                });
            }
            callbacks.onError?.((attemptError || normalizedError).message);
            throw normalizedError;
        }).finally(() => {
            if (queueTimer !== null) clearTimeout(queueTimer);
        });
    }

    getSessionKey(profile, template, conversationKey = 'default') {
        const policy = resolvePermissionPolicy(template.permissionProfile);
        const baseKey = buildChatSessionKey({
            profileName: profile.name || 'default',
            templateId: template.id || template.name || 'default',
            mode: 'agent'
        });
        return `${baseKey}:permission:${policy.name}:conversation:${conversationKey}`;
    }

    getOrCreateSession(key, profile, template) {
        const configurationFingerprint = JSON.stringify({
            apiUrl: profile.apiUrl || '',
            model: profile.model || '',
            apiKey: profile.apiKey || '',
            responsesBaseUrl: this.responsesBaseUrl,
            maxTokens: profile.maxTokens || 0,
            temperature: profile.temperature,
            templateContent: template.content || '',
            permissionProfile: template.permissionProfile
        });
        const existing = this.sessions.get(key);
        if (existing && !existing.closed && existing.configurationFingerprint === configurationFingerprint) {
            return existing;
        }
        if (existing && !existing.closed) this.terminateSession(existing);

        const args = this.buildSpawnArgs(profile, template);
        // 会话 ID 绑定到实际 Pi 子进程。进程被重建时必须得到新 ID，避免把新 Pi
        // 的完整上下文误接到旧 Provider 原生会话；同一进程内则始终保持不变。
        const conversationId = `pi_${randomUUID().replaceAll('-', '')}`;
        const env = {
            ...process.env,
            PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || path.join(os.tmpdir(), 'aasc-pi-runtime'),
            AASC_PI_BASE_URL: this.responsesBaseUrl || normalizeOpenAiBaseUrl(profile.apiUrl || ''),
            AASC_PI_MODEL: profile.model || '',
            AASC_PI_API_KEY: profile.apiKey || '',
            AASC_PI_CONVERSATION_ID: conversationId,
        };
        const child = this.spawn(this.commandPath, args, {
            cwd: this.projectRoot,
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        const session = {
            key,
            child,
            buffer: '',
            queue: Promise.resolve(),
            pending: null,
            closed: false,
            initialized: false,
            configurationFingerprint,
            conversationId,
            profile,
            template
        };
        this.attachChildHandlers(session);
        this.sessions.set(key, session);
        return session;
    }

    attachChildHandlers(session) {
        session.child.stdout.on('data', (chunk) => this.handleStdout(session, chunk));
        session.child.stderr.on('data', () => {});
        session.child.on('error', (error) => this.failSession(session, error));
        session.child.on('exit', (code, signal) => {
            if (session.closed) return;
            const error = createPiError(
                `Pi 进程退出: code=${code ?? 'null'}, signal=${signal || 'null'}`,
                'PI_PROCESS_ERROR'
            );
            this.failSession(session, error);
        });
    }

    handleStdout(session, chunk) {
        session.buffer += String(chunk);
        const lines = session.buffer.split('\n');
        session.buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let event;
            try {
                event = JSON.parse(trimmed);
            } catch (error) {
                this.failSession(session, new Error(`Pi RPC JSON 无效: ${error.message}`));
                return;
            }
            this.handleEvent(session, event);
            if (session.closed) return;
        }
    }

    handleEvent(session, event) {
        const pending = session.pending;
        if (!pending) return;
        const eventType = event.type || 'unknown';
        const toolName = extractToolName(event);
        const toolSummary = toolName ? ` tool=${toolName}` : '';
        this.logLifecycle(`Pi RPC 事件 requestId=${pending.requestId} type=${eventType}${toolSummary}`, {
            requestId: pending.requestId,
            eventType,
            ...(toolName ? { toolName } : {})
        });
        if (event.type === 'response' && event.success === false) {
            this.failSession(session, createPiError(event.error || 'Pi RPC 请求失败', 'PI_RPC_ERROR'));
            return;
        }
        if (event.type === 'error') {
            this.failSession(session, createPiError(
                event.error || event.message || 'Pi RPC 执行失败',
                'PI_RPC_ERROR'
            ));
            return;
        }
        if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
            const delta = event.assistantMessageEvent.delta || '';
            pending.message += delta;
            pending.callbacks.onChunk?.(delta, pending.message);
            return;
        }
        if (event.type === 'agent_end') {
            if (event.willRetry === true) {
                this.logLifecycle(`Pi Agent 将重试 requestId=${pending.requestId}`, {
                    requestId: pending.requestId
                });
                return;
            }
            const assistantError = extractAssistantError(event.messages);
            if (assistantError) {
                this.failSession(session, createPiError(assistantError, 'PI_AGENT_ERROR'));
                return;
            }
            if (!pending.message) pending.message = extractAssistantText(event.messages);
            if (!pending.message) {
                this.failSession(session, createPiError('Pi Agent 返回空回复', 'PI_EMPTY_RESPONSE'));
                return;
            }
            this.resolvePending(session, {
                success: true,
                message: pending.message
            });
        }
    }

    runRequest(session, prompt, callbacks, requestInfo) {
        const requestId = requestInfo.requestId;
        if (session.closed) {
            this.logLifecycle(`Pi 请求无法启动 requestId=${requestId} 原因=进程已退出`, { requestId });
            return Promise.reject(new Error('Pi 进程退出，不能继续请求'));
        }
        this.logLifecycle(`Pi 请求开始 requestId=${requestId}`, {
            requestId,
            queueWaitMs: Date.now() - requestInfo.queuedAt
        });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.logLifecycle(`Pi 请求超时 requestId=${requestId}`, { requestId });
                this.rejectPending(session, new Error('Pi RPC 请求超时'));
                this.terminateSession(session);
            }, this.requestTimeoutMs);
            session.pending = {
                requestId,
                callbacks,
                message: '',
                timer,
                resolve,
                reject
            };
            try {
                session.child.stdin.write(`${JSON.stringify({
                    id: requestId,
                    type: 'prompt',
                    message: String(prompt || '')
                })}\n`);
            } catch (error) {
                this.failSession(session, createPiError(error.message, 'PI_PROCESS_ERROR'));
            }
        });
    }

    resolvePending(session, result) {
        const pending = session.pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        session.pending = null;
        session.initialized = true;
        this.logLifecycle(`Pi 请求完成 requestId=${pending.requestId} messageLength=${(result.message || '').length}`, {
            requestId: pending.requestId,
            messageLength: (result.message || '').length
        });
        pending.callbacks.onComplete?.(result.message);
        pending.resolve(result);
    }

    rejectPending(session, error) {
        const pending = session.pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        session.pending = null;
        this.logLifecycle(`Pi 请求失败 requestId=${pending.requestId} error=${error.message}`, {
            requestId: pending.requestId,
            error: error.message
        });
        pending.callbacks.onError?.(error.message);
        pending.reject(error);
    }

    logLifecycle(message, details = {}) {
        try {
            this.logger(message, details);
        } catch (error) {
            // 诊断日志不能影响 Pi RPC 主流程。
        }
    }

    failSession(session, error) {
        this.rejectPending(session, error);
        this.sessions.delete(session.key);
        session.closed = true;
        try {
            session.child.stdin.end();
        } catch (stdinError) {
            // stdin 已经关闭时继续清理子进程即可。
        }
        try {
            session.child.kill();
        } catch (killError) {
            // 子进程已经退出时无需重复处理。
        }
    }

    async stopSession(key) {
        const session = this.sessions.get(key);
        if (!session) return;
        this.terminateSession(session);
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
        const sessions = [...this.sessions.values()];
        for (const session of sessions) this.terminateSession(session);
    }

    terminateSession(session) {
        if (session.closed) return;
        session.closed = true;
        this.rejectPending(session, new Error('Pi Runtime 已停止'));
        this.sessions.delete(session.key);
        try {
            session.child.stdin.end();
        } catch (error) {
            // stdin 已关闭时无需重复处理，随后仍会尝试终止子进程。
        }
        try {
            session.child.kill();
        } catch (error) {
            // 子进程已经退出时 kill 可能失败，不影响 Runtime 清理。
        }
    }

    getSessionCount() {
        return this.sessions.size;
    }
}

function extractAssistantText(messages) {
    const assistant = [...(messages || [])].reverse().find(message => message.role === 'assistant');
    if (!assistant) return '';
    if (typeof assistant.content === 'string') return assistant.content;
    return (assistant.content || [])
        .filter(item => item.type === 'text')
        .map(item => item.text || '')
        .join('');
}

function extractAssistantError(messages) {
    const assistant = [...(messages || [])].reverse().find(message => message.role === 'assistant');
    if (!assistant) return '';
    if (String(assistant.stopReason || '').toLowerCase() === 'error') {
        return assistant.errorMessage || assistant.error || 'Pi Agent 执行失败';
    }
    return assistant.errorMessage || '';
}

function extractToolName(event) {
    return event.toolName
        || event.toolCall?.name
        || event.assistantMessageEvent?.toolCall?.name
        || event.assistantMessageEvent?.partial?.toolCall?.name
        || '';
}

function createPiError(message, code) {
    const error = new Error(String(message || 'Pi Runtime 请求失败'));
    error.code = code;
    return error;
}

function isRetryableError(error) {
    return ['PI_EMPTY_RESPONSE', 'PI_RPC_ERROR', 'PI_AGENT_ERROR', 'PI_PROCESS_ERROR']
        .includes(error?.code);
}

module.exports = {
    PiRuntimeManager
};
