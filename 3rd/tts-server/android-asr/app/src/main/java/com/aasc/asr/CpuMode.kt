package com.aasc.asr

// 用户可选的 CPU 调度模式，数值写入 SharedPreferences，保持跨版本兼容。
enum class CpuMode(val persistedValue: Int, val displayName: String) {
    AUTO(0, "自动"),
    BIG(1, "大核"),
    LITTLE(2, "小核");

    companion object {
        fun fromPersistedValue(value: Int): CpuMode = values().firstOrNull { it.persistedValue == value } ?: AUTO
    }
}
