package com.aasc.asr

// 统一解析网页查询参数，避免注册和测试接口对开关值的解释不一致。
object DenoiseOption {
    fun parse(value: String?): Boolean = when (value?.trim()?.lowercase()) {
        "1", "true", "on", "yes" -> true
        else -> false
    }
}
