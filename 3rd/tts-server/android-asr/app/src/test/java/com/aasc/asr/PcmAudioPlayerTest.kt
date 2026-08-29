package com.aasc.asr

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class PcmAudioPlayerTest {
    @Test
    fun convertsFloatSamplesToClippedPcm16() {
        assertArrayEquals(
            shortArrayOf(-32768, -16384, 0, 16383, 32767),
            PcmAudioPlayer.toPcm16(floatArrayOf(-1.2f, -0.5f, 0f, 0.5f, 1.2f))
        )
    }
}
