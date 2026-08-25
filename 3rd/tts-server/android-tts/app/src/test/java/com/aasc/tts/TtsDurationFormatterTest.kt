package com.aasc.tts

import org.junit.Assert.assertEquals
import org.junit.Test

class TtsDurationFormatterTest {
    @Test
    fun formatsMillisecondsAsTwoDecimalSeconds() {
        assertEquals("0.00 秒", TtsDurationFormatter.format(0L))
        assertEquals("1.24 秒", TtsDurationFormatter.format(1240L))
        assertEquals("12.35 秒", TtsDurationFormatter.format(12345L))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNegativeDuration() {
        TtsDurationFormatter.format(-1L)
    }
}
