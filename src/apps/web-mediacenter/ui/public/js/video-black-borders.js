(function(root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.VideoBlackBorders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    const FULL = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
    const normalizeEnabled = value => typeof value === 'boolean' ? value : true;
    const right = box => box.x + box.width;
    const bottom = box => box.y + box.height;
    const hasBorder = box => !!box && (box.x > 0.001 || box.y > 0.001 || right(box) < 0.999 || bottom(box) < 0.999);
    const close = (a, b, tolerance = 0.015) => !!a && !!b && Math.max(
        Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(right(a) - right(b)), Math.abs(bottom(a) - bottom(b))) <= tolerance;

    function union(a, b) {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
    }

    /** 只扫描源画面内的连续近黑边缘，亮度采用RGB最大分量，避免把深蓝等有效色当成黑色。 */
    function detect(pixels, width, height) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 ||
            width > 192 || height > 192 || !pixels || pixels.length !== width * height) return null;
        let bright = 0;
        for (const value of pixels) if (value >= 48) bright += 1;
        if (bright < pixels.length * 0.08) return null;
        const blackLine = (start, step, count) => {
            let nonBlack = 0;
            for (let index = 0; index < count; index += 1) if (pixels[start + index * step] > 24) nonBlack += 1;
            return nonBlack <= Math.floor(count * 0.01);
        };
        let top = 0, low = height, left = 0, high = width;
        while (top < height * 0.35 && blackLine(top * width, 1, width)) top += 1;
        while (height - low < height * 0.35 && blackLine((low - 1) * width, 1, width)) low -= 1;
        while (left < width * 0.35 && blackLine(top * width + left, width, low - top)) left += 1;
        while (width - high < width * 0.35 && blackLine(top * width + high - 1, width, low - top)) high -= 1;
        // 过宽黑区通常来自暗场/局部光源；拒绝而不是把画面裁成很小的一块。
        if (top > height * 0.34 || height - low > height * 0.34 || left > width * 0.34 || width - high > width * 0.34 ||
            (high - left) * (low - top) < width * height * 0.25) return null;
        // 补一个采样像素余量，压缩噪声和缩小插值不能切掉有效内容。
        top = top < 2 ? 0 : top - 1; low = height - low < 2 ? height : low + 1;
        left = left < 2 ? 0 : left - 1; high = width - high < 2 ? width : high + 1;
        return { x: left / width, y: top / height, width: (high - left) / width, height: (low - top) / height };
    }

    /** 原生滤镜已逐帧扫描亮度；JS校验暗场/面积/边界，并补与小图检测相同的安全余量。 */
    function detectNative(bounds) {
        const { x, y, width, height, frameWidth: w, frameHeight: h, pblack } = bounds;
        if (![x, y, width, height, w, h, pblack].every(Number.isFinite) || w < 16 || h < 16 || w > 32768 || h > 32768 ||
            x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > w || y + height > h || pblack < 0 || pblack > 92) return null;
        const margins = [x / w, y / h, (w - x - width) / w, (h - y - height) / h];
        if (margins.some(value => value > 0.34) || width * height < w * h * 0.25) return null;
        const pad = Math.max(w, h) / 192;
        const left = x < pad * 2 ? 0 : x - pad, top = y < pad * 2 ? 0 : y - pad;
        const high = w - x - width < pad * 2 ? w : x + width + pad;
        const low = h - y - height < pad * 2 ? h : y + height + pad;
        return { x: left / w, y: top / h, width: (high - left) / w, height: (low - top) / h };
    }

    function detectFrame(frame) {
        const rect = frame.nativeBounds ? detectNative(frame.nativeBounds) : detect(frame.pixels, frame.width, frame.height);
        return rect && unrotateRect(rect, frame.rotation || 0);
    }

    class Tracker {
        constructor() { this.reset(); }
        reset() { this.rect = { ...FULL }; this.candidate = null; this.count = 0; this.stamp = null; }
        push(rect, stamp) {
            if (!Number.isFinite(stamp) || stamp === this.stamp) return false;
            this.stamp = stamp;
            if (!rect) { this.candidate = null; this.count = 0; return false; }
            if (close(this.candidate, rect)) { this.candidate = union(this.candidate, rect); this.count += 1; }
            else { this.candidate = { ...rect }; this.count = 1; }
            if (this.count < 2 || close(this.rect, this.candidate, 0.002)) return false;
            this.rect = { ...this.candidate };
            return true;
        }
    }

    /** 当前新帧只消费上次完成结果；计算单在途，慢计算期间不保存等待处理的帧。 */
    class FramePipeline {
        constructor({ compute, onResult, onError = () => {}, onReady = () => {}, createWorker } = {}) {
            this.compute = compute || detectFrame;
            this.onResult = onResult; this.onError = onError; this.onReady = onReady; this.createWorker = createWorker;
            this.worker = null; this.closed = false; this.epoch = 0; this.sequence = 0; this.busy = null;
            this.disposals = new Set(); this.reset();
        }
        reset() {
            this.epoch += 1; this.completed = null; this.lastStamp = null;
            this.stats = { frames: 0, submitted: 0, completed: 0, skipped: 0, applied: 0 };
        }
        prepare() {
            if (this.closed || this.worker || !this.createWorker) return;
            try {
                const worker = this.createWorker(); this.worker = worker;
                const message = data => {
                    if (this.worker !== worker || data?.id !== this.busy?.id) return;
                    this.finish(this.busy, data.rect, data.error ? new Error(data.error) : null);
                };
                const fail = () => {
                    if (this.worker !== worker) return;
                    this.terminateWorker(); this.createWorker = null;
                    const job = this.busy; this.busy = null;
                    // 传输后的像素已经转交Worker；失败帧不重算，放行下一新帧走兼容计算。
                    if (job && job.epoch === this.epoch && !this.closed) this.onReady(job.stamp);
                };
                if (worker.addEventListener) {
                    worker.addEventListener('message', event => message(event.data));
                    worker.addEventListener('error', event => { event.preventDefault?.(); fail(); });
                } else {
                    worker.on('message', message); worker.on('error', fail);
                    worker.on('exit', () => { if (this.worker === worker) fail(); });
                    worker.unref?.();
                }
            } catch { this.createWorker = null; this.worker = null; }
        }
        frame(stamp, capture) {
            if (this.closed || !Number.isFinite(stamp) || stamp < 0 || stamp === this.lastStamp) return false;
            this.lastStamp = stamp; this.stats.frames += 1;
            const ready = this.completed; this.completed = null;
            if (ready) { this.stats.applied += 1; this.onResult?.(ready.rect, ready.stamp); }
            if (this.closed) return false;
            if (this.busy) { this.stats.skipped += 1; return false; }
            const job = { id: ++this.sequence, epoch: this.epoch, stamp };
            try {
                const frame = capture();
                if (!frame) return false;
                this.busy = job; this.stats.submitted += 1; this.prepare();
                if (this.worker) this.worker.postMessage({ ...frame, id: job.id }, frame.pixels ? [frame.pixels.buffer] : []);
                else Promise.resolve().then(() => this.compute(frame)).then(
                    rect => this.finish(job, rect), error => this.finish(job, null, error));
                return true;
            } catch (error) {
                if (this.busy === job) this.busy = null;
                this.onError(error); return false;
            }
        }
        finish(job, rect, error) {
            if (this.busy !== job) return;
            this.busy = null;
            if (this.closed || job.epoch !== this.epoch) return;
            if (error) this.onError(error);
            else { this.stats.completed += 1; this.completed = { rect, stamp: job.stamp }; }
            this.onReady(job.stamp);
        }
        terminateWorker() {
            const worker = this.worker; this.worker = null;
            if (!worker) return;
            const disposal = Promise.resolve(worker.terminate()).catch(() => {});
            this.disposals.add(disposal); void disposal.finally(() => this.disposals.delete(disposal));
        }
        async close() {
            this.closed = true; this.reset(); this.busy = null; this.terminateWorker();
            await Promise.all(this.disposals);
        }
    }

    /** mpv截图包含用户旋转，回转到和videoWidth/videoHeight一致的原视频坐标。 */
    function unrotateRect(box, rotation) {
        const turns = ((rotation % 360) + 360) % 360;
        const maps = {
            0: () => ({ ...box }),
            90: () => ({ x: box.y, y: 1 - right(box), width: box.height, height: box.width }),
            180: () => ({ x: 1 - right(box), y: 1 - bottom(box), width: box.width, height: box.height }),
            270: () => ({ x: 1 - bottom(box), y: box.x, width: box.height, height: box.width })
        };
        return maps[turns]?.() || null;
    }

    function intersectCrop(content, crop) {
        const box = { x: crop.x / 100, y: crop.y / 100, width: crop.width / 100, height: crop.height / 100 };
        const x = Math.max(content.x, box.x), y = Math.max(content.y, box.y);
        const width = Math.min(right(content), right(box)) - x, height = Math.min(bottom(content), bottom(box)) - y;
        return width > 0 && height > 0 ? { x, y, width, height } : box;
    }

    /** 返回完整源视频的布局；有效矩形居中，缩放比例只由当前填充方式决定。 */
    function layout({ width, height, windowWidth, windowHeight, rotation = 0, fit = 'contain', rect = FULL, crop }) {
        if (![width, height, windowWidth, windowHeight].every(value => Number.isFinite(value) && value > 0)) return null;
        if (fit === 'crop' && crop) rect = intersectCrop(rect, crop);
        const turns = ((rotation % 360) + 360) % 360, turned = turns % 180 !== 0;
        const contentWidth = width * rect.width, contentHeight = height * rect.height;
        const visualWidth = turned ? contentHeight : contentWidth, visualHeight = turned ? contentWidth : contentHeight;
        const contain = Math.min(windowWidth / visualWidth, windowHeight / visualHeight);
        const scales = { contain, dynamic: contain,
            cover: Math.max(windowWidth / visualWidth, windowHeight / visualHeight),
            crop: Math.max(windowWidth / visualWidth, windowHeight / visualHeight),
            height: turned ? windowWidth / visualWidth : windowHeight / visualHeight,
            width: turned ? windowHeight / visualHeight : windowWidth / visualWidth };
        const scale = scales[fit];
        if (!scale) return null;
        const dx = (rect.x + rect.width / 2 - 0.5) * width * scale;
        const dy = (rect.y + rect.height / 2 - 0.5) * height * scale;
        const offset = { 0: [dx, dy], 90: [-dy, dx], 180: [-dx, -dy], 270: [dy, -dx] }[turns];
        if (!offset) return null;
        const baseContain = Math.min(windowWidth / (turned ? height : width), windowHeight / (turned ? width : height));
        const fullWidth = (turned ? height : width) * scale, fullHeight = (turned ? width : height) * scale;
        return {
            width: width * scale, height: height * scale,
            left: (windowWidth - width * scale) / 2 - offset[0], top: (windowHeight - height * scale) / 2 - offset[1],
            scaleX: scale / baseContain, scaleY: scale / baseContain,
            panX: -offset[0] / fullWidth, panY: -offset[1] / fullHeight,
            clip: `inset(${rect.y * 100}% ${(1 - right(rect)) * 100}% ${(1 - bottom(rect)) * 100}% ${rect.x * 100}%)`
        };
    }

    return { FULL, normalizeEnabled, hasBorder, detect, detectNative, detectFrame, Tracker, FramePipeline, unrotateRect, layout };
});
