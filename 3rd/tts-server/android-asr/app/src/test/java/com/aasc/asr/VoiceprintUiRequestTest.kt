package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceprintUiRequestTest {
    @Test
    fun singleModeAlwaysUsesAutoSpeakerCount() {
        val request = VoiceprintUiRequest.create(
            VoiceprintMode.SHERPA_SINGLE,
            selectedSpeakerCount = 3,
            asrDenoise = false,
            voiceprintDenoise = true
        )

        assertEquals(VoiceprintSpeakerCount.AUTO, request.speakerCount)
    }

    @Test
    fun multiModesPreserveValidatedSpeakerCount() {
        val normal = VoiceprintUiRequest.create(
            VoiceprintMode.SHERPA_MULTI,
            selectedSpeakerCount = 2,
            asrDenoise = true,
            voiceprintDenoise = false
        )
        val fast = VoiceprintUiRequest.create(
            VoiceprintMode.SHERPA_MULTI_FAST,
            selectedSpeakerCount = VoiceprintSpeakerCount.AUTO,
            asrDenoise = true,
            voiceprintDenoise = false
        )

        assertEquals(2, normal.speakerCount)
        assertEquals(VoiceprintSpeakerCount.AUTO, fast.speakerCount)
    }

    @Test
    fun asrAndVoiceprintDenoiseFlagsRemainIndependent() {
        val request = VoiceprintUiRequest.create(
            VoiceprintMode.SHERPA_MULTI,
            selectedSpeakerCount = 1,
            asrDenoise = true,
            voiceprintDenoise = false
        )

        assertEquals(true, request.asrDenoise)
        assertEquals(false, request.voiceprintDenoise)
    }
}
