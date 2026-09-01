package com.aasc.rapidocr

import android.content.res.AssetManager
import java.io.File

// RapidOCR 模型的固定文件清单与 Gradle Copy 任务保持一致，避免 APK 缺少字典或某个推理阶段模型。
object RapidOcrModelFiles {
    const val ASSET_DIRECTORY = "rapidocr"

    val FILE_NAMES = listOf(
        "PP-OCRv6_det_small.onnx",
        "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        "PP-OCRv6_rec_small.onnx",
        "ppocrv6_dict.txt"
    )

    // 目录只有在所有文件都存在且非空时才可交给 ONNX Runtime，防止中断复制导致 native 加载崩溃。
    fun isComplete(modelDir: File): Boolean {
        return modelDir.isDirectory && FILE_NAMES.all { name ->
            val file = File(modelDir, name)
            file.isFile && file.length() > 0L
        }
    }

    // 每个文件先写入同目录临时文件，再改名覆盖目标；进程中断不会留下半个目标文件。
    fun ensureCopied(assetManager: AssetManager, modelDir: File) {
        if (isComplete(modelDir)) return
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建 RapidOCR 模型目录" }

        FILE_NAMES.forEach { name ->
            val destination = File(modelDir, name)
            val temporary = File(modelDir, "$name.tmp")
            try {
                assetManager.open("$ASSET_DIRECTORY/$name").use { input ->
                    temporary.outputStream().use { output -> input.copyTo(output) }
                }
                require(temporary.length() > 0L) { "RapidOCR 模型文件为空: $name" }
                require(temporary.renameTo(destination)) { "无法写入 RapidOCR 模型文件: $name" }
            } catch (error: Exception) {
                temporary.delete()
                throw error
            }
        }

        check(isComplete(modelDir)) { "RapidOCR 模型文件不完整" }
    }
}
