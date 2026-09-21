package com.aasc.asr

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioCaptureStatsTest {
    @Test
    fun zeroSamplesAreReportedAsNoSignal() {
        assertFalse(AudioCaptureStats.empty(10).hasSignal)
    }

    @Test
    fun nonZeroPeakIsReportedAsSignal() {
        val stats = AudioCaptureStats(10, 10, "SM-N9500", 1600, 42, 8)

        assertTrue(stats.hasSignal)
        assertTrue(stats.summary().contains("ID 10"))
    }

    @Test
    fun volumeEnvelopeIsRetainedWithCaptureStats() {
        val stats = AudioCaptureStats(10, 10, "SM-N9500", 3200, 42, 8, listOf(0.1f, 0.8f))

        assertEquals(listOf(0.1f, 0.8f), stats.volumeEnvelope)
    }
}
