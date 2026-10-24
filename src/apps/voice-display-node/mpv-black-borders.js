'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { Tracker, FramePipeline, FULL, normalizeEnabled, hasBorder } = require('../web-mediacenter/ui/public/js/video-black-borders');

/** Lua仅采样；账号/网络无关的检测状态留在本机当前播放代次内。 */
class MpvBlackBorders {
    constructor({ command, onChange, onUnavailable }) {
        this.command = command; this.onChange = onChange; this.onUnavailable = onUnavailable;
        this.enabled = true; this.epoch = 0; this.active = false; this.tracker = new Tracker();
        this.pipeline = new FramePipeline({
            createWorker: () => new Worker(path.join(__dirname, '../web-mediacenter/ui/public/js/video-black-borders-worker.js')),
            onResult: (rect, stamp) => { if (this.tracker.push(rect, stamp)) this.onChange?.(true); },
            onError: error => { this.active = false; this.onChange?.(); this.onUnavailable?.(error); },
            onReady: () => this.acknowledge()
        });
    }
    get rect() { return this.enabled && this.active ? this.tracker.rect : FULL; }
    get cropped() { return hasBorder(this.rect); }
    invalidate() { this.epoch += 1; this.active = false; this.tracker.reset(); this.pipeline.reset(); }
    acknowledge() {
        if (!this.active) return;
        const epoch = this.epoch;
        void this.command(['script-message', 'aasc-black-borders-ack', String(epoch)]).catch(error => {
            if (this.active && epoch === this.epoch) this.onUnavailable?.(error);
        });
    }
    async start(isVideo) {
        const epoch = this.epoch;
        this.active = this.enabled && isVideo;
        if (this.active) this.pipeline.prepare();
        await this.command(['script-message', this.active ? 'aasc-black-borders-start' : 'aasc-black-borders-stop', String(epoch)]);
    }
    setEnabled(value) { this.enabled = normalizeEnabled(value); this.invalidate(); }
    receive(args) {
        const [name, token, rawWidth, rawHeight, rawStamp, rawRotation, hex] = args || [];
        if (!this.enabled || !this.active || token !== String(this.epoch)) return;
        if (name === 'aasc-black-borders-error') {
            this.active = false; this.onChange?.(); this.onUnavailable?.(new Error('mpv当前视频无法读取黑边取样，保留正常播放')); return;
        }
        if (name === 'aasc-black-borders-bounds') {
            const values = args.slice(2).map(Number);
            const [frameWidth, frameHeight, stamp, rotation, x, y, width, height, pblack] = values;
            if (values.length !== 9 || !values.every(Number.isFinite) || ![0, 90, 180, 270].includes(rotation)) { this.acknowledge(); return; }
            const submitted = this.pipeline.frame(stamp, () => ({ rotation, nativeBounds: { frameWidth, frameHeight, x, y, width, height, pblack } }));
            if (!submitted) this.acknowledge();
            return;
        }
        if (name !== 'aasc-black-borders-frame') return;
        const width = Number(rawWidth), height = Number(rawHeight), stamp = Number(rawStamp), rotation = Number(rawRotation);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 192 || height > 192 ||
            typeof hex !== 'string' || hex.length !== width * height * 2 || !/^[a-f0-9]+$/i.test(hex) || ![0, 90, 180, 270].includes(rotation)) {
            this.acknowledge(); return;
        }
        const submitted = this.pipeline.frame(stamp, () => ({ width, height, rotation,
            // Buffer池不能直接转交线程，使用独立ArrayBuffer防止复制整个共享池。
            pixels: Uint8Array.from(Buffer.from(hex, 'hex')) }));
        if (!submitted) this.acknowledge();
    }
    async close() { this.invalidate(); await this.pipeline.close(); }
}

module.exports = { MpvBlackBorders };
