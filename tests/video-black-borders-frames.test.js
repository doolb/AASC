'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const api = require('../src/apps/web-mediacenter/ui/public/js/video-black-borders');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('逐帧先消费上一帧完成结果，两次稳定在后续帧应用，慢任务无排队', async () => {
    const tracker = new api.Tracker(), jobs = [], applied = [], captures = [];
    const rect = { x: 0, y: 0.2, width: 1, height: 0.6 };
    const pipe = new api.FramePipeline({ compute: frame => new Promise(resolve => jobs.push({ frame, resolve })),
        onResult: (value, stamp) => { if (tracker.push(value, stamp)) applied.push(stamp); } });
    const capture = stamp => () => { captures.push(stamp); return { stamp }; };
    assert.equal(pipe.frame(1, capture(1)), true); await flush();
    assert.equal(pipe.frame(2, capture(2)), false); assert.deepEqual(captures, [1]);
    jobs[0].resolve(rect); await flush(); assert.deepEqual(applied, []);
    pipe.frame(3, capture(3)); await flush(); assert.equal(tracker.count, 1);
    jobs[1].resolve(rect); await flush(); assert.deepEqual(applied, []);
    assert.equal(pipe.frame(3, capture(3)), false, '同一播放帧不得消费或重复计算');
    pipe.frame(4, capture(4)); await flush(); assert.deepEqual(applied, [3]);
    assert.deepEqual(captures, [1, 3, 4]); assert.equal(pipe.stats.skipped, 1);
    jobs[2].resolve(rect); await pipe.close();
});

test('换源和关闭后迟到的计算不覆盖新视频，Worker失败后后续帧兼容计算', async () => {
    const jobs = [], results = [];
    const pipe = new api.FramePipeline({ compute: () => new Promise(resolve => jobs.push(resolve)), onResult: rect => results.push(rect) });
    pipe.frame(1, () => ({})); await flush(); pipe.reset(); jobs[0]('old'); await flush();
    pipe.frame(2, () => ({})); await flush(); assert.deepEqual(results, []);
    await pipe.close(); jobs[1]('closed'); await flush(); assert.deepEqual(results, []);

    class Worker extends EventEmitter { postMessage() {} terminate() { this.terminated = true; return Promise.resolve(); } }
    const worker = new Worker(), ready = [], fallback = [];
    const failing = new api.FramePipeline({ createWorker: () => worker, compute: () => api.FULL,
        onReady: stamp => ready.push(stamp), onResult: rect => fallback.push(rect) });
    failing.frame(1, () => ({ pixels: new Uint8Array(4) }));
    worker.emit('error', new Error('worker unavailable')); assert.equal(worker.terminated, true); assert.deepEqual(ready, [1]);
    failing.frame(2, () => ({})); await flush(); failing.frame(3, () => ({}));
    assert.deepEqual(fallback, [api.FULL]); await failing.close();
});

function displayHarness(nativeFrames) {
    const jobs = new Map(); let id = 0, reads = 0;
    const video = { paused: false, ended: false, readyState: 4, videoWidth: 192, videoHeight: 108, currentTime: 0,
        addEventListener() {}, removeEventListener() {}, getVideoPlaybackQuality: () => ({ totalVideoFrames: video.frames || 0 }) };
    const request = callback => { jobs.set(++id, callback); return id; }, cancel = key => jobs.delete(key);
    if (nativeFrames) { video.requestVideoFrameCallback = request; video.cancelVideoFrameCallback = cancel; }
    const context = { drawImage() {}, getImageData() {
        reads += 1; const pixels = new Uint8ClampedArray(192 * 108 * 4);
        for (let y = 18; y < 90; y += 1) for (let x = 0; x < 192; x += 1) pixels[(y * 192 + x) * 4] = 150;
        return { data: pixels };
    } };
    const root = { VideoBlackBorders: api, requestAnimationFrame: request, cancelAnimationFrame: cancel };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/display-video-black-borders.js'), 'utf8'),
        { window: root, document: { currentScript: null, createElement: () => ({ getContext: () => context }) }, URL });
    const controller = new root.VideoBlackBorderController(video);
    controller.setActive(true);
    const frame = async (stamp, count) => {
        video.currentTime = stamp; video.frames = count;
        const [key, callback] = jobs.entries().next().value; jobs.delete(key);
        callback(0, nativeFrames ? { mediaTime: stamp, presentedFrames: count } : undefined); await flush();
    };
    return { controller, video, jobs, frame, reads: () => reads };
}

for (const native of [true, false]) test(`${native ? '视频帧回调' : '动画帧兼容'}：两帧确认、暂停取消和旧回调隔离`, async () => {
    const h = displayHarness(native), { controller, video, frame, jobs } = h;
    await frame(0.01, 1); assert.equal(controller.tracker.count, 0);
    await frame(0.02, 2); assert.equal(controller.tracker.count, 1);
    await frame(0.03, 3); assert.ok(api.hasBorder(controller.tracker.rect));
    const reads = h.reads(); await frame(0.04, 3); assert.equal(h.reads(), reads, '同一已呈现帧不重复读回');
    const stale = jobs.values().next().value;
    video.paused = true; controller.listeners.pause(); assert.equal(controller.timer, null); assert.equal(jobs.size, 0);
    video.paused = false; controller.listeners.playing(); const current = controller.timer;
    stale(0, { mediaTime: 5, presentedFrames: 50 }); assert.equal(controller.timer, current); assert.equal(jobs.size, 1);
    controller.setActive(false); assert.equal(jobs.size, 0); assert.equal(api.hasBorder(controller.tracker.rect), false);
    controller.close(); await controller.pipeline.close(); assert.equal(jobs.size, 0);
});
