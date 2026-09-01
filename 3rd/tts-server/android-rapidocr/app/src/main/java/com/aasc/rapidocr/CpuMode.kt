package com.aasc.rapidocr

// 用户可选的 CPU 调度模式；持久化数值保持简单稳定，便于后续 APK 版本兼容。
enum class CpuMode(val persistedValue: Int, val displayName: String) {
    AUTO(0, "自动"),
    BIG(1, "大核"),
    LITTLE(2, "小核");

    companion object {
        fun fromPersistedValue(value: Int): CpuMode =
            entries.firstOrNull { it.persistedValue == value } ?: AUTO
    }
}
