package com.aasc.display.vision.ocr

import android.graphics.Bitmap
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession

/** 运行 PP-OCRv6 识别模型并将序列输出解码为文本。 */
object RecognitionDecoder {
    private const val INPUT_HEIGHT = 48
    private const val INPUT_WIDTH = 320

    fun decode(crop: Bitmap, session: OrtSession, environment: OrtEnvironment, dictionary: List<String>): DecodedText {
        val input = RapidOcrOrtUtils.bitmapToPaddedNchw(crop, INPUT_HEIGHT, INPUT_WIDTH)
        val inputTensor = RapidOcrOrtUtils.createInput(environment, input, longArrayOf(1, 3, INPUT_HEIGHT.toLong(), INPUT_WIDTH.toLong()))
        return try {
            val inputName = session.inputNames.firstOrNull() ?: error("文字识别模型缺少输入")
            session.run(mapOf(inputName to inputTensor)).use { result ->
                val output = RapidOcrOrtUtils.readFloatTensor(result)
                val classCount = output.shape.lastOrNull()?.toInt() ?: 0
                val timeSteps = output.shape.getOrNull(output.shape.lastIndex - 1)?.toInt() ?: 0
                require(classCount > 0 && timeSteps > 0) { "文字识别输出形状无效" }
                require(output.values.size >= classCount * timeSteps) { "文字识别输出数据长度不足" }
                CtcDecoder.decode(Array(timeSteps) { time ->
                    output.values.copyOfRange(time * classCount, (time + 1) * classCount)
                }, dictionary)
            }
        } finally {
            inputTensor.close()
        }
    }
}
