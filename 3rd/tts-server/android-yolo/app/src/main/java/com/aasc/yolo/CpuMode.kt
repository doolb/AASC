package com.aasc.yolo

/** YOLO 推理线程的 CPU 调度模式；数值用于 SharedPreferences 持久化。 */
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
        fun fromPersistedValue(value: Int): CpuMode = entries.firstOrNull { it.persistedValue == value } ?: AUTO
    }
}
