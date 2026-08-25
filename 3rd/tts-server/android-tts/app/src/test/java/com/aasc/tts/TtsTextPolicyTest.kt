package com.aasc.tts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TtsTextPolicyTest {
    @Test
    fun normalizeTrimsText() {
        assertEquals("你好", TtsTextPolicy.normalize("  你好  "))
    }

    @Test(expected = IllegalArgumentException::class)
    fun normalizeRejectsBlankText() {
        TtsTextPolicy.normalize(" \n ")
    }

    @Test
    fun normalizeAcceptsTwoThousandCharacters() {
        assertEquals(2000, TtsTextPolicy.normalize("字".repeat(2000)).length)
    }

    @Test(expected = IllegalArgumentException::class)
    fun normalizeRejectsTwoThousandAndOneCharacters() {
        TtsTextPolicy.normalize("字".repeat(2001))
    }
}
