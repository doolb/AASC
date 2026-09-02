package com.aasc.display.vision.yolo

data class YoloTiming(
    val preprocessMs: Long,
    val inferenceMs: Long,
    val postprocessMs: Long
) {
    val totalMs: Long
        get() = preprocessMs + inferenceMs + postprocessMs
}

data class YoloResult(
    val model: String,
    val detections: List<YoloDetection>,
    val timing: YoloTiming,
    val affinityStatus: String,
    val loadModelMs: Long = 0L
)
