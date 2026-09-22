package com.aasc.display

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.util.Base64
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

/**
 * 正式 APK 的 Native AudioRecord 采集器。
 *
 * 采集器只负责设备路由和 PCM16 分块，不复制 ASR/VAD 业务；分块通过 NativeBridge
 * 回调到 display.html，由页面继续复用现有 VAD、WAV 和 ASR 上传流程。
 */
class NativeAudioCaptureController(
    context: Context,
    private val webView: WebView,
    private val audioManager: AudioManager,
    private val mainHandler: Handler,
    private val bluetoothScoController: BluetoothScoController
) {
    private val appContext = context.applicationContext
    private val lock = Any()
    private var recorder: AudioRecord? = null
    private var recordThread: Thread? = null
    private var captureSampleRate = SAMPLE_RATE
    private var requestedDeviceKey = AudioInputDevice.DEFAULT_KEY
    private var actualDevice: AudioInputDevice? = null
    @Volatile
    private var lastError: String? = null
    private var lastStatus = JSONObject()
        .put("ok", true)
        .put("state", "stopped")
        .toString()

    @Volatile
    private var recording = false

    fun listDevices(): String {
        return try {
            val array = JSONArray()
            AudioInputDevice.enumerate(audioManager).forEach { array.put(it.toJson()) }
            JSONObject()
                .put("ok", true)
                .put("devices", array)
                .toString()
        } catch (error: Exception) {
            JSONObject()
                .put("ok", false)
                .put("error", error.message ?: "读取原生输入设备失败")
                .toString()
        }
    }

    fun start(configJson: String?): String {
        synchronized(lock) {
            if (recording) stopLocked()

            val config = try {
                if (configJson.isNullOrBlank()) JSONObject() else JSONObject(configJson)
            } catch (error: Exception) {
                return errorStatus("Native 录音配置格式错误：${error.message ?: "JSON 无效"}")
            }
            requestedDeviceKey = config.optString("deviceKey", AudioInputDevice.DEFAULT_KEY)
                .trim()
                .ifBlank { AudioInputDevice.DEFAULT_KEY }
            lastError = null
            val requestedDevice = resolveDevice(requestedDeviceKey)
            val selectedDevice = requestedDevice?.platformDevice
            var fallback = requestedDeviceKey != AudioInputDevice.DEFAULT_KEY && requestedDevice == null
            var fallbackReason: String? = if (fallback) "所选原生输入设备已不可用" else null

            var started = tryStart(selectedDevice)
            if (started == null && selectedDevice != null) {
                fallback = true
                fallbackReason = lastError ?: "所选原生输入设备启动失败"
                bluetoothScoController.stopForInput()
                started = tryStart(null)
            }
            if (started == null) {
                val message = lastError ?: "AudioRecord 启动失败"
                return errorStatus(message, fallback, fallbackReason)
            }

            recorder = started.first
            actualDevice = started.second ?: AudioInputDevice.systemDefault()
            captureSampleRate = started.first.sampleRate
            recording = true
            recordThread = Thread(::recordLoop, "aasc-native-audio-record").also { it.start() }
            lastStatus = JSONObject()
                .put("ok", true)
                .put("state", "started")
                .put("requestedDeviceKey", requestedDeviceKey)
                .put("actualDevice", actualDevice?.toJson() ?: JSONObject.NULL)
                .put("sampleRate", captureSampleRate)
                .put("fallback", fallback)
                .apply {
                    if (!fallbackReason.isNullOrBlank()) put("fallbackReason", fallbackReason)
                }
                .toString()
            return lastStatus
        }
    }

    fun stop(): String {
        synchronized(lock) {
            stopLocked()
            return lastStatus
        }
    }

    fun status(): String = synchronized(lock) {
        JSONObject()
            .put("ok", true)
            .put("state", if (recording) "started" else "stopped")
            .put("requestedDeviceKey", requestedDeviceKey)
            .put("actualDevice", actualDevice?.toJson() ?: JSONObject.NULL)
            .put("sampleRate", captureSampleRate)
            .toString()
    }

    fun release() {
        stop()
    }

    private fun resolveDevice(key: String): AudioInputDevice? {
        if (key == AudioInputDevice.DEFAULT_KEY) return AudioInputDevice.systemDefault()
        return try {
            AudioInputDevice.enumerate(audioManager).firstOrNull { it.key == key }
        } catch (error: Exception) {
            lastError = error.message ?: "读取原生输入设备失败"
            null
        }
    }

    private fun tryStart(preferredDevice: AudioDeviceInfo?): Pair<AudioRecord, AudioInputDevice?>? {
        val usesBluetoothSco = preferredDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        if (usesBluetoothSco && !bluetoothScoController.startForInput(preferredDevice!!)) {
            lastError = "蓝牙 SCO 音频链路未建立"
            return null
        }

        val options = if (usesBluetoothSco) {
            listOf(
                CaptureOption(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000),
                CaptureOption(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 8000)
            )
        } else {
            listOf(
                CaptureOption(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE),
                CaptureOption(MediaRecorder.AudioSource.MIC, SAMPLE_RATE)
            )
        }

        for (option in options) {
            var candidate: AudioRecord? = null
            try {
                val minimum = AudioRecord.getMinBufferSize(
                    option.sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                if (minimum <= 0) throw IllegalStateException("设备不支持 ${option.sampleRate}Hz 录音")
                val format = AudioFormat.Builder()
                    .setSampleRate(option.sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
                candidate = AudioRecord.Builder()
                    .setAudioSource(option.audioSource)
                    .setAudioFormat(format)
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
                val routed = try { candidate.routedDevice } catch (_: Exception) { null }
                if (preferredDevice != null && routed != null && !sameDevice(preferredDevice, routed)) {
                    throw IllegalStateException("实际路由不是所选麦克风")
                }
                val actual = routed?.let { findDevice(it) }
                return Pair(candidate, actual)
            } catch (error: Exception) {
                candidate?.release()
                lastError = error.message ?: "AudioRecord 启动失败"
            }
        }
        if (usesBluetoothSco) bluetoothScoController.stopForInput()
        return null
    }

    private fun findDevice(device: AudioDeviceInfo): AudioInputDevice {
        return try {
            AudioInputDevice.enumerate(audioManager).firstOrNull { sameDevice(it.platformDevice, device) }
                ?: AudioInputDevice(
                    key = AudioInputDevice.stableKey(device),
                    id = device.id,
                    type = device.type,
                    name = device.productName?.toString()?.trim().orEmpty(),
                    address = device.address?.trim().orEmpty(),
                    platformDevice = device
                )
        } catch (_: Exception) {
            AudioInputDevice(
                key = AudioInputDevice.stableKey(device),
                id = device.id,
                type = device.type,
                name = device.productName?.toString()?.trim().orEmpty(),
                address = device.address?.trim().orEmpty(),
                platformDevice = device
            )
        }
    }

    private fun sameDevice(left: AudioDeviceInfo?, right: AudioDeviceInfo?): Boolean {
        if (left == null || right == null) return false
        if (left.id == right.id) return true
        return left.type == right.type &&
            left.address.orEmpty() == right.address.orEmpty() &&
            left.productName?.toString().orEmpty() == right.productName?.toString().orEmpty()
    }

    private fun recordLoop() {
        val buffer = ShortArray((captureSampleRate / 10).coerceAtLeast(800))
        while (recording) {
            val count = try {
                recorder?.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING) ?: 0
            } catch (error: Exception) {
                lastError = error.message ?: "AudioRecord 读取失败"
                0
            }
            if (count < 0) {
                lastError = "AudioRecord 读取失败：错误码 $count"
                dispatchNativeAudioError(lastError ?: "AudioRecord 读取失败")
                break
            }
            if (count > 0) dispatchPcm(buffer, count)
        }
    }

    private fun dispatchPcm(buffer: ShortArray, count: Int) {
        val bytes = ByteArray(count * 2)
        for (index in 0 until count) {
            val value = buffer[index].toInt()
            bytes[index * 2] = (value and 0xFF).toByte()
            bytes[index * 2 + 1] = ((value shr 8) and 0xFF).toByte()
        }
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        val sampleRate = captureSampleRate
        mainHandler.post {
            if (!recording) return@post
            try {
                val js = "window.onNativeAudioChunk(${JSONObject.quote(encoded)},$sampleRate);"
                webView.evaluateJavascript(js, null)
            } catch (error: Exception) {
                android.util.Log.w("NativeAudioCapture", "PCM 回调页面失败: ${error.message}")
            }
        }
    }

    private fun dispatchNativeAudioError(error: String) {
        mainHandler.post {
            try {
                webView.evaluateJavascript("window.onNativeAudioError(${JSONObject.quote(error)});", null)
            } catch (callbackError: Exception) {
                android.util.Log.w("NativeAudioCapture", "错误回调页面失败: ${callbackError.message}")
            }
        }
    }

    private fun stopLocked() {
        val activeRecorder = recorder
        val thread = recordThread
        val stoppedDevice = actualDevice
        recording = false
        try { activeRecorder?.stop() } catch (_: Exception) { }
        try { thread?.join(1000) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        try { activeRecorder?.release() } catch (_: Exception) { }
        recorder = null
        recordThread = null
        bluetoothScoController.stopForInput()
        lastStatus = JSONObject()
            .put("ok", true)
            .put("state", "stopped")
            .put("requestedDeviceKey", requestedDeviceKey)
            .put("actualDevice", stoppedDevice?.toJson() ?: JSONObject.NULL)
            .put("sampleRate", captureSampleRate)
            .apply {
                if (!lastError.isNullOrBlank()) put("error", lastError)
            }
            .toString()
        actualDevice = null
    }

    private fun errorStatus(message: String, fallback: Boolean = false, fallbackReason: String? = null): String {
        lastStatus = JSONObject()
            .put("ok", false)
            .put("state", "error")
            .put("requestedDeviceKey", requestedDeviceKey)
            .put("fallback", fallback)
            .put("error", message)
            .apply {
                if (!fallbackReason.isNullOrBlank()) put("fallbackReason", fallbackReason)
            }
            .toString()
        return lastStatus
    }

    private data class CaptureOption(val audioSource: Int, val sampleRate: Int)

    companion object {
        private const val SAMPLE_RATE = 16000
    }
}
