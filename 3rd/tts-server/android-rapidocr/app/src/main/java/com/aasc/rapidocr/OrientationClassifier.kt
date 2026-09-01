package com.aasc.rapidocr

import android.graphics.Bitmap
import android.graphics.Matrix
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession

/** 使用 PP-OCR 方向分类模型纠正倒置的文字裁剪图。 */
object OrientationClassifier {
    private const val INPUT_HEIGHT = 48
    private const val INPUT_WIDTH = 192
    private const val ROTATE_INDEX = 1
    private const val ROTATE_THRESHOLD = 0.9f

    fun correct(crop: Bitmap, session: OrtSession, environment: OrtEnvironment): Bitmap {
        val input = RapidOcrOrtUtils.bitmapToPaddedNchw(crop, INPUT_HEIGHT, INPUT_WIDTH)
        val inputTensor = RapidOcrOrtUtils.createInput(environment, input, longArrayOf(1, 3, INPUT_HEIGHT.toLong(), INPUT_WIDTH.toLong()))
        return try {
            val scores = runScores(session, inputTensor)
            val rotateScore = scores.getOrElse(ROTATE_INDEX) { 0f }
            if (rotateScore < ROTATE_THRESHOLD) crop else rotate180(crop)
        } finally {
            inputTensor.close()
        }
    }

    private fun runScores(session: OrtSession, inputTensor: OnnxTensor): FloatArray {
        val inputName = session.inputNames.firstOrNull() ?: throw IllegalStateException("方向分类模型缺少输入")
        session.run(mapOf(inputName to inputTensor)).use { result ->
            return RapidOcrOrtUtils.readFloatTensor(result).values
        }
    }

    private fun rotate180(bitmap: Bitmap): Bitmap {
        val matrix = Matrix().apply { postRotate(180f) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}
