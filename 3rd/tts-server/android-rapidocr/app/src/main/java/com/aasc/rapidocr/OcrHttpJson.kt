package com.aasc.rapidocr

// HTTP 测试服务不额外引入 JSON 框架，统一由这里负责转义文本和输出稳定字段顺序。
object OcrHttpJson {
    fun success(result: OcrResult, affinityStatus: String = "未执行"): String {
        val boxes = result.boxes.joinToString(",") { box ->
            val points = box.points.joinToString(",", prefix = "[", postfix = "]") { point ->
                "[${point.x},${point.y}]"
            }
            "{\"text\":\"${escape(box.text)}\",\"score\":${box.score},\"points\":$points}"
        }
        return "{" +
            "\"success\":true," +
            "\"text\":\"${escape(result.text)}\"," +
            "\"elapsedMs\":${result.elapsedMs}," +
            "\"imageWidth\":${result.imageWidth}," +
            "\"imageHeight\":${result.imageHeight}," +
            "\"affinityStatus\":\"${escape(affinityStatus)}\"," +
            "\"boxes\":[$boxes]" +
            "}"
    }

    fun error(message: String): String =
        "{\"success\":false,\"error\":\"${escape(message)}\"}"

    fun health(modelReady: Boolean, serviceRunning: Boolean, busy: Boolean): String =
        "{\"modelReady\":$modelReady,\"httpRunning\":$serviceRunning," +
            "\"engine\":\"rapidocr\",\"busy\":$busy}"

    private fun escape(value: String): String = buildString(value.length + 8) {
        value.forEach { character ->
            when (character) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (character.code < 0x20) append(' ') else append(character)
            }
        }
    }
}
