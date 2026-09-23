package com.aasc.display

import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * 正式 APK 的原生声音输出路由控制器。
 *
 * Android 12 及以上优先使用 setCommunicationDevice；旧系统无法为 WebView 的媒体流
 * 指定任意 AudioDeviceInfo，只能切换扬声器/非扬声器并交给系统媒体路由，因此状态中
 * 明确返回 routingMode 和 fallback，避免控制端把请求设备当成实际设备。
 */
class NativeAudioOutputController(
    private val audioManager: AudioManager,
    private val bluetoothScoController: BluetoothScoController
) {
    private val lock = Any()
    private var requestedDeviceKey = AudioOutputDevice.DEFAULT_KEY
    private var actualDevice: AudioOutputDevice? = AudioOutputDevice.systemDefault()
    private var routingMode = "default"
    private var lastError: String? = null
    private var lastStatus = createStatus(state = "applied").toString()

    fun listDevices(): String {
        return try {
            val array = JSONArray()
            AudioOutputDevice.enumerate(audioManager).forEach { array.put(it.toJson()) }
            JSONObject()
                .put("ok", true)
                .put("devices", array)
                .toString()
        } catch (error: Exception) {
            JSONObject()
                .put("ok", false)
                .put("error", error.message ?: "读取原生输出设备失败")
                .toString()
        }
    }

    fun apply(configJson: String?): String = synchronized(lock) {
        val config = try {
            if (configJson.isNullOrBlank()) JSONObject() else JSONObject(configJson)
        } catch (error: Exception) {
            return@synchronized errorStatus(
                AudioOutputDevice.DEFAULT_KEY,
                "Native 输出配置格式错误：${error.message ?: "JSON 无效"}"
            )
        }
        requestedDeviceKey = normalizeKey(config.optString("deviceKey", AudioOutputDevice.DEFAULT_KEY))
        lastError = null
        if (requestedDeviceKey == AudioOutputDevice.DEFAULT_KEY) {
            restoreDefaultRoute()
            actualDevice = AudioOutputDevice.systemDefault()
            routingMode = "default"
            return@synchronized saveStatus(state = "applied", fallback = false)
        }
        val result = applyRequestedRouteWithRetry(requestedDeviceKey)
        if (!result.ok) {
            restoreDefaultRoute()
            actualDevice = AudioOutputDevice.systemDefault()
            routingMode = "default"
            return@synchronized saveStatus(
                state = "applied",
                fallback = true,
                fallbackReason = result.error ?: "系统不支持所选输出设备"
            )
        }

        actualDevice = result.actualDevice
        routingMode = result.routingMode
        saveStatus(
            state = "applied",
            fallback = result.fallback,
            fallbackReason = result.error
        )
    }

    fun status(): String = synchronized(lock) { lastStatus }

    fun release() = synchronized(lock) {
        restoreDefaultRoute()
        actualDevice = AudioOutputDevice.systemDefault()
        routingMode = "default"
        requestedDeviceKey = AudioOutputDevice.DEFAULT_KEY
        lastStatus = createStatus(state = "released").toString()
    }

    private fun resolveDevice(key: String): AudioOutputDevice? {
        return try {
            AudioOutputDevice.enumerate(audioManager).firstOrNull { device ->
                device.platformDevice?.let { AudioOutputDevice.matchesKey(it, key) } == true
            }
        } catch (error: Exception) {
            lastError = error.message ?: "读取原生输出设备失败"
            null
        }
    }

    /**
     * 切换设备时先给 Android 音频服务和蓝牙路由留出刷新时间，失败后才回退默认。
     * 每轮重新枚举，避免继续使用设备断开前的 AudioDeviceInfo 对象。
     */
    private fun applyRequestedRouteWithRetry(key: String): RouteResult {
        var failure: String? = lastError
        val lastAttempt = ROUTE_RETRY_DELAYS_MS.size
        for (attempt in 0..lastAttempt) {
            val requested = resolveDevice(key)
            val result = requested?.platformDevice?.let { applyRoute(requested) }
                ?: RouteResult(ok = false, error = lastError ?: "所选原生输出设备暂未枚举")
            if (result.ok) return result

            failure = result.error ?: failure ?: "所选原生输出设备启动失败"
            restoreDefaultRoute()
            if (attempt == lastAttempt || !waitBeforeRetry(ROUTE_RETRY_DELAYS_MS[attempt])) break
        }
        return RouteResult(ok = false, error = failure ?: "所选原生输出设备重试后仍不可用")
    }

    private fun waitBeforeRetry(delayMs: Long): Boolean {
        return try {
            Thread.sleep(delayMs)
            true
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
    }

    private fun applyRoute(device: AudioOutputDevice): RouteResult {
        val platformDevice = device.platformDevice
            ?: return RouteResult(ok = false, error = "输出设备缺少原生设备句柄")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return try {
                bluetoothScoController.releaseOutput()
                if (audioManager.setCommunicationDevice(platformDevice)) {
                    val actual = audioManager.communicationDevice?.let { findDevice(it) } ?: device
                    RouteResult(ok = true, actualDevice = actual, routingMode = "communication")
                } else {
                    RouteResult(
                        ok = false,
                        error = "系统拒绝将 WebView 音频路由到该输出设备"
                    )
                }
            } catch (error: Exception) {
                RouteResult(
                    ok = false,
                    error = error.message ?: "设置 Android 输出路由失败"
                )
            }
        }

        return applyLegacyRoute(device)
    }

    private fun applyLegacyRoute(device: AudioOutputDevice): RouteResult {
        return try {
            // Android 8–11 没有面向 WebView STREAM_MUSIC 的通用 preferred output API。
            // 这里不能用通信 SCO 或 setSpeakerphoneOn 冒充媒体路由：它们可能只改变
            // 通话流，反而把 WebView 音频切到不可用的路径。保留系统媒体路由，
            // 并向控制端明确回报“请求已接受但实际设备由系统决定”。
            bluetoothScoController.releaseOutput()
            RouteResult(
                ok = true,
                actualDevice = null,
                routingMode = "system_default",
                fallback = true,
                error = "Android ${Build.VERSION.SDK_INT} 的 WebView 媒体流不能精确路由到指定输出设备，已保持系统媒体路由"
            )
        } catch (error: Exception) {
            RouteResult(ok = false, error = error.message ?: "设置旧版 Android 输出路由失败")
        }
    }

    private fun restoreDefaultRoute() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.clearCommunicationDevice()
            }
        } catch (_: Exception) {
            // 某些 ROM 不支持清理通信路由，继续执行旧版回退和 SCO 释放。
        }
        bluetoothScoController.releaseOutput()
    }

    private fun findDevice(device: AudioDeviceInfo): AudioOutputDevice {
        return try {
            AudioOutputDevice.enumerate(audioManager).firstOrNull { sameDevice(it.platformDevice, device) }
                ?: AudioOutputDevice(
                    key = AudioOutputDevice.stableKey(device),
                    id = device.id,
                    type = device.type,
                    name = device.productName?.toString()?.trim().orEmpty(),
                    address = device.address?.trim().orEmpty(),
                    platformDevice = device
                )
        } catch (_: Exception) {
            AudioOutputDevice(
                key = AudioOutputDevice.stableKey(device),
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

    private fun normalizeKey(value: String?): String {
        val normalized = value?.trim().orEmpty()
        return if (normalized.isNotEmpty() && normalized.length <= 512) {
            normalized
        } else {
            AudioOutputDevice.DEFAULT_KEY
        }
    }

    private fun saveStatus(
        state: String,
        fallback: Boolean,
        fallbackReason: String? = null
    ): String {
        lastStatus = createStatus(state, fallback, fallbackReason).toString()
        return lastStatus
    }

    private fun errorStatus(requestedKey: String, message: String): String {
        requestedDeviceKey = normalizeKey(requestedKey)
        lastStatus = createStatus(state = "error", error = message).toString()
        return lastStatus
    }

    private fun createStatus(
        state: String,
        fallback: Boolean = false,
        fallbackReason: String? = null,
        error: String? = lastError
    ): JSONObject = JSONObject()
        .put("ok", state != "error")
        .put("state", state)
        .put("requestedDeviceKey", requestedDeviceKey)
        .put("actualDevice", actualDevice?.toJson() ?: JSONObject.NULL)
        .put("routingMode", routingMode)
        .put("fallback", fallback)
        .apply {
            if (!fallbackReason.isNullOrBlank()) put("fallbackReason", fallbackReason)
            if (!error.isNullOrBlank()) put("error", error)
        }

    private data class RouteResult(
        val ok: Boolean,
        val actualDevice: AudioOutputDevice? = null,
        val routingMode: String = "default",
        val fallback: Boolean = false,
        val error: String? = null
    )

    companion object {
        private val ROUTE_RETRY_DELAYS_MS = longArrayOf(300L, 700L, 1200L)
    }
}
