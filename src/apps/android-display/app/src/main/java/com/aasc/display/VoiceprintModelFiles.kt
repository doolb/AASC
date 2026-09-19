package com.aasc.display

import java.io.File

/** 声纹内置模型文件名和完整性下限，供 Offline Runtime 校验及模型管理器复用。 */
object VoiceprintModelFiles {
    const val EMBEDDING_FILE_NAME = "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
    const val SEGMENTATION_FILE_NAME = "pyannote_segmentation_3_0_int8.onnx"
    const val MIN_EMBEDDING_BYTES = 5L * 1024 * 1024
    const val MIN_SEGMENTATION_BYTES = 500L * 1024

    fun isComplete(directory: File, needSegmentation: Boolean): Boolean {
        val embedding = File(directory, EMBEDDING_FILE_NAME)
        if (!embedding.isFile || embedding.length() <= MIN_EMBEDDING_BYTES) return false
        if (!needSegmentation) return true
        val segmentation = File(directory, SEGMENTATION_FILE_NAME)
        return segmentation.isFile && segmentation.length() > MIN_SEGMENTATION_BYTES
    }
}
