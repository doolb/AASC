'use strict';

const { Tracker, FULL, detect, unrotateRect, normalizeEnabled, hasBorder } = require('../web-mediacenter/ui/public/js/video-black-borders');

/** Lua仅采样；账号/网络无关的检测状态留在本机当前播放代次内。 */
class MpvBlackBorders {
    constructor({ command, onChange, onUnavailable }) {
        this.command = command; this.onChange = onChange; this.onUnavailable = onUnavailable;
        this.enabled = true; this.epoch = 0; this.active = false; this.tracker = new Tracker();
    }
    get rect() { return this.enabled && this.active ? this.tracker.rect : FULL; }
    get cropped() { return hasBorder(this.rect); }
    invalidate() { this.epoch += 1; this.active = false; this.tracker.reset(); }
    async start(isVideo) {
        const epoch = this.epoch;
        this.active = this.enabled && isVideo;
        await this.command(['script-message', this.active ? 'aasc-black-borders-start' : 'aasc-black-borders-stop', String(epoch)]);
    }
    setEnabled(value) { this.enabled = normalizeEnabled(value); this.invalidate(); }
    receive(args) {
        const [name, token, rawWidth, rawHeight, rawStamp, rawRotation, hex] = args || [];
        if (!this.enabled || !this.active || token !== String(this.epoch)) return;
        if (name === 'aasc-black-borders-error') {
            this.active = false; this.onChange?.(); this.onUnavailable?.(new Error('mpv当前视频无法读取黑边取样，保留正常播放')); return;
        }
        if (name !== 'aasc-black-borders-frame') return;
        const width = Number(rawWidth), height = Number(rawHeight), stamp = Number(rawStamp), rotation = Number(rawRotation);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 192 || height > 192 ||
            typeof hex !== 'string' || hex.length !== width * height * 2 || !/^[a-f0-9]+$/i.test(hex) || ![0, 90, 180, 270].includes(rotation)) return;
        const rect = detect(Buffer.from(hex, 'hex'), width, height);
        if (this.tracker.push(rect && unrotateRect(rect, rotation), stamp)) this.onChange?.();
    }
}

module.exports = { MpvBlackBorders };
