package com.aasc.display

import java.io.File

// 管理服务器下载的 Sherpa GTCRN 模型文件名和缓存完整性。
object DenoiseModelFiles {
    const val FILE_NAME = "gtcrn_simple.onnx"

    fun isComplete(modelDir: File): Boolean =
        File(modelDir, FILE_NAME).isFile && File(modelDir, FILE_NAME).length() > 0L
}
