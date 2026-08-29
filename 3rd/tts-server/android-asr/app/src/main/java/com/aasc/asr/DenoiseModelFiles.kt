package com.aasc.asr

import android.content.res.AssetManager
import java.io.File

// 管理 APK 内置的 Sherpa GTCRN 模型，使用临时文件安装避免留下不完整模型。
object DenoiseModelFiles {
    val FILE_NAMES = listOf("gtcrn_simple.onnx")

    fun isComplete(modelDir: File): Boolean =
        modelDir.isDirectory && FILE_NAMES.all { File(modelDir, it).isFile }

    fun ensureCopied(assetManager: AssetManager, modelDir: File) {
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建降噪模型目录" }
        FILE_NAMES.forEach { name ->
            val destination = File(modelDir, name)
            if (destination.isFile) return@forEach
            val temporary = File(modelDir, "$name.tmp")
            try {
                assetManager.open("speech-enhancement/$name").use { input ->
                    temporary.outputStream().use { output -> input.copyTo(output) }
                }
                if (!temporary.renameTo(destination)) {
                    temporary.copyTo(destination, overwrite = true)
                    temporary.delete()
                }
            } catch (error: Exception) {
                temporary.delete()
                throw IllegalStateException("无法安装降噪模型文件：$name", error)
            }
        }
    }
}
