package com.aasc.tts

// TTS 合成 CPU 模式的稳定配置值，持久化时只保存整数，不依赖枚举声明顺序以外的字符串。
enum class CpuMode(val persistedValue: Int, val displayName: String) {
    AUTO(0, "自动"),
    BIG(1, "大核"),
    LITTLE(2, "小核");

    companion object {
        // 配置文件被手工修改或来自未来版本时，安全回退到系统自动调度。
        fun fromPersistedValue(value: Int): CpuMode {
            return entries.firstOrNull { mode -> mode.persistedValue == value } ?: AUTO
        }
    }
}
