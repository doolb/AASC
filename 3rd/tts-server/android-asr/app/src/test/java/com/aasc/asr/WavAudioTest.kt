package com.aasc.asr

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class WavAudioTest {
    @Test
    fun wavDecoderReadsPcmHeaderAndSamples() {
        val wav = testWav(sampleRate = 8000, channels = 1, samples = shortArrayOf(0, 16384, -16384))
        val audio = WavAudio.decode(wav)
        assertEquals(8000, audio.sampleRate)
        assertEquals(1, audio.channels)
        assertArrayEquals(shortArrayOf(0, 16384, -16384), audio.samples)
    }

    @Test(expected = IllegalArgumentException::class)
    fun wavDecoderRejectsNonPcmFormat() {
        val wav = testWav(sampleRate = 16000, channels = 1, samples = shortArrayOf(1), format = 3)
        WavAudio.decode(wav)
    }

    private fun testWav(sampleRate: Int, channels: Int, samples: ShortArray, format: Int = 1): ByteArray {
        val data = ByteArrayOutputStream()
        fun writeAscii(value: String) = data.write(value.toByteArray(Charsets.US_ASCII))
        fun writeInt(value: Int) = data.write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array())
        fun writeShort(value: Int) = data.write(ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(value.toShort()).array())
        val pcm = ByteArrayOutputStream()
        samples.forEach { sample -> writeShortTo(pcm, sample.toInt()) }
        val pcmBytes = pcm.toByteArray()
        writeAscii("RIFF")
        writeInt(36 + pcmBytes.size)
        writeAscii("WAVEfmt ")
        writeInt(16)
        writeShort(format)
        writeShort(channels)
        writeInt(sampleRate)
        writeInt(sampleRate * channels * 2)
        writeShort(channels * 2)
        writeShort(16)
        writeAscii("data")
        writeInt(pcmBytes.size)
        data.write(pcmBytes)
        return data.toByteArray()
    }

    private fun writeShortTo(output: ByteArrayOutputStream, value: Int) {
        output.write(value and 0xFF)
        output.write((value shr 8) and 0xFF)
    }
}
