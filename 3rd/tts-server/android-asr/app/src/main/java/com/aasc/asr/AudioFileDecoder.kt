package com.aasc.asr

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

// 负责把系统选择的音频文件转换成 ASR 统一输入；WAV 不经过系统解码器，便于保证格式和错误信息稳定。
object AudioFileDecoder {
    private const val MAX_DURATION_SECONDS = 60
    private const val TIMEOUT_US = 10_000L

    fun decode(context: Context, uri: Uri): FloatArray {
        val resolver = context.contentResolver
        val input = resolver.openInputStream(uri) ?: throw IllegalArgumentException("无法打开音频文件")
        val bytes = try {
            input.use { stream -> stream.readBytes() }
        } catch (error: Exception) {
            throw IllegalArgumentException("读取音频文件失败", error)
        }
        if (bytes.isEmpty()) throw IllegalArgumentException("音频文件为空")
        if (isRiffWave(bytes)) return AudioResampler.toMono16k(WavAudio.decode(bytes))
        return decodeWithMediaCodec(context, uri)
    }

    private fun decodeWithMediaCodec(context: Context, uri: Uri): FloatArray {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        var descriptor: android.os.ParcelFileDescriptor? = null
        try {
            descriptor = context.contentResolver.openFileDescriptor(uri, "r")
                ?: throw IllegalArgumentException("无法打开媒体文件")
            extractor.setDataSource(descriptor.fileDescriptor)
            val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
                extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: throw IllegalArgumentException("媒体文件没有音频轨道")
            extractor.selectTrack(trackIndex)
            val inputFormat = extractor.getTrackFormat(trackIndex)
            val mime = inputFormat.getString(MediaFormat.KEY_MIME)
                ?: throw IllegalArgumentException("音频 MIME 类型缺失")
            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(inputFormat, null, null, 0)
            codec.start()
            return drainDecoder(extractor, codec)
        } catch (error: IllegalArgumentException) {
            throw error
        } catch (error: Exception) {
            throw IllegalArgumentException("系统不支持该音频格式", error)
        } finally {
            try {
                codec?.stop()
            } catch (_: Exception) {
                // 释放阶段异常不能覆盖识别前的原始错误。
            }
            try {
                codec?.release()
            } catch (_: Exception) {
                // 释放阶段异常不能影响调用方。
            }
            try {
                extractor.release()
            } catch (_: Exception) {
                // 释放阶段异常不能影响调用方。
            }
            try {
                descriptor?.close()
            } catch (_: Exception) {
                // 释放阶段异常不能影响调用方。
            }
        }
    }

    private fun drainDecoder(extractor: MediaExtractor, codec: MediaCodec): FloatArray {
        val info = MediaCodec.BufferInfo()
        val pcm = ByteArrayOutputStream()
        var inputEnded = false
        var outputEnded = false
        var sampleRate = 0
        var channels = 0
        while (!outputEnded) {
            if (!inputEnded) {
                val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                if (inputIndex >= 0) {
                    val inputBuffer = codec.getInputBuffer(inputIndex) ?: throw IllegalArgumentException("无法取得音频输入缓冲区")
                    inputBuffer.clear()
                    val size = extractor.readSampleData(inputBuffer, 0)
                    if (size < 0) {
                        codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputEnded = true
                    } else {
                        codec.queueInputBuffer(inputIndex, 0, size, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
            }

            when (val outputIndex = codec.dequeueOutputBuffer(info, TIMEOUT_US)) {
                MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val format = codec.outputFormat
                    sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    require(format.getInteger(MediaFormat.KEY_PCM_ENCODING, 2) == 2) { "仅支持 16-bit PCM 解码输出" }
                }
                else -> if (outputIndex >= 0) {
                    val outputBuffer = codec.getOutputBuffer(outputIndex)
                    if (outputBuffer != null && info.size > 0) {
                        val start = info.offset.coerceAtLeast(0)
                        val end = (info.offset + info.size).coerceAtMost(outputBuffer.limit())
                        require(start <= end) { "音频输出缓冲区无效" }
                        outputBuffer.position(start)
                        outputBuffer.limit(end)
                        val safeSize = end - start
                        val chunk = ByteArray(safeSize)
                        outputBuffer.get(chunk)
                        pcm.write(chunk)
                        require(pcm.size() <= maxPcmBytes(sampleRate, channels)) { "音频长度超过 60 秒" }
                    }
                    codec.releaseOutputBuffer(outputIndex, false)
                    outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                }
            }
        }
        require(sampleRate > 0 && channels > 0 && pcm.size() > 0) { "无法取得有效音频数据" }
        val samples = ByteBuffer.wrap(pcm.toByteArray()).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val shorts = ShortArray(samples.remaining())
        samples.get(shorts)
        return AudioResampler.toMono16k(PcmAudio(sampleRate, channels, shorts))
    }

    private fun maxPcmBytes(sampleRate: Int, channels: Int): Int {
        if (sampleRate <= 0 || channels <= 0) return Int.MAX_VALUE
        val bytes = sampleRate.toLong() * channels * 2L * MAX_DURATION_SECONDS
        return minOf(Int.MAX_VALUE.toLong(), bytes).toInt()
    }

    private fun isRiffWave(bytes: ByteArray): Boolean =
        bytes.size >= 12 && bytes.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" &&
            bytes.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WAVE"
}
