package com.aasc.yolo

/**
 * CPU affinity 的 Kotlin 安全边界。native 绑定失败只能影响性能位置，不能让检测请求失败。
 */
object CpuAffinity {
    private var nativeAvailable = true

    init {
        try {
            System.loadLibrary("yolo_cpu_affinity")
        } catch (_: UnsatisfiedLinkError) {
            nativeAvailable = false
        }
    }

    fun apply(mode: CpuMode): String {
        if (!nativeAvailable) return "自动回退，CPU 绑定库不可用"
        return try {
            nativeApply(mode.persistedValue)
        } catch (_: UnsatisfiedLinkError) {
            nativeAvailable = false
            "自动回退，CPU 绑定库不可用"
        } catch (_: Exception) {
            "自动回退，CPU 绑定失败"
        }
    }

    private external fun nativeApply(mode: Int): String
}
