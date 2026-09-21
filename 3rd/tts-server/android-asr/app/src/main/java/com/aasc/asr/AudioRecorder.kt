package com.aasc.asr

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

// 采集 ASR 音频；普通设备使用 16 kHz，蓝牙 SCO 优先使用宽带 16 kHz，失败时回退 8 kHz。
class AudioRecorder(context: Context, audioManager: AudioManager) {
    private val lock = Any()
    private val bluetoothScoController = BluetoothScoController(context, audioManager)
    private var recorder: AudioRecord? = null
    private var recordThread: Thread? = null
    private val pcm = ByteArrayOutputStream()
    @Volatile private var recording = false
    @Volatile private var captureSampleRate = SAMPLE_RATE
    @Volatile private var lastError: String? = null
    @Volatile private var lastCaptureStats = AudioCaptureStats.empty()
    @Volatile private var usingBluetoothSco = false
    private var requestedDeviceId: Int? = null
    private var capturedSampleCount = 0L
    private var capturedPeakAmplitude = 0
    private var capturedSumSquares = 0.0
    private val capturedVolumeEnvelope = ArrayList<Float>()

    fun isRecording(): Boolean = recording

    fun errorMessage(): String? = lastError

    fun captureStats(): AudioCaptureStats = lastCaptureStats

    fun start(preferredDevice: AudioDeviceInfo? = null): Boolean {
        synchronized(lock) {
            if (recording) return true
            lastError = null
            requestedDeviceId = preferredDevice?.id
            capturedSampleCount = 0L
            capturedPeakAmplitude = 0
            capturedSumSquares = 0.0
            capturedVolumeEnvelope.clear()
            val usesBluetoothSco = preferredDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            var audioRecord: AudioRecord? = null
            return try {
                if (usesBluetoothSco && !bluetoothScoController.startForInput(preferredDevice!!)) {
                    throw IllegalStateException("蓝牙 SCO 音频链路未建立，请重新连接蓝牙麦克风")
                }
                pcm.reset()
                val options = captureOptions(usesBluetoothSco)
                audioRecord = options.asSequence()
                    .mapNotNull { option ->
                        captureSampleRate = option.sampleRate
                        tryStartAudioRecord(option, preferredDevice)
                    }
                    .firstOrNull()
                    ?: throw IllegalStateException(lastError ?: "AudioRecord 启动失败")
                usingBluetoothSco = usesBluetoothSco
                recorder = audioRecord
                recording = true
                recordThread = Thread(::recordLoop, "asr-audio-record").also { it.start() }
                true
            } catch (error: Exception) {
                recording = false
                audioRecord?.release()
                recorder?.release()
                recorder = null
                usingBluetoothSco = false
                if (usesBluetoothSco) bluetoothScoController.stop()
                captureSampleRate = SAMPLE_RATE
                lastError = error.message ?: "录音启动失败"
                lastCaptureStats = AudioCaptureStats.empty(requestedDeviceId)
                false
            }
        }
    }

    fun stop(): FloatArray {
        val thread: Thread?
        val sampleRate: Int
        val requestedId: Int?
        val routedDevice: AudioDeviceInfo?
        val usesBluetoothSco: Boolean
        synchronized(lock) {
            if (!recording) return FloatArray(0)
            recording = false
            val activeRecorder = recorder
            routedDevice = try { activeRecorder?.routedDevice } catch (_: Exception) { null }
            requestedId = requestedDeviceId
            usesBluetoothSco = usingBluetoothSco
            try { activeRecorder?.stop() } catch (_: Exception) { /* 释放阶段兜底 */ }
            thread = recordThread
            sampleRate = captureSampleRate
            activeRecorder?.release()
            recorder = null
            recordThread = null
            usingBluetoothSco = false
        }
        try { thread?.join(1000) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        if (usesBluetoothSco) bluetoothScoController.stop()
        val captured = synchronized(pcm) { AsrPcm.decodeS16(pcm.toByteArray()) }
        val routeName = routedDevice?.productName?.toString()?.trim()?.ifEmpty { "未命名设备" } ?: "未知设备"
        val rms = if (capturedSampleCount == 0L) 0 else {
            sqrt(capturedSumSquares / capturedSampleCount).roundToInt()
        }
        lastCaptureStats = AudioCaptureStats(
            requestedDeviceId = requestedId,
            routedDeviceId = routedDevice?.id,
            routedDeviceName = routeName,
            sampleCount = capturedSampleCount.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
            peakAmplitude = capturedPeakAmplitude,
            rmsAmplitude = rms,
            volumeEnvelope = capturedVolumeEnvelope.toList()
        )
        return if (captured.isEmpty() || sampleRate == SAMPLE_RATE) {
            captured
        } else {
            AudioResampler.resampleMono(captured, sampleRate, SAMPLE_RATE)
        }
    }

    private fun recordLoop() {
        val buffer = ShortArray(captureSampleRate / 10)
        while (recording) {
            val count = try {
                recorder?.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING) ?: 0
            } catch (_: Exception) { 0 }
            if (count < 0) {
                lastError = "AudioRecord 读取失败：错误码 $count"
                break
            }
            if (count > 0) synchronized(pcm) {
                capturedVolumeEnvelope += AudioVolumeEnvelope.fromPcm16(buffer, count)
                for (index in 0 until count) {
                    val value = buffer[index].toInt()
                    val absoluteValue = abs(value)
                    capturedSampleCount += 1
                    capturedPeakAmplitude = maxOf(capturedPeakAmplitude, absoluteValue)
                    capturedSumSquares += value.toDouble() * value.toDouble()
                    pcm.write(value and 0xFF)
                    pcm.write((value shr 8) and 0xFF)
                }
            }
        }
    }

    /** 根据设备类型生成采集格式；蓝牙优先走 AIMIC-M4 当前暴露的宽带 SCO。 */
    private fun captureOptions(usesBluetoothSco: Boolean): List<CaptureOption> = if (usesBluetoothSco) {
        listOf(
            CaptureOption(MediaRecorder.AudioSource.VOICE_COMMUNICATION, BLUETOOTH_SCO_WIDEBAND_SAMPLE_RATE),
            CaptureOption(MediaRecorder.AudioSource.VOICE_COMMUNICATION, BLUETOOTH_SCO_NARROWBAND_SAMPLE_RATE)
        )
    } else {
        listOf(CaptureOption(MediaRecorder.AudioSource.MIC, SAMPLE_RATE))
    }

    /** 创建并启动一次录音；蓝牙设备必须在启动后仍保持为实际路由。 */
    private fun tryStartAudioRecord(
        option: CaptureOption,
        preferredDevice: AudioDeviceInfo?
    ): AudioRecord? {
        var candidate: AudioRecord? = null
        return try {
            val minimum = AudioRecord.getMinBufferSize(
                option.sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
            if (minimum <= 0) throw IllegalStateException("设备不支持 ${option.sampleRate}Hz 录音")
            val audioFormat = AudioFormat.Builder()
                .setSampleRate(option.sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .build()
            candidate = AudioRecord.Builder()
                .setAudioSource(option.audioSource)
                .setAudioFormat(audioFormat)
                .setBufferSizeInBytes(maxOf(minimum, option.sampleRate / 2))
                .build()
            if (candidate.state != AudioRecord.STATE_INITIALIZED) {
                throw IllegalStateException("AudioRecord 初始化失败")
            }
            if (preferredDevice != null && !candidate.setPreferredDevice(preferredDevice)) {
                throw IllegalStateException("无法路由到所选麦克风")
            }
            candidate.startRecording()
            if (candidate.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                throw IllegalStateException("AudioRecord 启动失败")
            }
            if (preferredDevice != null && !candidate.setPreferredDevice(preferredDevice)) {
                throw IllegalStateException("录音启动后无法保持所选麦克风路由")
            }
            val routedDevice = try { candidate.routedDevice } catch (_: Exception) { null }
            if (preferredDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO &&
                routedDevice?.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            ) {
                throw IllegalStateException("蓝牙 SCO 未成为实际输入路由")
            }
            candidate
        } catch (error: Exception) {
            candidate?.release()
            lastError = error.message ?: "AudioRecord 启动失败"
            null
        }
    }

    private data class CaptureOption(
        val audioSource: Int,
        val sampleRate: Int
    )

    companion object {
        const val SAMPLE_RATE = 16000
        private const val BLUETOOTH_SCO_WIDEBAND_SAMPLE_RATE = 16000
        private const val BLUETOOTH_SCO_NARROWBAND_SAMPLE_RATE = 8000
    }
}
