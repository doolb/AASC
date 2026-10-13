package com.aasc.display

/** 每个Node进程独立保存错误摘要，避免旧进程日志污染新一轮启动状态。 */
class NodeStartupDiagnostics {
    private var error = ""

    @Synchronized fun record(line: String, errorStream: Boolean) {
        val value = line.trim()
        if (value.isEmpty() || value.startsWith("at ") || value.startsWith("Node.js v")) return
        if (Regex("(?:^|\\]\\s)(?:\\w*Error|Error):").containsMatchIn(value)) {
            if (error.isEmpty()) error = sanitize(value)
        } else if (errorStream && error.isEmpty() && value.startsWith("FATAL", true)) {
            error = sanitize(value)
        }
    }

    @Synchronized fun describe(fallback: String): String = if (error.isEmpty()) fallback else "$fallback：$error"

    companion object {
        fun sanitize(value: String): String = value
            .replace(Regex("(?i)(authorization|api[_-]?key|token|password|cookie)\\s*[:=]\\s*[^\\s,;]+"), "$1=[已隐藏]")
            .replace(Regex("https?://[^\\s]+"), "[服务地址]")
            .replace(Regex("[\\r\\n]+"), " ")
            .take(768)

        fun matchesRuntime(actualVersion: String?, actualPath: String?, expectedVersion: Int?, expectedPath: String): Boolean =
            actualPath == expectedPath && (expectedVersion == null || actualVersion == "v$expectedVersion")
    }
}
