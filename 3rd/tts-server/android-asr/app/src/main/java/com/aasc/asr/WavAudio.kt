package com.aasc.asr

import java.nio.ByteBuffer
import java.nio.ByteOrder

data class PcmAudio(
    val sampleRate: Int,
    val channels: Int,
    val samples: ShortArray
)

// 解析常见 RIFF/WAVE PCM 16-bit 文件，不依赖 Android 媒体框架，便于 HTTP 和 JVM 测试共用。
object WavAudio {
    fun decode(bytes: ByteArray): PcmAudio {
        require(bytes.size >= 12) { "WAV 文件过短" }
        require(ascii(bytes, 0, 4) == "RIFF" && ascii(bytes, 8, 4) == "WAVE") { "不是有效 WAV 文件" }

        var offset = 12
        var sampleRate = 0
        var channels = 0
        var format = 0
        var bitsPerSample = 0
        var dataOffset = -1
        var dataSize = 0
        while (offset + 8 <= bytes.size) {
            val chunkId = ascii(bytes, offset, 4)
            val chunkSize = readInt(bytes, offset + 4)
            require(chunkSize >= 0 && chunkSize <= bytes.size - offset - 8) { "WAV chunk 长度无效" }
            val chunkData = offset + 8
            when (chunkId) {
                "fmt " -> {
                    require(chunkSize >= 16) { "WAV fmt chunk 无效" }
                    format = readShort(bytes, chunkData)
                    channels = readShort(bytes, chunkData + 2)
                    sampleRate = readInt(bytes, chunkData + 4)
                    bitsPerSample = readShort(bytes, chunkData + 14)
                }
                "data" -> {
                    dataOffset = chunkData
                    dataSize = chunkSize
                }
            }
            offset = chunkData + chunkSize + (chunkSize and 1)
        }

        require(format == 1) { "仅支持 PCM WAV" }
        require(channels > 0 && sampleRate > 0) { "WAV 音频参数无效" }
        require(bitsPerSample == 16) { "仅支持 16-bit WAV" }
        require(dataOffset >= 0 && dataSize > 0) { "WAV 缺少音频数据" }
        require(dataSize % 2 == 0) { "WAV PCM 数据长度无效" }
        val samples = ShortArray(dataSize / 2)
        for (index in samples.indices) samples[index] = readShort(bytes, dataOffset + index * 2).toShort()
        return PcmAudio(sampleRate, channels, samples)
    }

    fun encode(samples: FloatArray, sampleRate: Int = 16000): ByteArray {
        require(sampleRate > 0) { "采样率必须大于 0" }
        val pcm = AsrPcm.encodeS16(samples)
        val buffer = ByteBuffer.allocate(44 + pcm.size).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put("RIFF".toByteArray(Charsets.US_ASCII))
        buffer.putInt(36 + pcm.size)
        buffer.put("WAVEfmt ".toByteArray(Charsets.US_ASCII))
        buffer.putInt(16).putShort(1).putShort(1)
        buffer.putInt(sampleRate).putInt(sampleRate * 2).putShort(2).putShort(16)
        buffer.put("data".toByteArray(Charsets.US_ASCII)).putInt(pcm.size).put(pcm)
        return buffer.array()
    }

    private fun ascii(bytes: ByteArray, offset: Int, length: Int): String =
        bytes.copyOfRange(offset, offset + length).toString(Charsets.US_ASCII)

    private fun readShort(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 0xFF) or (bytes[offset + 1].toInt() shl 8)

    private fun readInt(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 0xFF) or
            ((bytes[offset + 1].toInt() and 0xFF) shl 8) or
            ((bytes[offset + 2].toInt() and 0xFF) shl 16) or
            (bytes[offset + 3].toInt() shl 24)
}
