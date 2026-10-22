'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

/** ALSA的PCM名称作为独立参数传入；配置错误必须明确报出，不能静默改投其他设备。 */
function normalizeDevice(value = 'auto') {
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new Error('audioPlayer.linux.device必须为1～256字符的ALSA设备名称或auto，不能包含控制字符');
    }
    return value.trim();
}

/** 只探测当前用户可达的共享音频服务，不读取其他用户认证或修改系统ALSA配置。 */
class LinuxAudioOutput {
    constructor(options = {}, { run = runFile, log = message => console.log(message), timeoutMs = 2000 } = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('audioPlayer.linux必须为配置对象');
        this.device = normalizeDevice(options.device);
        this.run = run;
        this.log = log;
        this.timeoutMs = Math.max(1, Math.min(2000, Number(timeoutMs) || 2000));
        this.selection = null;
    }

    async probe(command, args) {
        try {
            const result = await this.run(command, args, { timeout: this.timeoutMs, killSignal: 'SIGKILL',
                maxBuffer: 256 * 1024, windowsHide: true, shell: false });
            return { available: true, stdout: String(result.stdout || '') };
        } catch { return { available: false, stdout: '' }; }
    }

    resolve() {
        // 所有同时到达的句子等待同一份结果，停止旧句不会打断后续队列需要的探测。
        if (!this.selection) this.selection = this.select();
        return this.selection;
    }

    async select() {
        if (this.device !== 'auto') {
            this.log(`[音频] Linux输出设备: ${this.device}（显式配置）`);
            return this.device;
        }
        const [list, pulse, pipewire] = await Promise.all([
            this.probe('aplay', ['-L']), this.probe('pactl', ['info']), this.probe('pw-cli', ['info', '0'])
        ]);
        const names = new Set(list.stdout.split(/\r?\n/u).filter(line => line && !/^\s/u.test(line)).map(line => line.trim()));
        const candidates = [[names.has('pulse') && pulse.available, 'pulse'],
            [names.has('pipewire') && pipewire.available, 'pipewire']];
        const device = candidates.find(([available]) => available)?.[1] || 'default';
        this.log(`[音频] Linux输出设备: ${device}${device === 'default' ? '（未探测到可用共享入口，沿用ALSA默认设备）' : '（共享音频服务）'}`);
        return device;
    }
}

module.exports = { LinuxAudioOutput, normalizeDevice };
