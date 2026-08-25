package com.aasc.tts

// 将 native 返回的实际核心/回退结果统一转换为用户能理解的状态行。
object CpuModeStatus {
    fun ready(appliedStatus: String): String {
        return "CPU 模式：$appliedStatus"
    }
}
