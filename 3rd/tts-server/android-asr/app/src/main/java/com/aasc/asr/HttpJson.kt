package com.aasc.asr

// HTTP 接口统一使用手写 JSON，避免为测试服务引入额外依赖，并确保错误消息正确转义。
object HttpJson {
    fun success(text: String, elapsedMs: Long): String =
        "{\"success\":true,\"text\":\"${escape(text)}\",\"elapsedMs\":$elapsedMs}"

    fun error(message: String, elapsedMs: Long = 0): String =
        "{\"success\":false,\"error\":\"${escape(message)}\",\"elapsedMs\":$elapsedMs}"

    fun health(modelReady: Boolean, serviceRunning: Boolean, cpuMode: CpuMode): String =
        "{\"modelReady\":$modelReady,\"httpRunning\":$serviceRunning,\"cpuMode\":\"${cpuMode.name}\"}"

    private fun escape(value: String): String = buildString(value.length + 8) {
        value.forEach { character ->
            when (character) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (character.code < 0x20) append(" ") else append(character)
            }
        }
    }
}
