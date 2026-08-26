package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AsrCoordinatorTest {
    @Test
    fun durationIsMeasuredAroundRecognizerOnly() {
        val result = AsrCoordinator.measureForTest { "你好" }
        assertEquals("你好", result.text)
        assertTrue(result.elapsedMs >= 0)
    }

    @Test
    fun coordinatorRejectsEmptySamples() {
        val error = runCatching { AsrCoordinator.validateSamples(FloatArray(0)) }.exceptionOrNull()
        assertEquals("没有可识别的音频", error?.message)
    }
}
