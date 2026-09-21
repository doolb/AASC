package com.aasc.asr

/**
 * 保存一次原生录音的实际路由和信号统计，方便区分“录音线程正常但输入为静音”和“录音启动失败”。
 */
data class AudioCaptureStats(
    val requestedDeviceId: Int?,
    val routedDeviceId: Int?,
    val routedDeviceName: String,
    val sampleCount: Int,
    val peakAmplitude: Int,
    val rmsAmplitude: Int,
    val volumeEnvelope: List<Float> = emptyList()
) {
    val hasSignal: Boolean
        get() = peakAmplitude > 0

    val routeDescription: String
        get() = routedDeviceId?.let { "$routedDeviceName（ID $it）" } ?: "未知设备"

    fun summary(): String =
        "实际路由：$routeDescription；样本：$sampleCount；峰值：$peakAmplitude；RMS：$rmsAmplitude"

    companion object {
        fun empty(requestedDeviceId: Int? = null): AudioCaptureStats = AudioCaptureStats(
            requestedDeviceId = requestedDeviceId,
            routedDeviceId = null,
            routedDeviceName = "未知设备",
            sampleCount = 0,
            peakAmplitude = 0,
            rmsAmplitude = 0,
            volumeEnvelope = emptyList()
        )
    }
}
