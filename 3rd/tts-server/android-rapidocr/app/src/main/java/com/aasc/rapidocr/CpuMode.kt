package com.aasc.rapidocr

// 用户可选的 CPU 调度模式；持久化数值保持简单稳定，便于后续 APK 版本兼容。
enum class CpuMode(
    val persistedValue: Int,
    val displayName: String,
    val intraOpThreads: Int
) {
    AUTO(0, "自动", 2),
    BIG(1, "大核", 2),
    LITTLE(2, "小核", 2),
    SINGLE_BIG(3, "单大核", 1),
    SINGLE_LITTLE(4, "单小核", 1);

    companion object {
        fun fromPersistedValue(value: Int): CpuMode =
            entries.firstOrNull { it.persistedValue == value } ?: AUTO
    }
}
