package com.aasc.asr

// 16-bit little-endian PCM 与 sherpa-onnx 所需 Float32 样本之间的转换。
object AsrPcm {
    fun decodeS16(bytes: ByteArray): FloatArray {
        require(bytes.size % 2 == 0) { "PCM 字节数必须是偶数" }
        val samples = FloatArray(bytes.size / 2)
        for (index in samples.indices) {
            val low = bytes[index * 2].toInt() and 0xFF
            val high = bytes[index * 2 + 1].toInt()
            val value = (low or (high shl 8)).toShort().toInt()
            samples[index] = value / 32768.0f
        }
        return samples
    }

    fun encodeS16(samples: FloatArray): ByteArray {
        val bytes = ByteArray(samples.size * 2)
        samples.forEachIndexed { index, sample ->
            val value = (sample.coerceIn(-1.0f, 1.0f) * if (sample < 0.0f) 32768 else 32767).toInt()
            bytes[index * 2] = (value and 0xFF).toByte()
            bytes[index * 2 + 1] = ((value shr 8) and 0xFF).toByte()
        }
        return bytes
    }
}
