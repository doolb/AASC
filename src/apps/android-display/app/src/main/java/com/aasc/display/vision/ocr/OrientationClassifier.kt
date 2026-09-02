package com.aasc.display.vision.ocr

import android.graphics.Bitmap
import android.graphics.Matrix
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession

/** 使用 PP-OCR 方向分类模型纠正倒置文字裁剪图。 */
object OrientationClassifier {
    private const val INPUT_HEIGHT = 48
    private const val INPUT_WIDTH = 192
    private const val ROTATE_INDEX = 1
    private const val ROTATE_THRESHOLD = 0.9f

    fun correct(crop: Bitmap, session: OrtSession, environment: OrtEnvironment): Bitmap {
        val input = RapidOcrOrtUtils.bitmapToPaddedNchw(crop, INPUT_HEIGHT, INPUT_WIDTH)
        val inputTensor = RapidOcrOrtUtils.createInput(environment, input, longArrayOf(1, 3, INPUT_HEIGHT.toLong(), INPUT_WIDTH.toLong()))
        return try {
            val inputName = session.inputNames.firstOrNull() ?: error("方向分类模型缺少输入")
            val scores = session.run(mapOf(inputName to inputTensor)).use { RapidOcrOrtUtils.readFloatTensor(it).values }
            if (scores.getOrElse(ROTATE_INDEX) { 0f } < ROTATE_THRESHOLD) crop else rotate180(crop)
        } finally {
            inputTensor.close()
        }
    }

    private fun rotate180(bitmap: Bitmap): Bitmap = Bitmap.createBitmap(
        bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(180f) }, true
    )
}
