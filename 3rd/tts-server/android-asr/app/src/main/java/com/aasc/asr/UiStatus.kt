package com.aasc.asr

// 集中生成界面文案，确保手动识别和 HTTP 识别的耗时语义一致。
object UiStatus {
    fun result(text: String, elapsedMs: Long): String = "识别完成，用时 ${elapsedMs} ms\n$text"

    fun validate(samples: FloatArray): String = when {
        samples.isEmpty() -> "没有可识别的音频"
        samples.size > AudioRecorder.SAMPLE_RATE * 60 -> "音频长度超过 60 秒"
        else -> ""
    }
}
