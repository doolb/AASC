package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UiStatusTest {
    @Test
    fun resultStatusContainsTextAndElapsedMilliseconds() {
        assertEquals("识别完成，用时 1234 ms\n你好", UiStatus.result("你好", 1234))
    }

    @Test
    fun blankAudioIsRejectedBeforeEngineCall() {
        assertEquals("没有可识别的音频", UiStatus.validate(FloatArray(0)))
    }

    @Test
    fun voiceprintRegistrationStatusContainsRegistrationDetails() {
        val result = VoiceprintRegistrationResult(
            name = "z",
            embeddingDim = 512,
            denoise = true,
            denoiseMs = 12,
            voiceprintDenoise = true,
            voiceprintDenoiseMs = 12,
            elapsedMs = 120
        )

        val status = UiStatus.voiceprintRegistration(result)

        assertTrue(status.contains("注册成功：z"))
        assertTrue(status.contains("embedding 维度：512"))
        assertTrue(status.contains("声纹降噪：开启"))
        assertTrue(status.contains("声纹降噪耗时：12 ms"))
        assertTrue(status.contains("总耗时：120 ms"))
    }

    @Test
    fun voiceprintResultStatusContainsMatchAndUnmatchedSegmentDetails() {
        val result = VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_MULTI,
            denoise = false,
            denoiseMs = 0,
            asrDenoise = true,
            asrDenoiseMs = 8,
            voiceprintDenoise = false,
            voiceprintDenoiseMs = 0,
            embeddingDim = 512,
            matchedSpeaker = null,
            similarityScore = null,
            threshold = 0.3f,
            text = "你好啊。",
            segments = listOf(
                VoiceprintSegmentResult(
                    start = 0.1f,
                    end = 1.2f,
                    clusterId = 1,
                    speaker = "z",
                    similarityScore = 0.92f,
                    text = "你好啊。"
                ),
                VoiceprintSegmentResult(
                    start = 1.2f,
                    end = 1.8f,
                    clusterId = 2,
                    speaker = null,
                    similarityScore = 0.18f,
                    text = "你好。",
                    error = "未达到阈值"
                )
            ),
            elapsedMs = 100,
            diarizationMs = 10,
            embeddingMs = 20,
            asrMs = 30
        )

        val status = UiStatus.voiceprintResult(result)

        assertTrue(status.contains("模式：SHERPA_MULTI"))
        assertTrue(status.contains("ASR 文本：你好啊。"))
        assertTrue(status.contains("匹配声纹：未匹配"))
        assertTrue(status.contains("相似度：null"))
        assertTrue(status.contains("阈值：0.3"))
        assertTrue(status.contains("分段 1："))
        assertTrue(status.contains("speaker=z"))
        assertTrue(status.contains("similarityScore=0.92"))
        assertTrue(status.contains("分段 2："))
        assertTrue(status.contains("speaker=未识别"))
        assertTrue(status.contains("similarityScore=0.18"))
        assertTrue(status.contains("error=未达到阈值"))
        assertTrue(status.contains("diarization=10 ms"))
        assertTrue(status.contains("embedding=20 ms"))
        assertTrue(status.contains("asr=30 ms"))
    }
}
