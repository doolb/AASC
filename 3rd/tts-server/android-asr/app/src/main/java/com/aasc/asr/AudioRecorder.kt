package com.aasc.asr

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.ByteArrayOutputStream

// 采集 ASR 音频；普通设备使用 16 kHz，经典蓝牙 SCO 使用 8 kHz 后重采样到 16 kHz。
class AudioRecorder(context: Context, audioManager: AudioManager) {
    private val lock = Any()
    private val bluetoothScoController = BluetoothScoController(context, audioManager)
    private var recorder: AudioRecord? = null
    private var recordThread: Thread? = null
    private val pcm = ByteArrayOutputStream()
    @Volatile private var recording = false
    @Volatile private var captureSampleRate = SAMPLE_RATE
    @Volatile private var lastError: String? = null

    fun isRecording(): Boolean = recording

    fun errorMessage(): String? = lastError

    fun start(preferredDevice: AudioDeviceInfo? = null): Boolean {
        synchronized(lock) {
            if (recording) return true
            lastError = null
            val usesBluetoothSco = preferredDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            var audioRecord: AudioRecord? = null
            return try {
                if (usesBluetoothSco && !bluetoothScoController.startForInput(preferredDevice!!)) {
                    throw IllegalStateException("蓝牙 SCO 音频链路未建立，请重新连接蓝牙麦克风")
                }
                captureSampleRate = if (usesBluetoothSco) BLUETOOTH_SCO_SAMPLE_RATE else SAMPLE_RATE
                val minimum = AudioRecord.getMinBufferSize(
                    captureSampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                if (minimum <= 0) throw IllegalStateException("设备不支持 ${captureSampleRate}Hz 录音")
                val audioFormat = AudioFormat.Builder()
                    .setSampleRate(captureSampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
                audioRecord = AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.MIC)
                    .setAudioFormat(audioFormat)
                    .setBufferSizeInBytes(maxOf(minimum, captureSampleRate / 2))
                    .build()
                if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
                    throw IllegalStateException("AudioRecord 初始化失败")
                }
                if (preferredDevice != null && !audioRecord.setPreferredDevice(preferredDevice)) {
                    throw IllegalStateException("无法路由到所选麦克风")
                }
                pcm.reset()
                audioRecord.startRecording()
                if (audioRecord.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                    throw IllegalStateException("AudioRecord 启动失败")
                }
                recorder = audioRecord
                recording = true
                recordThread = Thread(::recordLoop, "asr-audio-record").also { it.start() }
                true
            } catch (error: Exception) {
                recording = false
                audioRecord?.release()
                recorder?.release()
                recorder = null
                if (usesBluetoothSco) bluetoothScoController.stop()
                captureSampleRate = SAMPLE_RATE
                lastError = error.message ?: "录音启动失败"
                false
            }
        }
    }

    fun stop(): FloatArray {
        val thread: Thread?
        val sampleRate: Int
        synchronized(lock) {
            if (!recording) return FloatArray(0)
            recording = false
            try { recorder?.stop() } catch (_: Exception) { /* 释放阶段兜底 */ }
            thread = recordThread
            sampleRate = captureSampleRate
            recorder?.release()
            recorder = null
            recordThread = null
        }
        try { thread?.join(1000) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        if (sampleRate == BLUETOOTH_SCO_SAMPLE_RATE) bluetoothScoController.stop()
        val captured = synchronized(pcm) { AsrPcm.decodeS16(pcm.toByteArray()) }
        return if (captured.isEmpty() || sampleRate == SAMPLE_RATE) {
            captured
        } else {
            AudioResampler.resampleMono(captured, sampleRate, SAMPLE_RATE)
        }
    }

    private fun recordLoop() {
        val buffer = ShortArray(captureSampleRate / 10)
        while (recording) {
            val count = try { recorder?.read(buffer, 0, buffer.size) ?: 0 } catch (_: Exception) { 0 }
            if (count < 0) {
                lastError = "AudioRecord 读取失败：错误码 $count"
                break
            }
            if (count > 0) synchronized(pcm) {
                for (index in 0 until count) {
                    val value = buffer[index].toInt()
                    pcm.write(value and 0xFF)
                    pcm.write((value shr 8) and 0xFF)
                }
            }
        }
    }

    companion object {
        const val SAMPLE_RATE = 16000
        private const val BLUETOOTH_SCO_SAMPLE_RATE = 8000
    }
}
