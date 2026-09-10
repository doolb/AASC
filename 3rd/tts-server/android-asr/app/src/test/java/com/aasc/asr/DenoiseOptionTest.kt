package com.aasc.asr

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DenoiseOptionTest {
    @Test
    fun explicitPipelineFlagsOverrideLegacyFlagIndependently() {
        val result = DenoiseOption.resolve("0", "1", "1")

        assertEquals(false, result.asrDenoise)
        assertEquals(true, result.voiceprintDenoise)
    }

    @Test
    fun missingPipelineFlagsFallBackToLegacyFlag() {
        val result = DenoiseOption.resolve(null, null, "1")

        assertEquals(true, result.asrDenoise)
        assertEquals(true, result.voiceprintDenoise)
    }

    @Test
    fun parsesEnabledAndDisabledQueryValues() {
        assertTrue(DenoiseOption.parse("1"))
        assertTrue(DenoiseOption.parse("true"))
        assertTrue(DenoiseOption.parse(" ON "))
        assertFalse(DenoiseOption.parse(null))
        assertFalse(DenoiseOption.parse("0"))
        assertFalse(DenoiseOption.parse("false"))
        assertFalse(DenoiseOption.parse("unknown"))
    }
}
