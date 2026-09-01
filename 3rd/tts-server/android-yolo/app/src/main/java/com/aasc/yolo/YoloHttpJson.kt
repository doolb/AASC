package com.aasc.yolo

import java.util.Locale

/** 生成无需额外 JSON 依赖的 HTTP 响应，所有用户可控字符串都经过转义。 */
object YoloHttpJson {
    fun error(message: String): String = "{\"success\":false,\"error\":\"${escape(message)}\"}"

    fun health(modelReady: Boolean, httpRunning: Boolean, busy: Boolean, activeModel: YoloModel?): String {
        return "{\"success\":true,\"modelReady\":$modelReady,\"httpRunning\":$httpRunning," +
            "\"busy\":$busy,\"engine\":\"yolo11\",\"activeModel\":${stringOrNull(activeModel?.id)}}"
    }

    fun models(models: List<YoloModel>, activeModel: YoloModel?): String {
        val values = models.joinToString(",") { model ->
            "{\"id\":\"${escape(model.id)}\",\"displayName\":\"${escape(model.displayName)}\"," +
                "\"fileName\":\"${escape(model.fileName)}\",\"active\":${model == activeModel}}"
        }
        return "{\"success\":true,\"models\":[$values]}"
    }

    fun success(result: YoloResult): String {
        val detectionJson = result.detections.joinToString(",") { detection -> detection(detection) }
        val timing = result.timing
        return "{\"success\":true,\"engine\":\"yolo11\",\"model\":\"${result.model.id}\"," +
            "\"loadModelMs\":${result.loadModelMs},\"preprocessMs\":${timing.preprocessMs}," +
            "\"inferenceMs\":${timing.inferenceMs},\"postprocessMs\":${timing.postprocessMs}," +
            "\"elapsedMs\":${timing.totalMs},\"affinityStatus\":\"${escape(result.affinityStatus)}\"," +
            "\"detections\":[$detectionJson]}"
    }

    fun benchmark(result: YoloBenchmarkResult): String {
        val items = result.items.joinToString(",") { item ->
            "{\"model\":\"${item.model.id}\",\"displayName\":\"${item.model.displayName}\"," +
                "\"loadModelMs\":${item.loadModelMs}," +
                "\"averagePreprocessMs\":${decimal(item.averagePreprocessMs)}," +
                "\"averageInferenceMs\":${decimal(item.averageInferenceMs)}," +
                "\"averagePostprocessMs\":${decimal(item.averagePostprocessMs)}," +
                "\"averageTotalMs\":${decimal(item.averageTotalMs)}," +
                "\"p50TotalMs\":${decimal(item.p50TotalMs)}," +
                "\"p95TotalMs\":${decimal(item.p95TotalMs)}," +
                "\"fps\":${decimal(item.fps)},\"detectionCount\":${item.detectionCount}}"
        }
        return "{\"success\":true,\"engine\":\"yolo11\",\"warmup\":${result.warmupCount}," +
            "\"runs\":${result.runCount},\"items\":[$items]}"
    }

    private fun detection(value: YoloDetection): String {
        return "{\"classId\":${value.classId},\"confidence\":${decimal(value.confidence.toDouble())}," +
            "\"left\":${decimal(value.left.toDouble())},\"top\":${decimal(value.top.toDouble())}," +
            "\"right\":${decimal(value.right.toDouble())},\"bottom\":${decimal(value.bottom.toDouble())}}"
    }

    private fun stringOrNull(value: String?): String = value?.let { "\"${escape(it)}\"" } ?: "null"

    private fun decimal(value: Double): String = String.format(Locale.US, "%.3f", value)

    private fun escape(value: String): String = buildString(value.length + 8) {
        value.forEach { character ->
            when (character) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (character.code < 0x20) append("\\u%04x".format(character.code)) else append(character)
            }
        }
    }
}
