(function(root) {
    'use strict';
    class VideoBlackBorderController {
        constructor(video, { onChange, onUnavailable = () => {}, sleeping = () => false } = {}) {
            this.video = video; this.onChange = onChange; this.onUnavailable = onUnavailable; this.sleeping = sleeping;
            this.enabled = true; this.active = false; this.epoch = 0; this.timer = null;
            this.tracker = new root.VideoBlackBorders.Tracker();
            this.canvas = document.createElement('canvas');
            this.context = this.canvas.getContext('2d', { willReadFrequently: true });
            this.listeners = { playing: () => this.schedule(), pause: () => this.cancel(),
                emptied: () => this.reset(), loadstart: () => this.reset(), seeked: () => { this.tracker.candidate = null; this.tracker.count = 0; this.schedule(); } };
            for (const [event, handler] of Object.entries(this.listeners)) video.addEventListener(event, handler);
        }
        cancel() { clearTimeout(this.timer); this.timer = null; }
        reset() {
            this.epoch += 1; this.cancel(); this.unavailable = false; this.tracker.reset();
            this.onChange?.(this.tracker.rect);
        }
        setActive(active) { this.active = active; this.reset(); if (active) this.schedule(); }
        setEnabled(value) {
            this.enabled = root.VideoBlackBorders.normalizeEnabled(value); this.reset();
            if (this.enabled) this.schedule();
        }
        schedule() {
            if (this.timer || !this.active || !this.enabled || this.unavailable || this.video.paused || this.video.ended) return;
            const epoch = this.epoch;
            this.timer = setTimeout(() => {
                this.timer = null;
                if (epoch !== this.epoch) return;
                this.sample(); this.schedule();
            }, 1000);
        }
        sample() {
            const video = this.video;
            if (this.sleeping() || video.readyState < 2 || !video.videoWidth || !video.videoHeight || video.paused) return;
            const scale = Math.min(1, 192 / Math.max(video.videoWidth, video.videoHeight));
            this.canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            this.canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            try {
                this.context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
                const rgba = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
                const pixels = new Uint8Array(this.canvas.width * this.canvas.height);
                for (let i = 0; i < pixels.length; i += 1) pixels[i] = Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
                if (this.tracker.push(root.VideoBlackBorders.detect(pixels, this.canvas.width, this.canvas.height), video.currentTime)) {
                    this.onChange?.(this.tracker.rect);
                }
            } catch (error) {
                this.unavailable = true; this.cancel(); this.onUnavailable(error);
            }
        }
        close() {
            this.active = false; this.reset();
            for (const [event, handler] of Object.entries(this.listeners)) this.video.removeEventListener(event, handler);
            this.canvas.width = 0; this.canvas.height = 0;
        }
    }
    root.VideoBlackBorderController = VideoBlackBorderController;
})(window);
