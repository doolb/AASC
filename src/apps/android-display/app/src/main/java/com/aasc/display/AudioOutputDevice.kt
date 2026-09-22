package com.aasc.display

import android.media.AudioDeviceInfo
import android.media.AudioManager
import org.json.JSONObject

/**
 * 正式 APK 原生声音输出设备的统一描述。
 *
 * 服务端只保存稳定 key，不保存 Android 临时 device id；显示端重连时会重新枚举设备并解析 key。
 */
data class AudioOutputDevice(
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
        .put("typeName", typeName(type))
        .put("name", name.ifBlank { "未命名输出设备" })
        .put("address", address)

    companion object {
        const val DEFAULT_KEY = "default"

        fun systemDefault(): AudioOutputDevice = AudioOutputDevice(
            key = DEFAULT_KEY,
            id = null,
            type = AudioDeviceInfo.TYPE_UNKNOWN,
            name = "系统默认",
            address = "",
            platformDevice = null
        )

        fun enumerate(audioManager: AudioManager): List<AudioOutputDevice> {
            val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                .asSequence()
                .filter { it.id >= 0 }
                .distinctBy { it.id }
                .map { device ->
                    AudioOutputDevice(
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
            // 没有地址的同名输出设备需要保留系统 id，避免控制端选中错误设备。
            val identity = address.ifBlank {
                "${name.ifBlank { "unnamed" }}:id-${device.id}"
            }
            return "native-output:${device.type}:$identity"
        }

        fun typeName(type: Int): String {
            return when (type) {
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "内置扬声器"
                AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "听筒"
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "蓝牙 A2DP 输出"
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "蓝牙 SCO 输出"
                AudioDeviceInfo.TYPE_BLE_HEADSET -> "蓝牙 LE 耳机输出"
                AudioDeviceInfo.TYPE_BLE_SPEAKER -> "蓝牙 LE 扬声器"
                AudioDeviceInfo.TYPE_WIRED_HEADSET -> "有线耳机"
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "有线耳机"
                AudioDeviceInfo.TYPE_USB_DEVICE -> "USB 音频设备"
                AudioDeviceInfo.TYPE_USB_HEADSET -> "USB 耳机"
                AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB 音频配件"
                AudioDeviceInfo.TYPE_HDMI -> "HDMI 音频"
                AudioDeviceInfo.TYPE_HDMI_ARC -> "HDMI ARC 音频"
                AudioDeviceInfo.TYPE_LINE_ANALOG -> "模拟线路输出"
                AudioDeviceInfo.TYPE_LINE_DIGITAL -> "数字线路输出"
                AudioDeviceInfo.TYPE_AUX_LINE -> "辅助线路输出"
                AudioDeviceInfo.TYPE_DOCK -> "扩展坞音频"
                AudioDeviceInfo.TYPE_FM -> "FM 输出"
                AudioDeviceInfo.TYPE_IP -> "网络音频输出"
                AudioDeviceInfo.TYPE_HEARING_AID -> "助听器"
                else -> "其他输出设备"
            }
        }
    }
}
