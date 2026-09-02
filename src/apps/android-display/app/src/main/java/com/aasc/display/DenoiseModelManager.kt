package com.aasc.display

import android.content.Context
import java.io.File

/** 正式 APK 的 GTCRN 模型按需下载管理器，下载完成后才交给 Sherpa 加载。 */
class DenoiseModelManager(context: Context) {
    private val appContext = context.applicationContext
    private val remoteManager = RemoteModelManager()
    private val modelDirectory = File(appContext.filesDir, "models/speech-enhancement")

    fun ensureModel(baseUrl: String, onProgress: (Int) -> Unit = {}): RemoteModelInstall =
        remoteManager.ensureModel(
            baseUrl = baseUrl,
            manifestPath = "/api/speech-enhancement/model-manifest",
            downloadPath = "/api/speech-enhancement/model",
            modelId = "gtcrn",
            directory = modelDirectory,
            includeModelId = false,
            onProgress = onProgress
        )
}
