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

    _writeRole(role) {
        fs.writeFileSync(this._roleFile(role.name), JSON.stringify(role, null, 2));
    }

    // 校验角色名：拒绝空名、含路径分隔符（/ 或 \）的名字、以及 . / .. 等穿越名。
    // 角色名来自前端用户输入，必须防御目录逃逸——尤其 remove 会递归删除，
    // 若放行 '..' 会直接删掉 baseDir 的父目录。所有触碰路径的入口都要调用。
    _assertSafeName(name) {
        if (typeof name !== 'string' || !name.trim()) throw new Error('角色名不合法');
        const clean = name.trim();
        if (clean.includes('/') || clean.includes('\\')) throw new Error('角色名不合法');
        // 匹配 . / .. / ... 等纯点号名字，防止 path.join(baseDir, '..') 逃逸到父目录
        if (/^\.+$/.test(clean)) throw new Error('角色名不合法');
    }

    // 读取角色文件：只吞 ENOENT（文件不存在返回 null）；
    // 其余错误（如 JSON.parse 失败、文件损坏）不吞，改名保留原文件后再返回 null，
    // 避免损坏文件被下一次写入整体覆盖、可恢复数据永久丢失。
    _readRole(name) {
        const file = this._roleFile(name);
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (err) {
            if (err.code !== 'ENOENT') this._preserveCorrupt(file);
            return null;
        }
    }

    // 文件存在但读/解析失败（损坏）：改名成 <basename>.corrupt-<时间戳> 保留备份。
    // 加时间戳避免重复损坏时互相覆盖。改名失败不阻断主流程。
    _preserveCorrupt(file) {
        try {
            fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
        } catch (_) { /* 保留失败则维持现状 */ }
    }

    list() {
        try {
            const roles = [];
            for (const entry of fs.readdirSync(this.baseDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                try {
                    this._assertSafeName(entry.name);
                    const role = this._readRole(entry.name);
                    if (!role || role.name !== entry.name) {
                        console.warn(`[ai-roles] 跳过无效角色目录「${entry.name}」`);
                        continue;
                    }
                    roles.push(role);
                } catch (err) {
                    console.warn(`[ai-roles] 跳过无效角色目录「${entry.name}」: ${err.message}`);
                }
            }
            return roles;
        } catch (_) { return []; }
    }

    exists(name) {
        this._assertSafeName(name);
        return !!this._readRole(name);
    }

    getBackend(name) {
        this._assertSafeName(name);
        const role = this._readRole(name);
        return role && (role.backend === 'codex' || role.backend === 'claude') ? role.backend : null;
    }

    setBackend(name, backend) {
        this._assertSafeName(name);
        if (backend !== 'codex' && backend !== 'claude') throw new Error('Agent 后端不合法');
        const role = this._readRole(name);
        if (!role || role.name !== name) throw new Error('角色不存在');
        const updated = { ...role, backend };
        this._writeRole(updated);
        return { name, backend };
    }

    add(name, createdAt = Date.now()) {
        if (!name || typeof name !== 'string' || !name.trim()) throw new Error('角色名不能为空');
        const clean = name.trim();
        this._assertSafeName(clean);
        if (this.exists(clean)) throw new Error(`角色「${clean}」已存在`);
        fs.mkdirSync(this.roleDir(clean), { recursive: true });
        fs.writeFileSync(this._roleFile(clean), JSON.stringify({ name: clean, createdAt }, null, 2));
        return { name: clean, createdAt };
    }

    remove(name) {
        this._assertSafeName(name);
        fs.rmSync(this.roleDir(name), { recursive: true, force: true });
    }

    loadHistory(name) {
        this._assertSafeName(name);
        const file = this._historyFile(name);
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!Array.isArray(parsed)) throw new Error('history 必须是数组');
            return parsed;
        } catch (err) {
            if (err.code !== 'ENOENT') this._preserveCorrupt(file);
            return [];
        }
    }

    appendHistory(name, msg) {
        this._assertSafeName(name);
        const history = this.loadHistory(name);
        history.push({ ...msg, timestamp: msg.timestamp || Date.now() });
        fs.mkdirSync(this.roleDir(name), { recursive: true });
        fs.writeFileSync(this._historyFile(name), JSON.stringify(history, null, 2));
        return history;
    }
}
module.exports = RoleStore;
