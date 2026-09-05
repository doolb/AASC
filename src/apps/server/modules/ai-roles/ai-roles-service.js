'use strict';
const fs = require('node:fs');
const path = require('node:path');
const RoleStore = require('./role-store');
const WorkgroupMemberCatalog = require('./workgroup-member-catalog');
const ClaudeBridge = require('./claude-bridge');
const CodexBridge = require('./codex-bridge');
const { USER_CONFIG_DIR } = require('../config/user-config-paths');

const DEFAULT_BASE = path.join(USER_CONFIG_DIR, 'ai-roles');
const KEEPER_PATH = path.join(__dirname, 'pipe-keeper.js');

// 默认提示词（workgroup/roles/<名>.md 不存在时）
const defaultPrompt = (name) => `你是 ${name}，一个专注${name}相关工作的助手。请用简洁的中文回答。`;

const ROLE_HISTORY_TEMPLATE = '# 专长画像\n{}\n\n## 经验约定\n\n## 最近记录\n';

const ROLE_SELF_MANAGEMENT_PROMPT = `
【当前角色自管理规则】
你是控制端当前选中的工作 AI 角色，使用本角色处理用户任务，不进入 workgroup 任务队列。
你可以直接维护自己的角色定义文件和任务历史文件：
1. 稳定的职责、能力、工作范围和边界变化写入角色定义文件。
2. 重要任务的经验约定和最近记录写入任务历史文件。
3. 普通聊天或一次性信息不强制写入任务历史文件。
4. 只能修改当前角色自己的两个文件，不能修改其他角色、项目 CLAUDE.md、服务器控制规则或安全规则。
5. 需要重启或重载服务器时，只能使用控制端接口，不能直接操作服务器进程。
角色文件变更会在下一次 Claude 进程启动时作为系统提示词重新加载。`;

// 聚合：角色持久化 + 每角色后端 bridge + 提示词来源 + 消息路由
class AiRolesService {
    constructor({ baseDir = DEFAULT_BASE, projectRoot, command = 'claude', commandPath = null, commandArgs = [], keeperPath = KEEPER_PATH, getAgentBackend = () => 'codex', getCodexProxy = () => undefined, bridgeFactory = null, agentBackendClient = null } = {}) {
        this.store = new RoleStore(baseDir);
        this.projectRoot = projectRoot;
        this.command = command;
        this.commandPath = commandPath || command;
        this.commandArgs = [...commandArgs];
        this.keeperPath = keeperPath;
        this.getAgentBackend = getAgentBackend;
        this.getCodexProxy = getCodexProxy;
        this.bridgeFactory = bridgeFactory;
        this.agentBackendClient = agentBackendClient;
        this.bridges = new Map(); // name -> AgentBackendClientBridge 或测试注入的 bridge
        this.queues = new Map();
        this.removed = new Set();
        this.stopGeneration = 0;
    }

    _assertExists(name) {
        if (!this.store.list().some((role) => role.name === name)) throw new Error('角色不存在');
    }

    _pidAlive(file) {
        try {
            const pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
            if (!Number.isInteger(pid) || pid <= 0) return false;
            process.kill(pid, 0);
            return true;
        } catch (_) { return false; }
    }

    _storedBackendIsRunning(name, backend) {
        const dir = this.store.roleDir(name);
        if (backend === 'claude') return this._pidAlive(path.join(dir, 'claude.pid'));
        if (backend === 'codex') return this._pidAlive(path.join(dir, 'codex.pid'));
        return false;
    }

    _createBridge(name, backend) {
        const options = {
            dir: this.store.roleDir(name),
            name,
            backend,
            command: this.command,
            commandPath: this.commandPath,
            commandArgs: this.commandArgs,
            cwd: this.projectRoot,
            keeperPath: this.keeperPath,
            proxy: backend === 'codex' ? this.getCodexProxy() : undefined
        };
        if (this.bridgeFactory) return this.bridgeFactory(options);
        if (this.agentBackendClient) return this.agentBackendClient.createBridge(options);
        if (backend === 'codex') {
            return new CodexBridge({
                dir: options.dir,
                name,
                commandPath: 'codex',
                cwd: this.projectRoot,
                proxy: options.proxy
            });
        }
        return new ClaudeBridge(options);
    }

    _bridge(name) {
        const current = this.bridges.get(name);
        if (current && current.isAlive()) return current;
        if (current) {
            try {
                const stopping = current.stop();
                if (stopping && typeof stopping.catch === 'function') stopping.catch(() => {});
            } catch (_) { /* 旧 bridge 已失效时，清理引用优先于阻断新 bridge 创建 */ }
            this.bridges.delete(name);
        }

        let storedBackend = this.store.getBackend(name);
        // 兼容旧角色：早期 role.json 没有 backend 字段，但存活的 claude.pid 仍应继续使用 Claude。
        if (!storedBackend && this._storedBackendIsRunning(name, 'claude')) storedBackend = 'claude';
        // 独立后端宿主中的 bridge 不在当前服务器内存中，必须先按 role.json.backend 查询宿主，
        // 防止全局设置改变后把仍存活的旧 Agent 误判为离线并启动第二个后端。
        const backend = this.agentBackendClient && storedBackend
            ? storedBackend
            : (storedBackend === 'claude' && this._storedBackendIsRunning(name, 'claude')
                ? 'claude'
                : this.getAgentBackend());
        if (backend !== 'codex' && backend !== 'claude') throw new Error('Agent 后端不合法');
        const bridge = this._createBridge(name, backend);
        this.store.setBackend(name, backend);
        this.bridges.set(name, bridge);
        return bridge;
    }

    _roleFile(name) {
        return path.join(this.projectRoot, 'workgroup', 'roles', `${name}.md`);
    }

    _historyFile(name) {
        return path.join(this.projectRoot, 'workgroup', 'members', `control-${name}`, 'history.md');
    }

    _resolveRoleFile(name) {
        const roleFile = this._roleFile(name);
        if (fs.existsSync(roleFile)) return roleFile;
        const memberRoleFile = path.join(this.projectRoot, 'workgroup', 'members', name, 'role.md');
        return fs.existsSync(memberRoleFile) ? memberRoleFile : roleFile;
    }

    _resolveHistoryFile(name) {
        const historyFile = this._historyFile(name);
        if (fs.existsSync(historyFile)) return historyFile;
        const memberHistoryFile = path.join(this.projectRoot, 'workgroup', 'members', name, 'history.md');
        return fs.existsSync(memberHistoryFile) ? memberHistoryFile : historyFile;
    }

    _readOptional(file) {
        try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { return ''; }
    }

    // 提示词来源：当前角色定义 + 当前角色 history.md + 自管理规则；只在进程启动快照时读取
    _promptFor(name) {
        const roleFile = this._resolveRoleFile(name);
        const historyFile = this._resolveHistoryFile(name);
        const roleContent = this._readOptional(roleFile) || defaultPrompt(name);
        const historyContent = this._readOptional(historyFile) || '（暂无任务历史，重要任务完成后按规则维护此文件）';
        return [
            `【当前角色】${name}`,
            `【角色定义文件】${roleFile}`,
            roleContent,
            `【任务历史文件】${historyFile}`,
            historyContent,
            ROLE_SELF_MANAGEMENT_PROMPT
        ].join('\n\n');
    }

    // 把提示词落盘为 prompt.txt（Claude 启动时通过 --append-system-prompt-file 注入）
    _ensurePromptFile(name) {
        const file = path.join(this.store.roleDir(name), 'prompt.txt');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const historyFile = this._resolveHistoryFile(name);
        fs.mkdirSync(path.dirname(historyFile), { recursive: true });
        if (!fs.existsSync(historyFile)) fs.writeFileSync(historyFile, ROLE_HISTORY_TEMPLATE);
        fs.writeFileSync(file, this._promptFor(name));
        return file;
    }

    list() {
        return this.store.list().map((r) => {
            const bridge = this.bridges.get(r.name);
            const running = bridge ? bridge.isAlive() : this._storedBackendIsRunning(r.name, r.backend);
            return { ...r, running };
        });
    }

    memberCatalog() {
        return new WorkgroupMemberCatalog(this.projectRoot).list();
    }

    add(name) {
        const role = this.store.add(name);
        this.removed.delete(role.name);
        // 建角色即落盘提示词：让 prompt.txt 在 add 后立即可用（懒启动注入的 promptFile 已就位），
        // 且角色提示词来源 workgroup/roles/<名>.md 的变更在新建时即时生效
        this._ensurePromptFile(name);
        return { ...role, running: false };
    }

    async remove(name) {
        this._assertExists(name);
        this.removed.add(name);
        const b = this.bridges.get(name);
        if (b) {
            await b.stop();
            this.bridges.delete(name);
        }
        this.store.remove(name);
    }

    // 只停止当前 Agent 进程并清空运行时 bridge；角色数据、聊天历史和角色定义全部保留。
    // generation 用来阻止 stopAll 调用前已经排队、但尚未启动的消息在停止后重新拉起 Agent。
    async stopAll() {
        this.stopGeneration += 1;
        let stopped = 0;
        for (const bridge of this.bridges.values()) {
            if (bridge.isAlive()) stopped += 1;
            try { await bridge.stop(); } catch (error) {
                console.warn(`[ai-roles] 停止 Agent 失败: ${error.message}`);
            }
        }
        this.bridges.clear();
        this.queues.clear();
        return stopped;
    }

    history(name) {
        this._assertExists(name);
        return this.store.loadHistory(name);
    }

    // 发消息给角色：懒启动 → 流式 → 完成写历史。
    // 历史条目与 llm-service 同构（{role, name, content, mode, target}），前端 renderHistory 直接可用。
    async chat(name, content, callbacks = {}) {
        this._assertExists(name);
        const generation = this.stopGeneration;
        const previous = this.queues.get(name) || Promise.resolve();
        const run = previous.catch(() => {}).then(async () => {
            if (this.removed.has(name)) throw new Error('角色不存在');
            if (generation !== this.stopGeneration) throw new Error('Agent 已被全部关闭，请重新发送消息');
            const bridge = this._bridge(name);
            // 一个 Claude 进程只加载一次 role.md/history.md；后续消息复用同一系统提示词快照。
            if (!bridge.promptFile) {
                bridge.promptFile = this._ensurePromptFile(name);
                if (typeof bridge.setPrompt === 'function') {
                    bridge.setPrompt(fs.readFileSync(bridge.promptFile, 'utf8'));
                }
            }
            // 先确认 Agent 已完成启动，再通知控制端刷新在线状态；不能等整轮回复完成后才广播。
            try {
                if (typeof bridge.ensureStarted === 'function') await bridge.ensureStarted();
                if (callbacks.onStatus) {
                    callbacks.onStatus({
                        name,
                        running: bridge.isAlive(),
                        backend: bridge.backend || this.store.getBackend(name) || this.getAgentBackend()
                    });
                }
            } catch (error) {
                if (callbacks.onStatus) {
                    callbacks.onStatus({
                        name,
                        running: false,
                        backend: bridge.backend || this.store.getBackend(name) || this.getAgentBackend()
                    });
                }
                if (callbacks.onError) callbacks.onError(error);
                return { success: false, error: error.message };
            }
            this.store.appendHistory(name, { role: 'control', name: '用户', content, mode: 'role', target: name });
            return bridge.chat(content, {
                onChunk: (chunk, message) => callbacks.onChunk && callbacks.onChunk(chunk, message, callbacks.requestId),
                onComplete: (message) => {
                    if (this.removed.has(name) || !this.store.list().some((role) => role.name === name)) return;
                    this.store.appendHistory(name, { role: 'assistant', name, content: message, mode: 'role', target: name });
                    if (callbacks.onComplete) callbacks.onComplete(message, this.store.loadHistory(name), callbacks.requestId);
                },
                onError: (error) => {
                    if (!bridge.isAlive() && callbacks.onStatus) {
                        callbacks.onStatus({
                            name,
                            running: false,
                            backend: bridge.backend || this.store.getBackend(name) || this.getAgentBackend()
                        });
                    }
                    if (callbacks.onError) callbacks.onError(error);
                }
            });
        });
        this.queues.set(name, run);
        try { return await run; } finally {
            if (this.queues.get(name) === run) this.queues.delete(name);
        }
    }

    // 服务器启动：通过独立后端查询已存活 Agent；IPC 客户端重建不会停止宿主内 bridge。
    async restoreAll() {
        const restores = this.store.list().map(async (role) => {
            try {
                const b = this._bridge(role.name);
                b.promptFile = this._ensurePromptFile(role.name);
                if (typeof b.setPrompt === 'function') b.setPrompt(fs.readFileSync(b.promptFile, 'utf8'));
                const running = typeof b.reconnect === 'function' ? await b.reconnect() : b.isAlive();
                if (!running) {
                    if (this.agentBackendClient) {
                        const latestBackend = this.getAgentBackend();
                        if (latestBackend === 'codex' || latestBackend === 'claude') {
                            this.store.setBackend(role.name, latestBackend);
                        }
                    }
                    console.warn(`[ai-roles] 角色「${role.name}」Agent 进程未连接，下次发消息重建`);
                }
            } catch (error) {
                console.warn(`[ai-roles] 恢复角色「${role.name}」失败: ${error.message}`);
            }
        });
        await Promise.all(restores);
        return this.list();
    }
}
module.exports = AiRolesService;
