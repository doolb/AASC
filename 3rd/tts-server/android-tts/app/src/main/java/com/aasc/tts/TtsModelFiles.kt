package com.aasc.tts

import android.content.res.AssetManager
import java.io.File

// 内置 Xiaoxiao 模型的固定文件清单。构建脚本与此清单保持一致，只打包 SDK 实际需要的文件。
object TtsModelFiles {
    const val ASSET_DIRECTORY = "tts"

    val FILE_NAMES = listOf(
        "2052.INI",
        "MSTTSLocEnUS.dat",
        "MSTTSLocZhCN.dat",
        "MSTTSLocZhCN.ini",
        "Tokens.xml",
        "ZhCN.address.dat",
        "ZhCN.message.dat",
        "ZhCN.mixlingual.dat",
        "ZhCN.name.dat",
        "am_v5_decoder.bin",
        "am_v5_encoder.bin",
        "device_vocoder_v6_streaming.bin",
        "phones.txt",
        "punc.txt"
    )

    // 只有全部模型文件存在时才视为可加载，避免把中断复制产生的目录交给 native SDK。
    fun isComplete(modelDir: File): Boolean {
        return modelDir.isDirectory && FILE_NAMES.all { name -> File(modelDir, name).isFile }
    }

    // 将 APK assets 逐文件复制到可被 EmbeddedSpeechConfig.fromPath 访问的私有目录。
    // 每个文件先写入同目录临时文件，再改名覆盖目标，进程中断时不会留下半个目标文件。
    fun ensureCopied(assetManager: AssetManager, modelDir: File) {
        if (isComplete(modelDir)) return
        require(modelDir.isDirectory || modelDir.mkdirs()) { "无法创建内置模型目录" }

        FILE_NAMES.forEach { name ->
            val destination = File(modelDir, name)
            val temporary = File(modelDir, "$name.tmp")
            try {
                assetManager.open("$ASSET_DIRECTORY/$name").use { input ->
                    temporary.outputStream().use { output -> input.copyTo(output) }
                }
                require(temporary.renameTo(destination)) { "无法写入模型文件: $name" }
            } catch (error: Exception) {
                temporary.delete()
                throw error
            }
        }

        check(isComplete(modelDir)) { "内置模型文件不完整" }
    }
}
