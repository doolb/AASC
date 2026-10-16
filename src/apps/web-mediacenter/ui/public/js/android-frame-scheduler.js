/* Android显示页限制RAF动画上限，同时保留浏览器逐回调的微任务和错误报告边界。 */
(function installAndroidFrameScheduler(root) {
    'use strict';
    if (root.AndroidFrameScheduler) return;
    const enabled = /Android/i.test(root.navigator?.userAgent || '') || Boolean(root.NativeDisplay);
    const available = typeof root.requestAnimationFrame === 'function' && typeof root.cancelAnimationFrame === 'function';
    root.AndroidFrameScheduler = Object.freeze({ enabled: enabled && available, maxFps: enabled && available ? 60 : null });
    if (!enabled || !available) return;

    const nativeRequest = root.requestAnimationFrame.bind(root);
    const nativeCancel = root.cancelAnimationFrame.bind(root);
    const callbacks = new Map();
    const interval = 1000 / 60;
    // 容忍0.1毫秒的时间戳误差，避免正常60Hz因浮点抖动被误降到30FPS。
    const tolerance = 0.1;
    let nextId = 1;
    let decidedFrameAt = null;
    let frameAllowed = false;
    let lastDispatchAt = null;

    function allowFrame(now) {
        if (decidedFrameAt === now) return frameAllowed;
        decidedFrameAt = now;
        const elapsed = lastDispatchAt === null ? interval : now - lastDispatchAt;
        frameAllowed = lastDispatchAt === null || elapsed + tolerance >= interval;
        if (frameAllowed) {
            // 保留60FPS周期相位，落后时只跳过历史周期，不追加业务回调或合成时间戳。
            lastDispatchAt = lastDispatchAt === null ? now
                : lastDispatchAt + Math.max(1, Math.floor((elapsed + tolerance) / interval)) * interval;
        }
        return frameAllowed;
    }

    function schedule(id, entry) {
        entry.nativeId = nativeRequest(now => {
            if (!callbacks.has(id)) return;
            if (!allowFrame(now)) { schedule(id, entry); return; }
            callbacks.delete(id);
            // 每个回调继续占用独立原生RAF任务，浏览器在回调之间处理微任务和异常。
            // 回调内的新RAF自然安排到下一真实帧，同帧后续回调也仍可取消。
            entry.callback.call(root, now);
        });
    }

    root.requestAnimationFrame = function requestAndroidAnimationFrame(callback) {
        if (typeof callback !== 'function') throw new TypeError('requestAnimationFrame需要函数回调');
        const id = nextId++;
        const entry = { callback, nativeId: null };
        callbacks.set(id, entry);
        schedule(id, entry);
        return id;
    };
    root.cancelAnimationFrame = function cancelAndroidAnimationFrame(id) {
        const logicalId = Number(id);
        const entry = callbacks.get(logicalId);
        if (!entry) return;
        callbacks.delete(logicalId);
        nativeCancel(entry.nativeId);
    };
    // 浏览器自行暂停后台帧；恢复时重新选时基，没有额外定时器或常驻空RAF。
    root.document?.addEventListener('visibilitychange', () => {
        decidedFrameAt = null;
        lastDispatchAt = null;
    });
})(window);
