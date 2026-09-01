package com.aasc.yolo

import android.content.res.AssetManager
import java.io.File

/** 管理五个 ONNX 资源从 APK assets 到应用私有目录的安全复制。 */
object YoloModelFiles {
    const val ASSET_DIRECTORY = "yolo11"
    val FILE_NAMES: List<String> = YoloModel.entries.map { it.fileName }

    fun isComplete(modelDir: File): Boolean {
        return modelDir.isDirectory && FILE_NAMES.all { name ->
            val file = File(modelDir, name)
            file.isFile && file.length() > 0L
        }
    }

    fun ensureCopied(assetManager: AssetManager, modelDir: File) {
        if (isComplete(modelDir)) return
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建 YOLO11 模型目录" }
        for (name in FILE_NAMES) {
            val destination = File(modelDir, name)
            val temporary = File(modelDir, "$name.tmp")
            assetManager.open("$ASSET_DIRECTORY/$name").use { input ->
                temporary.outputStream().use { output -> input.copyTo(output) }
            }
            require(temporary.length() > 0L) { "YOLO11 模型文件为空: $name" }
            require(temporary.renameTo(destination)) { "无法写入 YOLO11 模型文件: $name" }
        }
        check(isComplete(modelDir)) { "YOLO11 模型文件不完整" }
    }
}
