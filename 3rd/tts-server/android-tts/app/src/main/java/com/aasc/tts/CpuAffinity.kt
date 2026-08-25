package com.aasc.tts

// CPU affinity 的 Kotlin 安全边界。native 不可用时始终返回自动回退文案，不能影响 TTS 主流程。
object CpuAffinity {
    private val nativeAvailable: Boolean = try {
        System.loadLibrary("cpu-affinity")
        true
    } catch (_: UnsatisfiedLinkError) {
        false
    }

    fun apply(mode: CpuMode): String {
        if (!nativeAvailable) return "自动回退，CPU 绑定不可用"
        return try {
            nativeApply(mode.persistedValue)
        } catch (_: UnsatisfiedLinkError) {
            "自动回退，CPU 绑定不可用"
        } catch (_: RuntimeException) {
            "自动回退，CPU 绑定失败"
        }
    }

    @JvmStatic
    private external fun nativeApply(mode: Int): String
}
