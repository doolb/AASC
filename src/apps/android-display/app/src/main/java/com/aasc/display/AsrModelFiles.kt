package com.aasc.display

import java.io.File

// 模型文件完整性校验（纯逻辑，JVM 可测）。SenseVoice int8 实际约 234MB，50MB 阈值做损坏兜底
object AsrModelFiles {
    const val MIN_MODEL_SIZE_BYTES = 50L * 1024 * 1024

    // 是否需要（重新）下载：缺任一文件，或模型文件过小视为损坏
    fun needsDownload(modelFile: File, tokensFile: File): Boolean {
        if (!modelFile.isFile || !tokensFile.isFile) return true
        return modelFile.length() < MIN_MODEL_SIZE_BYTES
    }

    // 清理损坏的模型文件（下载/加载自检失败后调用）
    fun purge(modelFile: File, tokensFile: File) {
        modelFile.delete()
        tokensFile.delete()
        File(modelFile.parentFile, modelFile.name + ".tmp").delete()
        File(tokensFile.parentFile, tokensFile.name + ".tmp").delete()
    }
}
