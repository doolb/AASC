package com.aasc.display.vision.ocr

import kotlin.math.abs
import kotlin.math.exp

/** PP-OCR CTC 解码器，第 0 类固定为 blank。 */
object CtcDecoder {
    fun decode(logits: Array<FloatArray>, dictionary: List<String>): DecodedText {
        if (logits.isEmpty()) return DecodedText("", 0f)
        val text = StringBuilder()
        var confidenceSum = 0f
        var emittedCount = 0
        var previousIndex = -1
        logits.forEach { timestep ->
            require(timestep.isNotEmpty()) { "CTC 输出时间步不能为空" }
            val bestIndex = timestep.indices.maxByOrNull { timestep[it] } ?: 0
            if (bestIndex != 0 && bestIndex != previousIndex) {
                val dictionaryIndex = bestIndex - 1
                require(dictionaryIndex in dictionary.indices) { "CTC 输出索引超出字典范围: $bestIndex" }
                text.append(dictionary[dictionaryIndex])
                confidenceSum += confidenceOf(timestep, bestIndex)
                emittedCount += 1
            }
            previousIndex = bestIndex
        }
        return DecodedText(text.toString(), if (emittedCount == 0) 0f else confidenceSum / emittedCount)
    }

    private fun confidenceOf(values: FloatArray, bestIndex: Int): Float {
        val sum = values.sum()
        if (values.all { it in 0f..1f } && abs(sum - 1f) < 0.05f) return values[bestIndex]
        val maxValue = values.maxOrNull() ?: 0f
        val denominator = values.sumOf { value -> exp((value - maxValue).toDouble()) }
        return (exp((values[bestIndex] - maxValue).toDouble()) / denominator).toFloat()
    }
}
