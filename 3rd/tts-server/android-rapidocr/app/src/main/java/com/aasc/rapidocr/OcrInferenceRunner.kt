package com.aasc.rapidocr

// 将性能调度和 OCR 任务绑定在同一执行线程，避免只绑定 Activity 或 HTTP 接收线程。
class OcrInferenceRunner(
    private val modeProvider: () -> CpuMode,
    private val affinityApplier: (CpuMode) -> String = CpuAffinity::apply
) {
    fun <T> run(task: () -> T): T {
        val mode = try {
            modeProvider()
        } catch (error: Throwable) {
            CpuMode.AUTO
        }
        try {
            affinityApplier(mode)
        } catch (error: Throwable) {
            // affinity 只影响性能位置；即使外部实现异常，也必须继续 OCR 任务。
        }
        return task()
    }
}
