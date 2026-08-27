package com.aasc.asr

import android.content.res.AssetManager
import java.io.File

// 管理流式 Zipformer 模型文件，所有文件复制完成后才允许引擎加载。
object StreamingAsrModelFiles {
    val FILE_NAMES = listOf(
        "encoder.int8.onnx",
        "decoder.int8.onnx",
        "joiner.int8.onnx",
        "tokens.txt"
    )

    fun isComplete(modelDir: File): Boolean =
        modelDir.isDirectory && FILE_NAMES.all { File(modelDir, it).isFile }

    fun ensureCopied(assetManager: AssetManager, modelDir: File) {
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建流式 ASR 模型目录" }
        FILE_NAMES.forEach { name ->
            val destination = File(modelDir, name)
            if (destination.isFile) return@forEach
            val temporary = File(modelDir, "$name.tmp")
            try {
                assetManager.open("streaming/$name").use { input ->
                    temporary.outputStream().use { output -> input.copyTo(output) }
                }
                if (!temporary.renameTo(destination)) {
                    temporary.copyTo(destination, overwrite = true)
                    temporary.delete()
                }
            } catch (error: Exception) {
                temporary.delete()
                throw IllegalStateException("无法安装流式 ASR 模型文件：$name", error)
            }
        }
    }
}
