'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const executeFile = promisify(execFile);

/** 配置只接受可执行文件与独立参数；路径含空格时也不经过shell解释。 */
function platformOptions(config, platform = process.platform, inherited = process.env) {
    const key = { linux: 'linux', win32: 'windows' }[platform];
    if (!key) throw new Error('mpv媒体播放仅支持Linux和Windows');
    const settings = config[key] || {};
    const command = settings.command || (key === 'windows' ? 'mpv.exe' : 'mpv');
    const args = settings.args || [];
    if (typeof command !== 'string' || !command.trim() || command.includes('\0') ||
        !Array.isArray(args) || !args.every(value => typeof value === 'string' && !value.includes('\0'))) {
        throw new Error('mpv命令必须为可执行文件路径，args必须为字符串数组');
    }
    const env = { ...inherited };
    if (key === 'linux') {
        if (settings.display) {
            env.DISPLAY = String(settings.display);
            // 显式指定X11会话时避免继承的Wayland会话抢占输出目标。
            delete env.WAYLAND_DISPLAY;
        }
        if (settings.xauthority) env.XAUTHORITY = String(settings.xauthority);
    }
    return { command, args, env, platform, settings };
}

/** 先验证显式/继承认证，再按参考脚本查找可访问目标DISPLAY的普通认证文件。 */
async function resolveXauthority(options, run = executeFile) {
    if (options.platform !== 'linux' || !options.env.DISPLAY) return options.env;
    const env = { ...options.env };
    const probe = async candidate => {
        try {
            await run('xdpyinfo', [], { env: candidate ? { ...env, XAUTHORITY: candidate } : env, timeout: 1500, maxBuffer: 256 * 1024 });
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') throw new Error('指定X11显示需要安装xdpyinfo以验证DISPLAY/XAUTHORITY');
            return false;
        }
    };
    if (await probe(env.XAUTHORITY)) return env;
    if (options.settings.xauthority) throw new Error(`指定认证无法访问DISPLAY=${env.DISPLAY}`);
    const candidates = [];
    for (const directory of [os.tmpdir(), env.HOME].filter(Boolean)) {
        try {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && (entry.name === '.Xauthority' || entry.name.startsWith('xauth_'))) {
                    candidates.push(path.join(directory, entry.name));
                }
            }
        } catch { /* 无权限目录不影响继续查找其他候选。 */ }
    }
    for (const candidate of new Set(candidates)) {
        if (await probe(candidate)) return { ...env, XAUTHORITY: candidate };
    }
    throw new Error(`找不到可访问DISPLAY=${env.DISPLAY}的XAUTHORITY文件`);
}

function ipcAddress(platform, directory) {
    return platform === 'win32'
        ? `\\\\.\\pipe\\aasc-mpv-${process.pid}-${crypto.randomUUID()}`
        : path.join(directory, 'mpv.sock');
}

module.exports = { platformOptions, resolveXauthority, ipcAddress, executeFile };
