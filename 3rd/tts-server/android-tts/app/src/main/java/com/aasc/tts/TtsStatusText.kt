package com.aasc.tts

// 集中维护生成成功文案，保证耗时格式和 UI 状态测试使用同一条逻辑。
object TtsStatusText {
    fun generationCompleted(elapsedMs: Long): String {
        return "生成完成，用时 ${TtsDurationFormatter.format(elapsedMs)}"
    }
}
