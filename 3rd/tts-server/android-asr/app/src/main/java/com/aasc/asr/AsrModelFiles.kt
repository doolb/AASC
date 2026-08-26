package com.aasc.asr

import android.content.res.AssetManager
import java.io.File

// 管理 APK 内置的 SenseVoice 文件，先写临时文件再改名，避免进程中断留下半个模型。
object AsrModelFiles {
    val FILE_NAMES = listOf("model.int8.onnx", "tokens.txt")

    fun isComplete(modelDir: File): Boolean =
        modelDir.isDirectory && FILE_NAMES.all { File(modelDir, it).isFile }

    fun ensureCopied(assetManager: AssetManager, modelDir: File) {
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建 ASR 模型目录" }
        FILE_NAMES.forEach { name ->
            val destination = File(modelDir, name)
            if (destination.isFile) return@forEach
            val temporary = File(modelDir, "$name.tmp")
            try {
                assetManager.open("asr/$name").use { input ->
                    temporary.outputStream().use { output -> input.copyTo(output) }
                }
                if (!temporary.renameTo(destination)) {
                    temporary.copyTo(destination, overwrite = true)
                    temporary.delete()
                }
            } catch (error: Exception) {
                temporary.delete()
                throw IllegalStateException("无法安装 ASR 模型文件：$name", error)
            }
        }
    }
}
