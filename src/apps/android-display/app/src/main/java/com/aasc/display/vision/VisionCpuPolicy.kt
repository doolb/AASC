package com.aasc.display.vision

import com.aasc.display.CpuPolicy
import com.aasc.display.CpuTopology

/**
 * 视觉推理专用 CPU 策略。
 *
 * 视觉能力不复用 ASR/TTS 的可配置 policy，默认只选一个小核，确保正式 APK
 * 的 OCR 和 YOLO 测试结果与此前单小核基准保持一致。
 */
object VisionCpuPolicy {
    const val ORT_INTRA_OP_THREADS = 1
    const val ORT_INTER_OP_THREADS = 1

    fun defaultFor(topology: CpuTopology): CpuPolicy {
        return topology.policy(bigCoreCount = 0, littleCoreCount = 1)
    }
}
