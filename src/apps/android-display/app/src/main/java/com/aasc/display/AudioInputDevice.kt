package com.aasc.display

import android.media.AudioDeviceInfo
import android.media.AudioManager
import org.json.JSONObject

/**
 * 正式 APK 原生录音设备的统一描述。
 *
 * server 只保存 key，不保存 Android 临时 id；页面每次连接时根据当前系统设备重新解析 key。
 */
data class AudioInputDevice(
    val key: String,
    val id: Int?,
    val type: Int,
    val name: String,
    val address: String,
    val platformDevice: AudioDeviceInfo?
) {
    fun toJson(): JSONObject = JSONObject()
        .put("key", key)
        .put("id", id ?: JSONObject.NULL)
        .put("type", type)
        .put("typeName", typeName(type, address))
        .put("name", name.ifBlank { "未命名输入设备" })
        .put("address", address)

    companion object {
        const val DEFAULT_KEY = "default"

        fun systemDefault(): AudioInputDevice = AudioInputDevice(
            key = DEFAULT_KEY,
            id = null,
            type = AudioDeviceInfo.TYPE_UNKNOWN,
            name = "系统默认",
            address = "",
            platformDevice = null
        )

        fun enumerate(audioManager: AudioManager): List<AudioInputDevice> {
            val devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                .asSequence()
                .filter { it.id >= 0 }
                .distinctBy { it.id }
                .map { device ->
                    AudioInputDevice(
                        key = stableKey(device),
                        id = device.id,
                        type = device.type,
                        name = device.productName?.toString()?.trim().orEmpty(),
                        address = device.address?.trim().orEmpty(),
                        platformDevice = device
                    )
                }
                .toList()
            return listOf(systemDefault()) + devices
        }

        fun stableKey(device: AudioDeviceInfo): String {
            val address = device.address?.trim().orEmpty()
            val name = device.productName?.toString()?.trim().orEmpty()
            // 同名且没有系统地址的内置麦克风需要保留 id，否则控制端无法区分多个输入。
            val identity = address.ifBlank {
                "${name.ifBlank { "unnamed" }}:id-${device.id}"
            }
            return "native:${device.type}:$identity"
        }

        fun typeName(type: Int, address: String): String {
            if (type == AudioDeviceInfo.TYPE_BUILTIN_MIC && address.equals("back", ignoreCase = true)) {
                return "内置后置麦克风"
            }
            return when (type) {
                AudioDeviceInfo.TYPE_BUILTIN_MIC -> "内置麦克风"
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "蓝牙 SCO 麦克风"
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
}
