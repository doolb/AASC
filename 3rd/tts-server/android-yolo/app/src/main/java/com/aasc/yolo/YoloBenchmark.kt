package com.aasc.yolo

import kotlin.math.ceil

/** 负责统一测速参数、预热轮次和阶段耗时统计。 */
object YoloBenchmarkStats {
    fun summarize(
        model: YoloModel,
        loadModelMs: Long,
        samples: List<YoloTiming>,
        detectionCount: Int
    ): YoloBenchmarkItem {
        require(samples.isNotEmpty()) { "测速样本不能为空" }
        val averagePreprocess = samples.map { it.preprocessMs.toDouble() }.average()
        val averageInference = samples.map { it.inferenceMs.toDouble() }.average()
        val averagePostprocess = samples.map { it.postprocessMs.toDouble() }.average()
        val totals = samples.map { it.totalMs.toDouble() }.sorted()
        val averageTotal = totals.average()
        return YoloBenchmarkItem(
            model = model,
            loadModelMs = loadModelMs,
            averagePreprocessMs = averagePreprocess,
            averageInferenceMs = averageInference,
            averagePostprocessMs = averagePostprocess,
            averageTotalMs = averageTotal,
            p50TotalMs = percentile(totals, 0.50),
            p95TotalMs = percentile(totals, 0.95),
            fps = if (averageTotal > 0.0) 1000.0 / averageTotal else 0.0,
            detectionCount = detectionCount
        )
    }

    private fun percentile(sortedValues: List<Double>, percentile: Double): Double {
        val index = (ceil(sortedValues.size * percentile).toInt() - 1).coerceIn(0, sortedValues.lastIndex)
        return sortedValues[index]
    }
}

/** 五个模型按固定顺序串行执行，避免同时加载大模型造成内存峰值。 */
class YoloBenchmark(private val detector: YoloDetector) {
    fun run(
        bitmap: android.graphics.Bitmap,
        models: List<YoloModel>,
        warmupCount: Int,
        runCount: Int,
        cpuMode: CpuMode
    ): YoloBenchmarkResult = detector.withInferenceLock {
        runInternal(bitmap, models, warmupCount, runCount, cpuMode)
    }

    /**
     * 在 detector 的整轮推理锁内执行，保证模型切换、预热和正式采样不会被其他请求插入。
     */
    private fun runInternal(
        bitmap: android.graphics.Bitmap,
        models: List<YoloModel>,
        warmupCount: Int,
        runCount: Int,
        cpuMode: CpuMode
    ): YoloBenchmarkResult {
        validateParameters(warmupCount, runCount)
        require(models.isNotEmpty()) { "测速模型不能为空" }
        val items = models.distinct().map { model ->
            val loadModelMs = detector.load(model, cpuMode)
            repeat(warmupCount) { detector.detectLoaded(bitmap, cpuMode) }
            val samples = (0 until runCount).map { detector.detectLoaded(bitmap, cpuMode) }
            YoloBenchmarkStats.summarize(
                model = model,
                loadModelMs = loadModelMs,
                samples = samples.map { it.timing },
                detectionCount = samples.last().detections.size
            )
        }
        return YoloBenchmarkResult(warmupCount, runCount, items)
    }

    companion object {
        fun validateParameters(warmup: Int, runs: Int) {
            require(warmup in 0..10) { "warmup 必须在 0 到 10 之间" }
            require(runs in 1..50) { "runs 必须在 1 到 50 之间" }
        }
    }
}
