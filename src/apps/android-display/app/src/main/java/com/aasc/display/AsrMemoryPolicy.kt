package com.aasc.display

/**
 * 根据当前可用内存决定 ASR recognizer 数量。
 *
 * 默认仍使用 CPU 策略计算出的核心数；只有预计无法同时承载全部 recognizer
 * 时才回退到单实例。单实例也无法承载时返回 0，由模型管理器报告终态错误。
 */
object AsrMemoryPolicy {
    const val DEFAULT_PER_RECOGNIZER_BUDGET_BYTES = 400L * 1024 * 1024

    fun chooseSlots(
        availableBytes: Long,
        requestedSlots: Int,
        perRecognizerBudgetBytes: Long = DEFAULT_PER_RECOGNIZER_BUDGET_BYTES
    ): Int {
        val requested = requestedSlots.coerceAtLeast(1)
        val budget = perRecognizerBudgetBytes.coerceAtLeast(1L)
        if (availableBytes < budget) return 0
        if (requested == 1) return 1
        return if (availableBytes / budget >= requested.toLong()) requested else 1
    }
}
