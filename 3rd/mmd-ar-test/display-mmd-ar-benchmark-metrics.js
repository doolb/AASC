/* 独立 MMD AR 测试用的图像跟踪对比指标；不进入正式显示端。 */
(function exposeMmdArBenchmarkMetrics(root, factory) {
    'use strict';

    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MmdArBenchmarkMetrics = api;
}(typeof globalThis === 'object' ? globalThis : this, function createMmdArBenchmarkMetrics() {
    'use strict';

    function createRun(engine, startedAt, compilationMs = null) {
        return {
            engine,
            startedAt,
            compilationMs,
            firstDetectedAt: null,
            previousVisible: false,
            lostCount: 0,
            sampleCount: 0,
            visibleSampleCount: 0,
            visibleDurationMs: 0,
            processingTimeTotalMs: 0,
            firstSampleAt: null,
            points: [],
            lastSampleAt: startedAt,
            stoppedAt: null
        };
    }

    function recordSample(run, sample) {
        if (!run || !sample || !Number.isFinite(sample.timestamp)) return false;
        const visible = sample.visible === true;
        const sampleDuration = Math.max(0, sample.timestamp - run.lastSampleAt);
        if (run.previousVisible) run.visibleDurationMs += sampleDuration;
        run.sampleCount += 1;
        if (run.firstSampleAt === null) run.firstSampleAt = sample.timestamp;
        run.lastSampleAt = sample.timestamp;
        run.processingTimeTotalMs += Math.max(0, Number(sample.processingMs) || 0);

        if (visible) {
            run.visibleSampleCount += 1;
            if (run.firstDetectedAt === null) run.firstDetectedAt = sample.timestamp;
            if (Number.isFinite(sample.x) && Number.isFinite(sample.y)) {
                run.points.push({ x: sample.x, y: sample.y });
            }
        } else if (run.previousVisible) {
            run.lostCount += 1;
        }
        run.previousVisible = visible;
        return true;
    }

    function finishRun(run, stoppedAt) {
        if (!run) return null;
        const endAt = Number.isFinite(stoppedAt) ? stoppedAt : run.lastSampleAt;
        const elapsedMs = Math.max(0, endAt - run.startedAt);
        const sampleSpanMs = Math.max(0, run.lastSampleAt - (run.firstSampleAt ?? run.startedAt));
        const finalVisibleDuration = run.previousVisible
            ? Math.max(0, endAt - run.lastSampleAt)
            : 0;
        const visibleDurationMs = Math.min(elapsedMs, run.visibleDurationMs + finalVisibleDuration);
        const points = run.points;
        const meanX = points.length
            ? points.reduce((sum, point) => sum + point.x, 0) / points.length
            : 0;
        const meanY = points.length
            ? points.reduce((sum, point) => sum + point.y, 0) / points.length
            : 0;
        const jitterPx = points.length > 1
            ? Math.sqrt(points.reduce((sum, point) => sum
                + ((point.x - meanX) ** 2)
                + ((point.y - meanY) ** 2), 0) / points.length)
            : null;

        return Object.freeze({
            engine: run.engine,
            compilationMs: run.compilationMs,
            firstDetectionMs: run.firstDetectedAt === null
                ? null
                : Math.max(0, run.firstDetectedAt - run.startedAt),
            elapsedMs,
            sampleCount: run.sampleCount,
            trackingFps: sampleSpanMs > 0 && run.sampleCount > 1
                ? ((run.sampleCount - 1) / sampleSpanMs) * 1000
                : 0,
            visiblePercent: elapsedMs > 0 ? (visibleDurationMs / elapsedMs) * 100 : 0,
            lostCount: run.lostCount,
            meanProcessingMs: run.sampleCount > 0
                ? run.processingTimeTotalMs / run.sampleCount
                : null,
            jitterPx
        });
    }

    return Object.freeze({ createRun, finishRun, recordSample });
}));
