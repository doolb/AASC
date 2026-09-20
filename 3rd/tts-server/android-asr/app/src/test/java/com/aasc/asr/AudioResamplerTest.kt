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

    @Test
    fun monoBluetoothSamplesAreUpsampledToAsrRate() {
        val samples = AudioResampler.resampleMono(
            floatArrayOf(0.0f, 1.0f, 0.0f, -1.0f),
            sourceSampleRate = 8000,
            targetSampleRate = 16000
        )

        assertEquals(8, samples.size)
        assertTrue(samples[2] > 0.45f)
        assertTrue(samples[6] < -0.45f)
    }

    @Test
    fun emptyInputRemainsEmpty() {
        assertEquals(0, AudioResampler.resampleMono(FloatArray(0), 8000, 16000).size)
    }
}
