'use strict';

const os = require('node:os');
const path = require('node:path');
const { spawn: defaultSpawn } = require('node:child_process');
const {
    normalizeAgentProfile,
    normalizeChatTemplate,
    resolvePermissionPolicy,
    normalizeOpenAiBaseUrl,
    buildChatSessionKey
} = require('./pi-runtime-policy');

const DEFAULT_REQUEST_TIMEOUT_MS = 600000;
const DEFAULT_EXTENSION_PATH = path.join(__dirname, 'pi-readonly-tools.mjs');

class PiRuntimeManager {
    constructor(options = {}) {
        this.projectRoot = options.projectRoot || process.cwd();
        this.extensionPath = options.extensionPath || DEFAULT_EXTENSION_PATH;
        this.spawn = options.spawn || defaultSpawn;
        this.commandPath = options.commandPath || process.env.PI_COMMAND_PATH || 'pi';
        this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
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

    async chatStream(profile, template, prompt, callbacks = {}) {
        const normalizedProfile = normalizeAgentProfile(profile);
        if (normalizedProfile.mode !== 'agent' || normalizedProfile.backend !== 'pi') {
            throw new Error('Pi Runtime 只接受 agent/pi profile');
        }
        const normalizedTemplate = normalizeChatTemplate(template);
        const key = this.getSessionKey(normalizedProfile, normalizedTemplate);
        const session = this.getOrCreateSession(key, normalizedProfile, normalizedTemplate);
        const task = session.queue.then(() => this.runRequest(session, prompt, callbacks));
        session.queue = task.catch(() => undefined);
        return task;
    }

    getSessionKey(profile, template) {
        const policy = resolvePermissionPolicy(template.permissionProfile);
        const baseKey = buildChatSessionKey({
            profileName: profile.name || 'default',
            templateId: template.id || template.name || 'default',
            mode: 'agent'
        });
        return `${baseKey}:permission:${policy.name}`;
    }

    getOrCreateSession(key, profile, template) {
        const configurationFingerprint = JSON.stringify({
            apiUrl: profile.apiUrl || '',
            model: profile.model || '',
            apiKey: profile.apiKey || '',
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
        const env = {
            ...process.env,
            PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || path.join(os.tmpdir(), 'aasc-pi-runtime'),
            AASC_PI_BASE_URL: normalizeOpenAiBaseUrl(profile.apiUrl || ''),
            AASC_PI_MODEL: profile.model || '',
            AASC_PI_API_KEY: profile.apiKey || ''
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
            configurationFingerprint,
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
            const error = new Error(`Pi 进程退出: code=${code ?? 'null'}, signal=${signal || 'null'}`);
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
        if (event.type === 'response' && event.success === false) {
            this.rejectPending(session, new Error(event.error || 'Pi RPC 请求失败'));
            return;
        }
        if (event.type === 'error') {
            this.rejectPending(session, new Error(event.error || event.message || 'Pi RPC 执行失败'));
            return;
        }
        if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
            const delta = event.assistantMessageEvent.delta || '';
            pending.message += delta;
            pending.callbacks.onChunk?.(delta, pending.message);
            return;
        }
        if (event.type === 'agent_end') {
            if (!pending.message) pending.message = extractAssistantText(event.messages);
            this.resolvePending(session, {
                success: true,
                message: pending.message
            });
        }
    }

    runRequest(session, prompt, callbacks) {
        if (session.closed) {
            return Promise.reject(new Error('Pi 进程退出，不能继续请求'));
        }
        return new Promise((resolve, reject) => {
            const requestId = `aasc-${++this.requestSequence}`;
            const timer = setTimeout(() => {
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
                this.rejectPending(session, error);
            }
        });
    }

    resolvePending(session, result) {
        const pending = session.pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        session.pending = null;
        pending.callbacks.onComplete?.(result.message);
        pending.resolve(result);
    }

    rejectPending(session, error) {
        const pending = session.pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        session.pending = null;
        pending.callbacks.onError?.(error.message);
        pending.reject(error);
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

module.exports = {
    PiRuntimeManager
};
