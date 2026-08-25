package com.aasc.tts

import java.util.Locale

// 将单调时钟得到的毫秒数转换为稳定的中文状态文本，避免界面层自行拼接精度。
object TtsDurationFormatter {
    fun format(elapsedMs: Long): String {
        require(elapsedMs >= 0) { "生成耗时不能为负数" }
        return String.format(Locale.ROOT, "%.2f 秒", elapsedMs / 1000.0)
    }
}
