'use strict';
const fs = require('node:fs');
const path = require('node:path');
const RoleStore = require('./role-store');
const ClaudeBridge = require('./claude-bridge');
const { USER_CONFIG_DIR } = require('../config/user-config-paths');

const DEFAULT_BASE = path.join(USER_CONFIG_DIR, 'ai-roles');
const KEEPER_PATH = path.join(__dirname, 'pipe-keeper.js');

// 默认提示词（workgroup/roles/<名>.md 不存在时）
const defaultPrompt = (name) => `你是 ${name}，一个专注${name}相关工作的助手。请用简洁的中文回答。`;

// 聚合：角色持久化 + 每角色 claude 进程桥 + 提示词来源 + 消息路由
class AiRolesService {
    constructor({ baseDir = DEFAULT_BASE, projectRoot, command = 'claude', commandPath = null, commandArgs = [], keeperPath = KEEPER_PATH } = {}) {
        this.store = new RoleStore(baseDir);
        this.projectRoot = projectRoot;
        this.command = command;
        this.commandPath = commandPath || command;
        this.commandArgs = [...commandArgs];
        this.keeperPath = keeperPath;
        this.bridges = new Map(); // name -> ClaudeBridge
        this.queues = new Map();
        this.removed = new Set();
    }

    _assertExists(name) {
        if (!this.store.list().some((role) => role.name === name)) throw new Error('角色不存在');
    }

    _bridge(name) {
        let b = this.bridges.get(name);
        if (!b) {
            b = new ClaudeBridge({
                dir: this.store.roleDir(name),
                name,
                command: this.command,
                commandPath: this.commandPath,
                commandArgs: this.commandArgs,
                cwd: this.projectRoot,
                keeperPath: this.keeperPath
            });
            this.bridges.set(name, b);
        }
        return b;
    }

    // 提示词来源：复用 workgroup/roles/<名>.md；不存在用默认
    _promptFor(name) {
        const roleFile = path.join(this.projectRoot, 'workgroup', 'roles', `${name}.md`);
        try {
            const content = fs.readFileSync(roleFile, 'utf8').trim();
            if (content) return content;
        } catch (_) {}
        return defaultPrompt(name);
    }

    // 把提示词落盘为 prompt.txt（懒启动注入用），幂等
    _ensurePromptFile(name) {
        const file = path.join(this.store.roleDir(name), 'prompt.txt');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, this._promptFor(name));
        return file;
    }

    list() {
        return this.store.list().map((r) => ({ ...r, running: this._bridge(r.name).isAlive() }));
    }

    add(name) {
        const role = this.store.add(name);
        this.removed.delete(role.name);
        // 建角色即落盘提示词：让 prompt.txt 在 add 后立即可用（懒启动注入的 promptFile 已就位），
        // 且角色提示词来源 workgroup/roles/<名>.md 的变更在新建时即时生效
        this._ensurePromptFile(name);
        return { ...role, running: false };
    }

    remove(name) {
        this._assertExists(name);
        this.removed.add(name);
        const b = this.bridges.get(name);
        if (b) { b.stop(); this.bridges.delete(name); }
        this.store.remove(name);
    }

    history(name) {
        this._assertExists(name);
        return this.store.loadHistory(name);
    }

    // 发消息给角色：懒启动 → 流式 → 完成写历史。
    // 历史条目与 llm-service 同构（{role, name, content, mode, target}），前端 renderHistory 直接可用。
    async chat(name, content, callbacks = {}) {
        this._assertExists(name);
        const previous = this.queues.get(name) || Promise.resolve();
        const run = previous.catch(() => {}).then(async () => {
            if (this.removed.has(name)) throw new Error('角色不存在');
            const bridge = this._bridge(name);
            bridge.promptFile = this._ensurePromptFile(name);
            this.store.appendHistory(name, { role: 'control', name: '用户', content, mode: 'role', target: name });
            return bridge.chat(content, {
                onChunk: (chunk, message) => callbacks.onChunk && callbacks.onChunk(chunk, message, callbacks.requestId),
                onComplete: (message) => {
                    if (this.removed.has(name) || !this.store.list().some((role) => role.name === name)) return;
                    this.store.appendHistory(name, { role: 'assistant', name, content: message, mode: 'role', target: name });
                    if (callbacks.onComplete) callbacks.onComplete(message, this.store.loadHistory(name), callbacks.requestId);
                },
                onError: callbacks.onError
            });
        });
        this.queues.set(name, run);
        try { return await run; } finally {
            if (this.queues.get(name) === run) this.queues.delete(name);
        }
    }

    // 服务器启动：遍历角色，claude 存活则重连 FIFO（进程不中断），已死则清残留待重建
    restoreAll() {
        for (const role of this.store.list()) {
            const b = this._bridge(role.name);
            b.promptFile = this._ensurePromptFile(role.name);
            if (!b.reconnect()) {
                console.warn(`[ai-roles] 角色「${role.name}」claude 进程已停止，下次发消息重建`);
            }
        }
    }
}
module.exports = AiRolesService;
