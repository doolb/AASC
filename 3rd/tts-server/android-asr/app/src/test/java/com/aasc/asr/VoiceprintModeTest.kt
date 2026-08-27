package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceprintModeTest {
    @Test
    fun parsesOnlySherpaModes() {
        assertEquals(VoiceprintMode.SHERPA_SINGLE, VoiceprintMode.parse("SHERPA_SINGLE"))
        assertEquals(VoiceprintMode.SHERPA_MULTI, VoiceprintMode.parse("sherpa_multi"))
        assertNull(VoiceprintMode.parse("UNSUPPORTED_SINGLE"))
        assertNull(VoiceprintMode.parse(""))
    }

    @Test
    fun exposesExactlyTwoModes() {
        assertEquals(listOf("SHERPA_SINGLE", "SHERPA_MULTI"), VoiceprintMode.values().map { it.name })
    }
}
