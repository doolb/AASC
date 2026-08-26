package com.aasc.asr

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.ByteArrayOutputStream

// 采集 ASR 固定输入格式的临时录音；录音线程只负责收集 PCM，停止后由调用方异步转换。
class AudioRecorder {
    private val lock = Any()
    private var recorder: AudioRecord? = null
    private var recordThread: Thread? = null
    private val pcm = ByteArrayOutputStream()
    @Volatile private var recording = false

    fun isRecording(): Boolean = recording

    fun start(): Boolean {
        synchronized(lock) {
            if (recording) return true
            return try {
                val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                if (minimum <= 0) return false
                val audioRecord = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum, SAMPLE_RATE / 2))
                if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
                    audioRecord.release()
                    return false
                }
                pcm.reset()
                recorder = audioRecord
                recording = true
                audioRecord.startRecording()
                recordThread = Thread(::recordLoop, "asr-audio-record").also { it.start() }
                true
            } catch (_: Exception) {
                recording = false
                recorder?.release()
                recorder = null
                false
            }
        }
    }

    fun stop(): FloatArray {
        val thread: Thread?
        synchronized(lock) {
            if (!recording) return FloatArray(0)
            recording = false
            try { recorder?.stop() } catch (_: Exception) { /* 释放阶段兜底 */ }
            thread = recordThread
            recorder?.release()
            recorder = null
            recordThread = null
        }
        try { thread?.join(1000) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        return synchronized(pcm) { AsrPcm.decodeS16(pcm.toByteArray()) }
    }

    private fun recordLoop() {
        val buffer = ShortArray(SAMPLE_RATE / 10)
        while (recording) {
            val count = try { recorder?.read(buffer, 0, buffer.size) ?: 0 } catch (_: Exception) { 0 }
            if (count > 0) synchronized(pcm) {
                for (index in 0 until count) {
                    val value = buffer[index].toInt()
                    pcm.write(value and 0xFF)
                    pcm.write((value shr 8) and 0xFF)
                }
            }
        }
    }

    companion object { const val SAMPLE_RATE = 16000 }
}
