package com.aasc.display

import kotlin.math.sqrt

// 声纹诊断分数计算器：只计算 embedding 与注册向量的余弦相似度，不替代 Sherpa 的命中判定。
// 分数用于结果展示和调阈值，避免把诊断分数与 SpeakerEmbeddingManager 的内部搜索行为混为一谈。
object VoiceprintSimilarity {
    fun cosine(left: FloatArray, right: FloatArray): Float? {
        if (left.isEmpty() || left.size != right.size) return null

        var dot = 0.0
        var leftNorm = 0.0
        var rightNorm = 0.0
        left.indices.forEach { index ->
            val leftValue = left[index].toDouble()
            val rightValue = right[index].toDouble()
            dot += leftValue * rightValue
            leftNorm += leftValue * leftValue
            rightNorm += rightValue * rightValue
        }

        val denominator = sqrt(leftNorm) * sqrt(rightNorm)
        if (denominator <= 0.0) return null
        val score = (dot / denominator).toFloat()
        return score.takeUnless { it.isNaN() || it.isInfinite() }
    }
}
