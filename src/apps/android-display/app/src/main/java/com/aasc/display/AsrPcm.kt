package com.aasc.display

// 16kHz mono s16le 裸 PCM 与 Float32 样本互转（纯逻辑，供原生 ASR 引擎输入与 JVM 单测）
// 注意：不依赖 android.util.Base64（JVM 单测是 stub），base64 编解码由 NativeBridge 负责
object AsrPcm {

    // ByteArray(s16le PCM) → Float32Array，归一化到 [-1,1]（sherpa-onnx 期望 Float32 样本）
    fun decodeS16(bytes: ByteArray): FloatArray {
        val count = bytes.size / 2
        val out = FloatArray(count)
        for (i in 0 until count) {
            val lo = bytes[i * 2].toInt() and 0xFF
            val hi = bytes[i * 2 + 1].toInt()
            val s = (lo or (hi shl 8)).toShort()
            out[i] = s / 32768.0f
        }
        return out
    }

    // Float32Array → ByteArray(s16le)，越界值 clamp 到 [-1,1]
    fun encodeS16(samples: FloatArray): ByteArray {
        val out = ByteArray(samples.size * 2)
        for (i in samples.indices) {
            val clamped = samples[i].coerceIn(-1.0f, 1.0f)
            val s = (if (clamped < 0f) (clamped * 0x8000).toInt() else (clamped * 0x7fff).toInt())
            out[i * 2] = (s and 0xFF).toByte()
            out[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        return out
    }
}
