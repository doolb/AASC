package com.aasc.display

import android.content.res.AssetManager
import java.io.File

// 管理 APK 内置的 Sherpa GTCRN 模型，使用临时文件安装，避免留下半截模型。
object DenoiseModelFiles {
    const val FILE_NAME = "gtcrn_simple.onnx"

    fun ensureCopied(assetManager: AssetManager, modelDir: File): File {
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建降噪模型目录" }
        val destination = File(modelDir, FILE_NAME)
        if (destination.isFile && destination.length() > 500 * 1024) return destination
        val temporary = File(modelDir, "$FILE_NAME.tmp")
        try {
            assetManager.open("speech-enhancement/$FILE_NAME").use { input ->
                temporary.outputStream().use { output -> input.copyTo(output) }
            }
            if (!temporary.renameTo(destination)) {
                temporary.copyTo(destination, overwrite = true)
                temporary.delete()
            }
            return destination
        } catch (error: Exception) {
            temporary.delete()
            throw IllegalStateException("无法安装降噪模型文件", error)
        }
    }
}
