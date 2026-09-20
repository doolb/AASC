package com.aasc.asr

import android.media.AudioDeviceInfo
import android.media.AudioManager

/**
 * 原生 ASR 页面可选择的输入设备描述。
 *
 * 系统默认项不绑定具体 AudioDeviceInfo，由 Android 音频系统自行选择路由；
 * 其他项目保存设备 id，并在录音创建前将对应的 AudioDeviceInfo 交给 AudioRecord。
 */
data class AudioInputDevice(
    val id: Int?,
    val type: Int,
    val productName: String,
    val platformDevice: AudioDeviceInfo?
) {
    val isSystemDefault: Boolean
        get() = id == null

    val persistenceKey: String
        get() = id?.toString() ?: SYSTEM_DEFAULT_KEY

    val displayName: String
        get() {
            if (isSystemDefault) return SYSTEM_DEFAULT_LABEL
            val name = productName.trim().ifEmpty { "未命名输入设备" }
            return "$name（${typeName(type)}）"
        }

    companion object {
        const val SYSTEM_DEFAULT_KEY = "default"
        const val SYSTEM_DEFAULT_LABEL = "系统默认"

        fun systemDefault(): AudioInputDevice = AudioInputDevice(
            id = null,
            type = AudioDeviceInfo.TYPE_UNKNOWN,
            productName = SYSTEM_DEFAULT_LABEL,
            platformDevice = null
        )

        /** 获取当前系统暴露的输入设备，并把系统默认放在首位。 */
        fun enumerate(audioManager: AudioManager): List<AudioInputDevice> {
            val devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                .asSequence()
                .filter { it.id >= 0 }
                .distinctBy { it.id }
                .map { device ->
                    AudioInputDevice(
                        id = device.id,
                        type = device.type,
                        productName = device.productName?.toString().orEmpty(),
                        platformDevice = device
                    )
                }
                .toList()
            return listOf(systemDefault()) + devices
        }

        fun typeName(type: Int): String = when (type) {
            AudioDeviceInfo.TYPE_BUILTIN_MIC -> "内置麦克风"
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "蓝牙麦克风"
            AudioDeviceInfo.TYPE_BLE_HEADSET -> "蓝牙 LE 麦克风"
            AudioDeviceInfo.TYPE_WIRED_HEADSET -> "有线耳机麦克风"
            AudioDeviceInfo.TYPE_USB_DEVICE -> "USB 音频设备"
            AudioDeviceInfo.TYPE_USB_HEADSET -> "USB 耳机麦克风"
            AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB 音频配件"
            AudioDeviceInfo.TYPE_LINE_ANALOG -> "模拟线路输入"
            AudioDeviceInfo.TYPE_LINE_DIGITAL -> "数字线路输入"
            AudioDeviceInfo.TYPE_TELEPHONY -> "电话输入"
            AudioDeviceInfo.TYPE_FM_TUNER -> "FM 输入"
            AudioDeviceInfo.TYPE_AUX_LINE -> "辅助线路输入"
            AudioDeviceInfo.TYPE_IP -> "网络音频输入"
            else -> "其他输入设备"
        }
    }
}
