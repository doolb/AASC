package com.aasc.display

import java.io.File

// TTS 嵌入式模型文件清单与完整性校验（纯逻辑，JVM 可测）
// 模型目录为 zh-CN（Xiaoxiao）嵌入式语音合成模型，共 14 个文件
object TtsModelFiles {

    // 模型包含的全部文件名（与服务器 manifest.json 一一对应）
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

    // 主语言模型文件（zh-CN locale data），实际约 48MB；40MB 阈值做损坏兜底
    private const val MIN_MAIN_FILE_BYTES = 40L * 1024 * 1024

    // 是否需要（重新）下载：缺任一文件，或主模型文件过小视为损坏
    fun needsDownload(modelDir: File): Boolean {
        if (!modelDir.isDirectory) return true
        for (name in FILE_NAMES) {
            val f = File(modelDir, name)
            if (!f.isFile) return true
        }
        // 主模型文件过小视为损坏
        val mainFile = File(modelDir, "MSTTSLocZhCN.dat")
        return mainFile.length() < MIN_MAIN_FILE_BYTES
    }

    // 清理损坏的模型文件（下载/加载失败后调用，含 .tmp 残件）
    fun purge(modelDir: File) {
        for (name in FILE_NAMES) {
            File(modelDir, name).delete()
            File(modelDir, "$name.tmp").delete()
        }
    }
}
