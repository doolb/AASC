package com.aasc.yolo

data class YoloTiming(
    val preprocessMs: Long,
    val inferenceMs: Long,
    val postprocessMs: Long
) {
    val totalMs: Long
        get() = preprocessMs + inferenceMs + postprocessMs
}

data class YoloResult(
    val model: YoloModel,
    val detections: List<YoloDetection>,
    val timing: YoloTiming,
    val affinityStatus: String,
    val loadModelMs: Long = 0L
)

data class YoloBenchmarkItem(
    val model: YoloModel,
    val loadModelMs: Long,
    val averagePreprocessMs: Double,
    val averageInferenceMs: Double,
    val averagePostprocessMs: Double,
    val averageTotalMs: Double,
    val p50TotalMs: Double,
    val p95TotalMs: Double,
    val fps: Double,
    val detectionCount: Int
)

data class YoloBenchmarkResult(
    val warmupCount: Int,
    val runCount: Int,
    val items: List<YoloBenchmarkItem>
)
