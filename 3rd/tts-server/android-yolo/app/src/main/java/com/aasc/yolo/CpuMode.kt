package com.aasc.yolo

/** YOLO 推理线程的 CPU 调度模式；数值用于 SharedPreferences 持久化。 */
enum class CpuMode(
    val persistedValue: Int,
    val displayName: String
) {
    AUTO(0, "自动"),
    BIG(1, "大核"),
    LITTLE(2, "小核");

    companion object {
        fun fromPersistedValue(value: Int): CpuMode = entries.firstOrNull { it.persistedValue == value } ?: AUTO
    }
}
