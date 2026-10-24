(function(root) {
    'use strict';
    const scriptUrl = document.currentScript?.src;
    const workerUrl = scriptUrl ? new URL('video-black-borders-worker.js', scriptUrl).href : null;
    class VideoBlackBorderController {
        constructor(video, { onChange, onUnavailable = () => {}, sleeping = () => false } = {}) {
            this.video = video; this.onChange = onChange; this.onUnavailable = onUnavailable; this.sleeping = sleeping;
            this.enabled = true; this.active = false; this.epoch = 0; this.timer = null;
            this.tracker = new root.VideoBlackBorders.Tracker();
            this.canvas = document.createElement('canvas');
            this.context = this.canvas.getContext('2d', { willReadFrequently: true });
            this.pipeline = new root.VideoBlackBorders.FramePipeline({
                createWorker: workerUrl && root.Worker ? () => new Worker(workerUrl) : null,
                onResult: (rect, stamp) => { if (this.tracker.push(rect, stamp)) this.onChange?.(this.tracker.rect, true); },
                onError: error => { this.unavailable = true; this.cancel(); this.onUnavailable(error); }
            });
            this.listeners = { playing: () => this.schedule(), pause: () => this.cancel(),
                emptied: () => this.reset(), loadstart: () => this.reset(), seeked: () => {
                    this.pipeline.reset(); this.tracker.candidate = null; this.tracker.count = 0; this.schedule();
                } };
            for (const [event, handler] of Object.entries(this.listeners)) video.addEventListener(event, handler);
        }
        cancel() {
            this.epoch += 1;
            if (this.timer !== null) {
                if (this.frameCallback) this.video.cancelVideoFrameCallback(this.timer);
                else root.cancelAnimationFrame(this.timer);
            }
            this.timer = null;
        }
        reset() {
            this.cancel(); this.unavailable = false; this.tracker.reset(); this.pipeline.reset(); this.lastFrame = null;
            // 同分辨率换源也要重置origin-clean；旧跨域视频不能污染后续可读的本地视频。
            this.canvas.width = this.canvas.width;
            this.onChange?.(this.tracker.rect);
        }
        setActive(active) { this.active = active; this.reset(); if (active) { this.pipeline.prepare(); this.schedule(); } }
        setEnabled(value) {
            this.enabled = root.VideoBlackBorders.normalizeEnabled(value); this.reset();
            if (this.enabled && this.active) { this.pipeline.prepare(); this.schedule(); }
        }
        schedule() {
            if (this.timer !== null || !this.active || !this.enabled || this.unavailable || this.video.paused || this.video.ended) return;
            const epoch = this.epoch;
            this.frameCallback = typeof this.video.requestVideoFrameCallback === 'function' && typeof this.video.cancelVideoFrameCallback === 'function';
            const callback = (_now, metadata) => {
                if (epoch !== this.epoch) return;
                this.timer = null;
                const stamp = metadata?.mediaTime ?? this.video.currentTime;
                const count = metadata?.presentedFrames ?? this.video.getVideoPlaybackQuality?.().totalVideoFrames;
                const frame = count > 0 ? count : undefined;
                // 兼容动画帧回调可能重复遇到同一视频帧，必须先去重再读取像素。
                if (frame === undefined || frame !== this.lastFrame) { this.lastFrame = frame; this.sample(stamp); }
                this.schedule();
            };
            this.timer = this.frameCallback ? this.video.requestVideoFrameCallback(callback) : root.requestAnimationFrame(callback);
        }
        sample(stamp = this.video.currentTime) {
            const video = this.video;
            if (this.sleeping() || video.readyState < 2 || !video.videoWidth || !video.videoHeight || video.paused) return;
            this.pipeline.frame(stamp, () => {
                const scale = Math.min(1, 192 / Math.max(video.videoWidth, video.videoHeight));
                const width = Math.max(1, Math.round(video.videoWidth * scale)), height = Math.max(1, Math.round(video.videoHeight * scale));
                if (this.canvas.width !== width) this.canvas.width = width;
                if (this.canvas.height !== height) this.canvas.height = height;
                this.context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
                const rgba = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
                const pixels = new Uint8Array(this.canvas.width * this.canvas.height);
                for (let i = 0; i < pixels.length; i += 1) pixels[i] = Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
                return { pixels, width, height };
            });
        }
        close() {
            this.active = false; this.reset();
            void this.pipeline.close();
            for (const [event, handler] of Object.entries(this.listeners)) this.video.removeEventListener(event, handler);
            this.canvas.width = 0; this.canvas.height = 0;
        }
    }
    root.VideoBlackBorderController = VideoBlackBorderController;
})(window);
