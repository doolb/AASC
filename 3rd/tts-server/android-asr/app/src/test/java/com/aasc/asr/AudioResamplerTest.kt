package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioResamplerTest {
    @Test
    fun stereoInputIsAveragedAndUpsampledTo16k() {
        val audio = PcmAudio(8000, 2, shortArrayOf(1000, 3000, 2000, 4000))
        val samples = AudioResampler.toMono16k(audio)
        assertEquals(4, samples.size)
        assertTrue(samples[0] in 0.05f..0.07f)
        assertTrue(samples[3] in 0.08f..0.1f)
    }

    @Test(expected = IllegalArgumentException::class)
    fun resamplerRejectsInvalidChannelCount() {
        AudioResampler.toMono16k(PcmAudio(16000, 0, shortArrayOf(1)))
    }
}
