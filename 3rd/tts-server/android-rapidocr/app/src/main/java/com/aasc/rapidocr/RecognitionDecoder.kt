package com.aasc.rapidocr

import android.graphics.Bitmap
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession

/** 运行 PP-OCRv6 识别模型并将序列输出解码为文本。 */
object RecognitionDecoder {
    private const val INPUT_HEIGHT = 48
    private const val INPUT_WIDTH = 320

    fun decode(
        crop: Bitmap,
        session: OrtSession,
        environment: OrtEnvironment,
        dictionary: List<String>
    ): DecodedText {
        val input = RapidOcrOrtUtils.bitmapToPaddedNchw(crop, INPUT_HEIGHT, INPUT_WIDTH)
        val inputTensor = RapidOcrOrtUtils.createInput(environment, input, longArrayOf(1, 3, INPUT_HEIGHT.toLong(), INPUT_WIDTH.toLong()))
        return try {
            runAndDecode(session, inputTensor, dictionary)
        } finally {
            inputTensor.close()
        }
    }

    private fun runAndDecode(
        session: OrtSession,
        inputTensor: OnnxTensor,
        dictionary: List<String>
    ): DecodedText {
        val inputName = session.inputNames.firstOrNull() ?: throw IllegalStateException("文字识别模型缺少输入")
        session.run(mapOf(inputName to inputTensor)).use { result ->
            val output = RapidOcrOrtUtils.readFloatTensor(result)
            val classCount = output.shape.lastOrNull()?.toInt() ?: 0
            val timeSteps = output.shape.getOrNull(output.shape.lastIndex - 1)?.toInt() ?: 0
            require(classCount > 0 && timeSteps > 0) { "文字识别输出形状无效" }
            require(output.values.size >= classCount * timeSteps) { "文字识别输出数据长度不足" }

            val logits = Array(timeSteps) { time ->
                output.values.copyOfRange(time * classCount, (time + 1) * classCount)
            }
            return CtcDecoder.decode(logits, dictionary)
        }
    }
}
