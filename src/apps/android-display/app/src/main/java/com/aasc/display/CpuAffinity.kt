package com.aasc.display

import android.util.Log

object CpuAffinity {
    private const val TAG = "CpuAffinity"

    private val nativeAvailable: Boolean = try {
        System.loadLibrary("cpu_affinity")
        true
    } catch (e: UnsatisfiedLinkError) {
        Log.w(TAG, "CPU affinity native 库不可用，使用 Android 默认调度: ${e.message}")
        false
    }

    fun applyCurrentThread(cpuMask: Long): Boolean {
        if (cpuMask <= 0L) {
            Log.w(TAG, "CPU affinity mask 为空，使用 Android 默认调度")
            return false
        }
        if (!nativeAvailable) return false
        return try {
            val applied = nativeApplyCurrentThread(cpuMask)
            if (!applied) {
                Log.w(TAG, "sched_setaffinity 失败，使用 Android 默认调度 mask=$cpuMask")
            }
            applied
        } catch (e: Throwable) {
            Log.w(TAG, "CPU affinity 调用异常，使用 Android 默认调度: ${e.message}")
            false
        }
    }

    private external fun nativeApplyCurrentThread(cpuMask: Long): Boolean
}
