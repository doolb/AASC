package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceprintSpeakerCountTest {
    @Test
    fun 支持自动或一到五人() {
        assertEquals(VoiceprintSpeakerCount.AUTO, VoiceprintSpeakerCount.parse(null))
        assertEquals(VoiceprintSpeakerCount.AUTO, VoiceprintSpeakerCount.parse("AUTO"))
        assertEquals(5, VoiceprintSpeakerCount.parse("5"))
        assertNull(VoiceprintSpeakerCount.parse("6"))
        assertNull(VoiceprintSpeakerCount.parse("0.5"))
    }
}
