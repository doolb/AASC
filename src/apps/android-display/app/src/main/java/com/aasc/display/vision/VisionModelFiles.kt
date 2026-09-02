package com.aasc.display.vision

import android.content.res.AssetManager
import java.io.File

/** 统一管理正式 APK 视觉模型资产，防止复制中断后把半个模型交给 native。 */
object VisionModelFiles {
    const val RAPID_OCR_ASSET_DIRECTORY = "vision/rapidocr"
    const val YOLO_ASSET_DIRECTORY = "vision/yolo11"

    val RAPID_OCR_FILE_NAMES = listOf(
        "PP-OCRv6_det_small.onnx",
        "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        "PP-OCRv6_rec_small.onnx",
        "ppocrv6_dict.txt"
    )
    val YOLO_FILE_NAMES = listOf("yolo11n.onnx")

    fun isRapidOcrComplete(modelDir: File): Boolean = isComplete(modelDir, RAPID_OCR_FILE_NAMES)

    fun isYoloComplete(modelDir: File): Boolean = isComplete(modelDir, YOLO_FILE_NAMES)

    fun ensureRapidOcrCopied(assetManager: AssetManager, modelDir: File) {
        copyFilesIfNeeded(assetManager, modelDir, RAPID_OCR_ASSET_DIRECTORY, RAPID_OCR_FILE_NAMES, "RapidOCR")
    }

    fun ensureYoloCopied(assetManager: AssetManager, modelDir: File) {
        copyFilesIfNeeded(assetManager, modelDir, YOLO_ASSET_DIRECTORY, YOLO_FILE_NAMES, "YOLO11n")
    }

    private fun isComplete(modelDir: File, fileNames: List<String>): Boolean {
        return modelDir.isDirectory && fileNames.all { name ->
            val file = File(modelDir, name)
            file.isFile && file.length() > 0L
        }
    }

    private fun copyFilesIfNeeded(
        assetManager: AssetManager,
        modelDir: File,
        assetDirectory: String,
        fileNames: List<String>,
        modelLabel: String
    ) {
        if (isComplete(modelDir, fileNames)) return
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建 $modelLabel 模型目录" }
        fileNames.forEach { name ->
            val destination = File(modelDir, name)
            val temporary = File(modelDir, "$name.tmp")
            try {
                assetManager.open("$assetDirectory/$name").use { input ->
                    temporary.outputStream().use { output -> input.copyTo(output) }
                }
                require(temporary.length() > 0L) { "$modelLabel 模型文件为空: $name" }
                require(temporary.renameTo(destination)) { "无法写入 $modelLabel 模型文件: $name" }
            } catch (error: Exception) {
                temporary.delete()
                throw error
            }
        }
        check(isComplete(modelDir, fileNames)) { "$modelLabel 模型文件不完整" }
    }
}
