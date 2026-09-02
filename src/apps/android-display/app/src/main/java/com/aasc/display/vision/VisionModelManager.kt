package com.aasc.display.vision

import android.content.Context
import com.aasc.display.RemoteModelInstall
import com.aasc.display.RemoteModelManager
import com.aasc.display.vision.yolo.YoloModel
import java.io.File

/** 正式 APK 视觉模型按需从服务器下载；目录只保存当前设备已校验的模型缓存。 */
class VisionModelManager(context: Context) {
    private val appContext = context.applicationContext
    private val remoteManager = RemoteModelManager()
    private val modelRoot = File(appContext.filesDir, "models/vision")

    fun ensureRapidOcr(baseUrl: String, onProgress: (Int) -> Unit = {}): RemoteModelInstall =
        remoteManager.ensureModel(
            baseUrl = baseUrl,
            manifestPath = "/api/vision/model-manifest",
            downloadPath = "/api/vision/model",
            modelId = RAPID_OCR_MODEL_ID,
            directory = File(modelRoot, "rapidocr"),
            onProgress = onProgress
        )

    fun ensureYolo(model: YoloModel, baseUrl: String, onProgress: (Int) -> Unit = {}): RemoteModelInstall =
        remoteManager.ensureModel(
            baseUrl = baseUrl,
            manifestPath = "/api/vision/model-manifest",
            downloadPath = "/api/vision/model",
            modelId = model.id,
            directory = File(modelRoot, "yolo11/${model.id}"),
            onProgress = onProgress
        )

    fun finalizeInstall(install: RemoteModelInstall) = remoteManager.finalizeInstall(install)

    fun rollbackInstall(install: RemoteModelInstall): RemoteModelInstall? = remoteManager.rollbackInstall(install)

    companion object {
        const val RAPID_OCR_MODEL_ID = "rapidocr"
    }
}
