'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 角色与对话历史持久化：每个角色一个子目录（role.json + history.json）。
// 运行时状态（含历史）落盘，服务器重启后角色与对话都保留。
class RoleStore {
    constructor(baseDir) {
        this.baseDir = baseDir; // ai-roles 根目录
    }

    roleDir(name) { return path.join(this.baseDir, name); }
    _roleFile(name) { return path.join(this.roleDir(name), 'role.json'); }
    _historyFile(name) { return path.join(this.roleDir(name), 'history.json'); }

    _readRole(name) {
        try { return JSON.parse(fs.readFileSync(this._roleFile(name), 'utf8')); } catch (_) { return null; }
    }

    // 列出所有角色（跳过残留的非法目录）
    list() {
        try {
            return fs.readdirSync(this.baseDir, { withFileTypes: true })
                .filter((d) => d.isDirectory() && this._readRole(d.name))
                .map((d) => this._readRole(d.name));
        } catch (_) { return []; }
    }

    exists(name) { return !!this._readRole(name); }

    add(name, createdAt = Date.now()) {
        if (!name || typeof name !== 'string' || !name.trim()) throw new Error('角色名不能为空');
        const clean = name.trim();
        if (this.exists(clean)) throw new Error(`角色「${clean}」已存在`);
        fs.mkdirSync(this.roleDir(clean), { recursive: true });
        fs.writeFileSync(this._roleFile(clean), JSON.stringify({ name: clean, createdAt }, null, 2));
        return { name: clean, createdAt };
    }

    remove(name) {
        fs.rmSync(this.roleDir(name), { recursive: true, force: true });
    }

    loadHistory(name) {
        try { return JSON.parse(fs.readFileSync(this._historyFile(name), 'utf8')) || []; } catch (_) { return []; }
    }

    appendHistory(name, msg) {
        const history = this.loadHistory(name);
        history.push({ ...msg, timestamp: msg.timestamp || Date.now() });
        fs.mkdirSync(this.roleDir(name), { recursive: true });
        fs.writeFileSync(this._historyFile(name), JSON.stringify(history, null, 2));
        return history;
    }
}
module.exports = RoleStore;
