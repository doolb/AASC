package com.aasc.rapidocr

import kotlin.math.exp
import kotlin.math.abs

/**
 * PP-OCR 识别输出的 CTC 解码器。
 * 模型输出的第 0 类固定作为 blank，字典第 n 项对应模型输出的第 n + 1 类。
 */
object CtcDecoder {
    fun decode(logits: Array<FloatArray>, dictionary: List<String>): DecodedText {
        if (logits.isEmpty()) {
            return DecodedText(text = "", score = 0f)
        }

        val text = StringBuilder()
        var confidenceSum = 0f
        var emittedCount = 0
        var previousIndex = -1

        logits.forEach { timestep ->
            require(timestep.isNotEmpty()) { "CTC 输出时间步不能为空" }
            val bestIndex = timestep.indices.maxByOrNull { timestep[it] } ?: 0
            val confidence = confidenceOf(timestep, bestIndex)

            if (bestIndex != 0 && bestIndex != previousIndex) {
                val dictionaryIndex = bestIndex - 1
                require(dictionaryIndex in dictionary.indices) {
                    "CTC 输出索引超出字典范围: $bestIndex"
                }
                text.append(dictionary[dictionaryIndex])
                confidenceSum += confidence
                emittedCount += 1
            }
            previousIndex = bestIndex
        }

        val meanConfidence = if (emittedCount == 0) 0f else confidenceSum / emittedCount
        return DecodedText(text = text.toString(), score = meanConfidence)
    }

    /** 兼容 PP-OCR 已 softmax 的概率输出和通用测试使用的原始 logits。 */
    private fun confidenceOf(values: FloatArray, bestIndex: Int): Float {
        val sum = values.sum()
        if (values.all { it in 0f..1f } && abs(sum - 1f) < 0.05f) return values[bestIndex]

        val maxValue = values.maxOrNull() ?: 0f
        val denominator = values.sumOf { value -> exp((value - maxValue).toDouble()) }
        return (exp((values[bestIndex] - maxValue).toDouble()) / denominator).toFloat()
    }
}
