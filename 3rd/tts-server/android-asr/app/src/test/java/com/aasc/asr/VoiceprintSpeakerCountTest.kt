package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceprintSpeakerCountTest {
    @Test
    fun parsesAutoAndSupportedSpeakerCounts() {
        assertEquals(VoiceprintSpeakerCount.AUTO, VoiceprintSpeakerCount.parse(null))
        assertEquals(VoiceprintSpeakerCount.AUTO, VoiceprintSpeakerCount.parse("AUTO"))
        assertEquals(1, VoiceprintSpeakerCount.parse("1"))
        assertEquals(5, VoiceprintSpeakerCount.parse("5"))
    }

    @Test
    fun rejectsCountsOutsideOneToFive() {
        assertNull(VoiceprintSpeakerCount.parse("0"))
        assertNull(VoiceprintSpeakerCount.parse("6"))
        assertNull(VoiceprintSpeakerCount.parse("-1"))
        assertNull(VoiceprintSpeakerCount.parse("2.5"))
        assertNull(VoiceprintSpeakerCount.parse("people"))
    }
}
