package com.aasc.rapidocr

import android.util.Log

// CPU affinity 的 Kotlin 安全边界；native 不可用或失败时不能影响 OCR 正确性。
object CpuAffinity {
    private const val TAG = "RapidOcrCpuAffinity"
    private val nativeAvailable: Boolean = try {
        System.loadLibrary("rapidocr_cpu_affinity")
        true
    } catch (error: Throwable) {
        warn("CPU affinity native 库不可用，使用 Android 默认调度: ${error.message}")
        false
    }

    fun apply(mode: CpuMode): String {
        if (!nativeAvailable) return "自动回退，CPU 绑定不可用"
        return try {
            nativeApply(mode.persistedValue)
        } catch (error: Throwable) {
            warn("CPU affinity 调用异常，使用 Android 默认调度: ${error.message}")
            "自动回退，CPU 绑定失败"
        }
    }

    private fun warn(message: String) {
        try {
            Log.w(TAG, message)
        } catch (_: Throwable) {
            // JVM 单元测试没有 Android Log 实现时，日志失败不能阻断服务初始化。
        }
    }

    @JvmStatic
    private external fun nativeApply(mode: Int): String
}
