'use strict';

const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
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

function formatPiUserPrompt(prompt) {
    const text = String(prompt || '');
    return text.startsWith('User:') ? text : `User:${text}`;
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
    return ['PI_EMPTY_RESPONSE', 'PI_AGENT_ERROR', 'PI_SDK_ERROR']
        .includes(error?.code);
}

class PiRuntimeManager {
    constructor(options = {}) {
        this.projectRoot = options.projectRoot || process.cwd();
        this.agentDir = options.agentDir || path.join(os.tmpdir(), 'aasc-pi-runtime');
        this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
        this.requestQueueTimeoutMs = options.requestQueueTimeoutMs || DEFAULT_REQUEST_QUEUE_TIMEOUT_MS;
        this.responsesBaseUrl = options.responsesBaseUrl || '';
        this.logger = typeof options.logger === 'function' ? options.logger : () => {};
        this.sdkLoader = options.sdkLoader || (() => import('@earendil-works/pi-coding-agent'));
        this.readonlyToolsLoader = options.readonlyToolsLoader || (() => import(
            pathToFileURL(path.join(__dirname, 'pi-readonly-tools.mjs')).href
        ));
        this.createSdkSession = typeof options.createSdkSession === 'function'
            ? options.createSdkSession
            : null;
        this.sessions = new Map();
        this.sessionCreations = new Map();
        this.requestSequence = 0;
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
            if (options.ephemeral === true) {
                const session = this.sessions.get(key);
                if (session) await this.terminateSession(session);
            }
        }
    }

    async enqueueRequest({ key, profile, template, prompt, callbacks, options, attempt, retryState }) {
        let session;
        try {
            session = await this.getOrCreateSession(key, profile, template);
        } catch (error) {
            callbacks.onError?.(error instanceof Error ? error.message : String(error));
            throw error;
        }

        const requestId = 'aasc-' + (++this.requestSequence);
        const queuedAt = Date.now();
        let queueExpired = false;
        let queueTimer = null;
        let attemptError = null;
        const queueError = createPiError('Pi 请求排队超时', 'PI_QUEUE_TIMEOUT');
        const attemptCallbacks = {
            ...callbacks,
            onError: (error) => {
                attemptError = error instanceof Error ? error : new Error(String(error));
            }
        };

        this.logLifecycle('Pi 请求入队 requestId=' + requestId, {
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
                    throw createPiError('Pi SDK 会话已关闭，无法继续请求', 'PI_SDK_ERROR');
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
                this.logLifecycle('Pi 请求排队超时 requestId=' + requestId, {
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
                this.logLifecycle('Pi 会话重建 requestId=' + requestId + ' attempt=' + retryState.count, {
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
        return baseKey + ':permission:' + policy.name + ':conversation:' + conversationKey;
    }

    async getOrCreateSession(key, profile, template) {
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
        if (existing && !existing.closed) await this.terminateSession(existing);

        const pendingCreation = this.sessionCreations.get(key);
        if (pendingCreation && pendingCreation.configurationFingerprint === configurationFingerprint) {
            return pendingCreation.promise;
        }

        const creationPromise = this.createSdkBackedSession(key, profile, template, configurationFingerprint)
            .then((session) => {
                this.attachSdkHandlers(session);
                this.sessions.set(key, session);
                return session;
            })
            .finally(() => {
                const current = this.sessionCreations.get(key);
                if (current && current.promise === creationPromise) this.sessionCreations.delete(key);
            });
        this.sessionCreations.set(key, { configurationFingerprint, promise: creationPromise });
        return creationPromise;
    }

    async createSdkBackedSession(key, profile, template, configurationFingerprint) {
        const conversationId = 'pi_' + randomUUID().replaceAll('-', '');
        const sdkResult = this.createSdkSession
            ? await this.createSdkSession({ key, profile, template, conversationId })
            : await this.createDefaultSdkSession(profile, template, conversationId);
        const sdkSession = sdkResult && sdkResult.session ? sdkResult.session : sdkResult;
        if (!sdkSession || typeof sdkSession.prompt !== 'function' || typeof sdkSession.subscribe !== 'function') {
            throw createPiError('Pi SDK 未返回有效 AgentSession', 'PI_SDK_ERROR');
        }
        return {
            key,
            sdkSession,
            queue: Promise.resolve(),
            pending: null,
            closed: false,
            initialized: false,
            configurationFingerprint,
            conversationId,
            profile,
            template,
            unsubscribe: null,
            disposePromise: null
        };
    }

    async createDefaultSdkSession(profile, template, conversationId) {
        const sdk = await this.sdkLoader();
        const toolsModule = await this.readonlyToolsLoader();
        const policy = resolvePermissionPolicy(template.permissionProfile);
        const modelId = String(profile.model || '').trim() || 'aasc-model';
        const provider = toolsModule.createAascChat2ApiProvider({
            baseUrl: this.responsesBaseUrl || normalizeOpenAiBaseUrl(profile.apiUrl || ''),
            modelId,
            apiKey: profile.apiKey || '',
            conversationId
        });
        const modelRuntime = await sdk.ModelRuntime.create({ refreshOnCreate: false });
        modelRuntime.registerNativeProvider(provider);
        const model = modelRuntime.getModel('aasc-openai', modelId);
        if (!model) throw createPiError('Pi SDK 找不到配置的模型: ' + modelId, 'PI_SDK_ERROR');

        const settingsManager = sdk.SettingsManager.inMemory();
        const resourceLoader = new sdk.DefaultResourceLoader({
            cwd: this.projectRoot,
            agentDir: this.agentDir,
            settingsManager,
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true
        });
        const result = await sdk.createAgentSession({
            cwd: this.projectRoot,
            model,
            modelRuntime,
            resourceLoader,
            sessionManager: sdk.SessionManager.inMemory(this.projectRoot),
            settingsManager,
            customTools: toolsModule.createAascReadonlyTools(),
            tools: policy.tools
        });
        return result.session;
    }

    attachSdkHandlers(session) {
        try {
            const unsubscribe = session.sdkSession.subscribe((event) => this.handleSdkEvent(session, event));
            session.unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
        } catch (error) {
            throw createPiError('Pi SDK 订阅事件失败: ' + error.message, 'PI_SDK_ERROR');
        }
    }

    handleSdkEvent(session, event) {
        const pending = session.pending;
        if (!pending) return;
        const eventType = event.type || 'unknown';
        const toolName = extractToolName(event);
        const toolSummary = toolName ? ' tool=' + toolName : '';
        this.logLifecycle('Pi SDK 事件 requestId=' + pending.requestId + ' type=' + eventType + toolSummary, {
            requestId: pending.requestId,
            eventType,
            ...(toolName ? { toolName } : {})
        });
        if (event.type === 'error') {
            this.failSession(session, createPiError(
                event.error?.message || event.error || event.message || 'Pi SDK 执行失败',
                'PI_SDK_ERROR'
            ));
            return;
        }
        if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
            const delta = event.assistantMessageEvent.delta || '';
            pending.message += delta;
            pending.callbacks.onChunk?.(delta, pending.message);
            return;
        }
        if (event.type !== 'agent_end') return;
        if (event.willRetry === true) {
            this.logLifecycle('Pi Agent 将重试 requestId=' + pending.requestId, {
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

    runRequest(session, prompt, callbacks, requestInfo) {
        const requestId = requestInfo.requestId;
        if (session.closed) {
            this.logLifecycle('Pi 请求无法启动 requestId=' + requestId + ' 原因=SDK 会话已关闭', { requestId });
            return Promise.reject(createPiError('Pi SDK 会话已关闭，不能继续请求', 'PI_SDK_ERROR'));
        }
        this.logLifecycle('Pi 请求开始 requestId=' + requestId, {
            requestId,
            queueWaitMs: Date.now() - requestInfo.queuedAt
        });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.logLifecycle('Pi SDK 请求超时 requestId=' + requestId, { requestId });
                const timeoutError = createPiError('Pi SDK 请求超时', 'PI_SDK_TIMEOUT');
                this.rejectPending(session, timeoutError);
                void this.terminateSession(session);
            }, this.requestTimeoutMs);
            const pending = {
                requestId,
                callbacks,
                message: '',
                timer,
                resolve,
                reject
            };
            session.pending = pending;
            Promise.resolve()
                .then(() => session.sdkSession.prompt(String(prompt || ''), {
                    expandPromptTemplates: false
                }))
                .catch((error) => {
                    if (session.pending !== pending) return;
                    this.failSession(session, createPiError(error.message, 'PI_SDK_ERROR'));
                });
        });
    }

    resolvePending(session, result) {
        const pending = session.pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        session.pending = null;
        session.initialized = true;
        this.logLifecycle('Pi 请求完成 requestId=' + pending.requestId + ' messageLength=' + (result.message || '').length, {
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
        this.logLifecycle('Pi 请求失败 requestId=' + pending.requestId + ' error=' + error.message, {
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
            // 诊断日志不能影响 Pi SDK 主流程。
        }
    }

    failSession(session, error) {
        if (session.closed) return;
        session.closed = true;
        this.sessions.delete(session.key);
        this.rejectPending(session, error);
        void this.disposeSdkSession(session, true);
    }

    async stopSession(key) {
        const session = this.sessions.get(key);
        if (!session) return;
        await this.terminateSession(session);
    }

    resetSession(profile, template, conversationKey = 'default') {
        const normalizedProfile = normalizeAgentProfile(profile);
        const normalizedTemplate = normalizeChatTemplate(template);
        const key = this.getSessionKey(normalizedProfile, normalizedTemplate, conversationKey);
        const session = this.sessions.get(key);
        if (!session) return false;
        void this.terminateSession(session);
        return true;
    }

    async stopAll() {
        const sessions = [...this.sessions.values()];
        await Promise.all(sessions.map((session) => this.terminateSession(session)));
    }

    async terminateSession(session) {
        if (!session) return;
        if (session.disposePromise) return session.disposePromise;
        session.closed = true;
        this.sessions.delete(session.key);
        this.rejectPending(session, createPiError('Pi Runtime 已停止', 'PI_RUNTIME_STOPPED'));
        session.disposePromise = this.disposeSdkSession(session, true);
        return session.disposePromise;
    }

    async disposeSdkSession(session, shouldAbort) {
        try {
            if (session.unsubscribe) session.unsubscribe();
        } catch (error) {
            this.logLifecycle('Pi SDK 取消事件订阅失败', { error: error.message });
        }
        if (shouldAbort && typeof session.sdkSession.abort === 'function') {
            try {
                await session.sdkSession.abort();
            } catch (error) {
                this.logLifecycle('Pi SDK abort 失败', { error: error.message });
            }
        }
        try {
            session.sdkSession.dispose();
        } catch (error) {
            this.logLifecycle('Pi SDK dispose 失败', { error: error.message });
        }
    }

    getSessionCount() {
        return this.sessions.size;
    }
}

module.exports = {
    PiRuntimeManager
};
