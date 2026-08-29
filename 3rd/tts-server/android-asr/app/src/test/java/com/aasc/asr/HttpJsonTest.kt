package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class HttpJsonTest {
    @Test
    fun successJsonContainsStableFields() {
        assertEquals("{\"success\":true,\"text\":\"你好\",\"elapsedMs\":1234}", HttpJson.success("你好", 1234))
    }

    @Test
    fun errorJsonEscapesMessage() {
        assertEquals("{\"success\":false,\"error\":\"音频\\\"无效\",\"elapsedMs\":0}", HttpJson.error("音频\"无效"))
    }

    @Test
    fun voiceprintStatusListsSherpaModesOnly() {
        val json = HttpJson.voiceprintStatus(false, 512, emptyList())
        assertEquals(
            "{\"modelReady\":false,\"embeddingDim\":512,\"registeredSpeakers\":0,\"speakers\":[],\"modes\":[\"SHERPA_SINGLE\",\"SHERPA_MULTI\",\"SHERPA_MULTI_FAST\"]}",
            json
        )
    }

    @Test
    fun voiceprintResultReportsDenoiseStateAndElapsedTime() {
        val result = VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_SINGLE,
            denoise = true,
            denoiseMs = 42,
            embeddingDim = 512,
            matchedSpeaker = "ZH",
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
    }
}
