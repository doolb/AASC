package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class HttpJsonTest {
    @Test
    fun successJsonContainsStableFields() {
        assertEquals("{\"success\":true,\"text\":\"你好\",\"elapsedMs\":1234}", HttpJson.success("你好", 1234))
    }

    @Test
    fun successJsonReportsAsrDenoiseState() {
        val json = HttpJson.success("你好", 1234, true, 42)

        assertEquals(
            "{\"success\":true,\"text\":\"你好\",\"elapsedMs\":1234,\"denoise\":true,\"denoiseMs\":42}",
            json
        )
    }

    @Test
    fun errorJsonEscapesMessage() {
        assertEquals("{\"success\":false,\"error\":\"音频\\\"无效\",\"elapsedMs\":0}", HttpJson.error("音频\"无效"))
    }

    @Test
    fun voiceprintStatusListsSherpaModesOnly() {
        val json = HttpJson.voiceprintStatus(false, 512, emptyList(), 0.5f)
        assertEquals(
            "{\"modelReady\":false,\"embeddingDim\":512,\"registeredSpeakers\":0,\"speakers\":[],\"threshold\":0.5,\"modes\":[\"SHERPA_SINGLE\",\"SHERPA_MULTI\",\"SHERPA_MULTI_FAST\"]}",
            json
        )
    }

    @Test
    fun voiceprintResultReportsDenoiseStateAndElapsedTime() {
        val result = VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_SINGLE,
            denoise = true,
            denoiseMs = 42,
            asrDenoise = false,
            asrDenoiseMs = 0,
            voiceprintDenoise = true,
            voiceprintDenoiseMs = 42,
            embeddingDim = 512,
            matchedSpeaker = "ZH",
            similarityScore = 0.8125f,
            threshold = 0.5f,
            text = "你好",
            segments = emptyList(),
            elapsedMs = 123,
            diarizationMs = 0,
            embeddingMs = 10,
            asrMs = 20
        )

        val json = HttpJson.voiceprintResult(result)

        assertEquals(true, json.contains("\"denoise\":true"))
        assertEquals(true, json.contains("\"denoiseMs\":42"))
        assertEquals(true, json.contains("\"asrDenoise\":false"))
        assertEquals(true, json.contains("\"asrDenoiseMs\":0"))
        assertEquals(true, json.contains("\"voiceprintDenoise\":true"))
        assertEquals(true, json.contains("\"voiceprintDenoiseMs\":42"))
        assertEquals(true, json.contains("\"similarityScore\":0.8125"))
        assertEquals(true, json.contains("\"threshold\":0.5"))
    }

    @Test
    fun voiceprintResultReportsSegmentSimilarityScore() {
        val result = VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_MULTI,
            denoise = false,
            denoiseMs = 0,
            embeddingDim = 512,
            matchedSpeaker = null,
            similarityScore = null,
            threshold = 0.6f,
            text = "你好",
            segments = listOf(
                VoiceprintSegmentResult(
                    start = 0f,
                    end = 1f,
                    clusterId = 0,
                    speaker = null,
                    similarityScore = 0.42f,
                    text = "你好"
                )
            ),
            elapsedMs = 10,
            diarizationMs = 2,
            embeddingMs = 3,
            asrMs = 4
        )

        val json = HttpJson.voiceprintResult(result)

        assertEquals(true, json.contains("\"similarityScore\":null"))
        assertEquals(true, json.contains("\"threshold\":0.6"))
        assertEquals(true, json.contains("\"similarityScore\":0.42"))
    }
}
