package com.aasc.asr

import android.content.res.AssetManager
import java.io.File

// 管理 APK 内置的 Sherpa 声纹模型，使用临时文件安装，避免中断时留下不完整模型。
object VoiceprintModelFiles {
    const val SEGMENTATION_FILE_NAME = "pyannote_segmentation_3_0_int8.onnx"
    val ALL_FILE_NAMES = VoiceprintModel.values()
        .flatMap { model -> VoiceprintPrecision.values().map { model.variant(it).embeddingFileName } } +
        SEGMENTATION_FILE_NAME

    data class Paths(
        val embedding: File,
        val segmentation: File
    )

    fun paths(modelDir: File, variant: VoiceprintModelVariant): Paths = Paths(
        embedding = File(modelDir, variant.embeddingFileName),
        segmentation = File(modelDir, SEGMENTATION_FILE_NAME)
    )

    fun paths(modelDir: File, model: VoiceprintModel): Paths = paths(modelDir, model.variant(VoiceprintPrecision.FP32))

    fun isComplete(modelDir: File): Boolean =
        modelDir.isDirectory && ALL_FILE_NAMES.all { File(modelDir, it).isFile }

    fun ensureCopied(assetManager: AssetManager, modelDir: File) {
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建声纹模型目录" }
        ALL_FILE_NAMES.forEach { name ->
            val destination = File(modelDir, name)
            if (destination.isFile) return@forEach
            val temporary = File(modelDir, "$name.tmp")
            try {
                assetManager.open("voiceprint/$name").use { input ->
                    temporary.outputStream().use { output -> input.copyTo(output) }
                }
                if (!temporary.renameTo(destination)) {
                    temporary.copyTo(destination, overwrite = true)
                    temporary.delete()
                }
            } catch (error: Exception) {
                temporary.delete()
                throw IllegalStateException("无法安装声纹模型文件：$name", error)
            }
        }
    }
}
