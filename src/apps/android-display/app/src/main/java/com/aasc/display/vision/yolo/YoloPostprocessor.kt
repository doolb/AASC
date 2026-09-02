package com.aasc.display.vision.yolo

import kotlin.math.max
import kotlin.math.min

data class YoloDetection(
    val classId: Int,
    val confidence: Float,
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float
)

/** 解析 YOLO11 输出、执行类别内 NMS 并还原到原图坐标。 */
object YoloPostprocessor {
    private const val MAX_DETECTIONS = 100

    fun decode(shape: LongArray, values: FloatArray, transform: LetterboxTransform, confidenceThreshold: Float, iouThreshold: Float): List<YoloDetection> {
        require(shape.size == 3 && shape[0] == 1L) { "不支持的 YOLO11 输出形状" }
        require(confidenceThreshold in 0f..1f) { "置信度阈值必须在 0 到 1 之间" }
        require(iouThreshold in 0f..1f) { "NMS 阈值必须在 0 到 1 之间" }
        val dimensionOne = shape[1].toInt()
        val dimensionTwo = shape[2].toInt()
        val featureFirst = dimensionOne in 5..256 && (dimensionTwo < 5 || dimensionOne < dimensionTwo)
        val featureCount = if (featureFirst) dimensionOne else dimensionTwo
        val candidateCount = if (featureFirst) dimensionTwo else dimensionOne
        require(featureCount >= 5 && values.size == featureCount * candidateCount) { "不支持的 YOLO11 输出张量大小" }
        fun featureAt(feature: Int, candidate: Int): Float = if (featureFirst) values[feature * candidateCount + candidate] else values[candidate * featureCount + feature]

        val candidates = ArrayList<YoloDetection>()
        for (candidate in 0 until candidateCount) {
            var classId = -1
            var bestScore = 0f
            for (classIndex in 4 until featureCount) {
                val score = featureAt(classIndex, candidate).coerceIn(0f, 1f)
                if (score > bestScore) {
                    bestScore = score
                    classId = classIndex - 4
                }
            }
            if (classId < 0 || bestScore < confidenceThreshold) continue
            val centerX = featureAt(0, candidate)
            val centerY = featureAt(1, candidate)
            val width = featureAt(2, candidate)
            val height = featureAt(3, candidate)
            if (width <= 0f || height <= 0f) continue
            val left = ((centerX - width / 2f - transform.padLeft) / transform.scale).coerceIn(0f, transform.sourceWidth.toFloat())
            val top = ((centerY - height / 2f - transform.padTop) / transform.scale).coerceIn(0f, transform.sourceHeight.toFloat())
            val right = ((centerX + width / 2f - transform.padLeft) / transform.scale).coerceIn(0f, transform.sourceWidth.toFloat())
            val bottom = ((centerY + height / 2f - transform.padTop) / transform.scale).coerceIn(0f, transform.sourceHeight.toFloat())
            if (right > left && bottom > top) candidates += YoloDetection(classId, bestScore, left, top, right, bottom)
        }
        return nonMaximumSuppression(candidates, iouThreshold)
    }

    private fun nonMaximumSuppression(candidates: List<YoloDetection>, iouThreshold: Float): List<YoloDetection> {
        val remaining = candidates.sortedByDescending { it.confidence }.toMutableList()
        val selected = ArrayList<YoloDetection>()
        while (remaining.isNotEmpty() && selected.size < MAX_DETECTIONS) {
            val current = remaining.removeAt(0)
            selected += current
            remaining.removeAll { other -> other.classId == current.classId && intersectionOverUnion(current, other) > iouThreshold }
        }
        return selected
    }

    private fun intersectionOverUnion(first: YoloDetection, second: YoloDetection): Float {
        val intersectionWidth = (min(first.right, second.right) - max(first.left, second.left)).coerceAtLeast(0f)
        val intersectionHeight = (min(first.bottom, second.bottom) - max(first.top, second.top)).coerceAtLeast(0f)
        val intersection = intersectionWidth * intersectionHeight
        val firstArea = (first.right - first.left) * (first.bottom - first.top)
        val secondArea = (second.right - second.left) * (second.bottom - second.top)
        return intersection / (firstArea + secondArea - intersection).coerceAtLeast(0.0001f)
    }
}
