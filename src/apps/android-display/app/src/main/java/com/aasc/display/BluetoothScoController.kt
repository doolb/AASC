package com.aasc.display

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 管理正式显示端的经典蓝牙 SCO 路由。
 *
 * 控制器只负责准备经典蓝牙 SCO 路由；录音数据由 WebView 或 Native AudioRecord
 * 持有，二者不会同时启动，避免两个输入客户端互相抢占。
 */
class BluetoothScoController(
    context: Context,
    private val audioManager: AudioManager
) {
    private val appContext = context.applicationContext
    private var receiver: BroadcastReceiver? = null
    private var receiverRegistered = false
    private var routeActive = false
    private var requestedByController = false
    private var modeChangedByController = false
    private var scoFlagChangedByController = false
    private var previousMode = AudioManager.MODE_NORMAL
    private var previousScoOn = false

    /**
     * 为 WebView 录音建立蓝牙 SCO；调用方会在返回成功后再创建 MediaStream。
     * JavaScript bridge 线程可以等待异步 SCO 广播，不阻塞 Activity 主线程。
     */
    fun startForVoice(): String {
        val bluetoothInput = try {
            audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                .firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        } catch (error: SecurityException) {
            return result(ok = false, error = "读取蓝牙麦克风权限不足：${error.message ?: "请允许蓝牙连接权限"}")
        } catch (error: Exception) {
            return result(ok = false, error = "读取蓝牙麦克风失败：${error.message ?: "系统音频设备不可用"}")
        }
        if (bluetoothInput == null) {
            return result(ok = false, error = "未发现蓝牙 SCO 麦克风")
        }
        return startForInputResult(bluetoothInput).toString()
    }

    /** 为 Native AudioRecord 指定的蓝牙输入设备建立 SCO。 */
    fun startForInput(device: AudioDeviceInfo): Boolean {
        if (device.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true
        return startForInputResult(device).optBoolean("ok", false)
    }

    private fun startForInputResult(device: AudioDeviceInfo): JSONObject {
        synchronized(this) {
            if (routeActive) {
                return JSONObject()
                    .put("ok", true)
                    .put("route", "bluetooth_sco")
                    .put("alreadyActive", true)
            }

            previousMode = audioManager.mode
            previousScoOn = audioManager.isBluetoothScoOn
            val connectedLatch = CountDownLatch(1)
            var connectedByBroadcast = false
            val stateReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    val state = intent?.getIntExtra(
                        AudioManager.EXTRA_SCO_AUDIO_STATE,
                        AudioManager.SCO_AUDIO_STATE_ERROR
                    ) ?: AudioManager.SCO_AUDIO_STATE_ERROR
                    if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                        connectedByBroadcast = true
                    }
                    if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED ||
                        state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED ||
                        state == AudioManager.SCO_AUDIO_STATE_ERROR
                    ) {
                        connectedLatch.countDown()
                    }
                }
            }
            receiver = stateReceiver

            return try {
                val filter = IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
                val stickyIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    appContext.registerReceiver(stateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
                } else {
                    @Suppress("DEPRECATION")
                    appContext.registerReceiver(stateReceiver, filter)
                }
                receiverRegistered = true

                val stickyState = stickyIntent?.getIntExtra(
                    AudioManager.EXTRA_SCO_AUDIO_STATE,
                    AudioManager.SCO_AUDIO_STATE_DISCONNECTED
                )
                val alreadyConnected = stickyState == AudioManager.SCO_AUDIO_STATE_CONNECTED ||
                    audioManager.isBluetoothScoOn
                if (alreadyConnected) {
                    routeActive = true
                    resultJson(ok = true, route = "bluetooth_sco", alreadyActive = true)
                } else {
                    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
                    modeChangedByController = true
                    @Suppress("DEPRECATION")
                    audioManager.startBluetoothSco()
                    requestedByController = true

                    val connected = connectedLatch.await(SCO_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS) &&
                        (connectedByBroadcast || audioManager.isBluetoothScoOn)
                    if (!connected) {
                        stopLocked()
                        resultJson(ok = false, error = "蓝牙 SCO 连接超时")
                    } else {
                        if (!audioManager.isBluetoothScoOn) {
                            @Suppress("DEPRECATION")
                            audioManager.isBluetoothScoOn = true
                            scoFlagChangedByController = true
                        }
                        routeActive = true
                        resultJson(ok = true, route = "bluetooth_sco")
                    }
                }
            } catch (error: SecurityException) {
                stopLocked()
                resultJson(ok = false, error = "启动蓝牙 SCO 权限不足：${error.message ?: "请允许蓝牙连接权限"}")
            } catch (error: Exception) {
                stopLocked()
                resultJson(ok = false, error = "启动蓝牙 SCO 失败：${error.message ?: "系统音频路由不可用"}")
            }
        }
    }

    /** 释放本次建立的路由，并恢复进入录音前的音频模式。 */
    fun stop() {
        synchronized(this) {
            stopLocked()
        }
    }

    private fun stopLocked() {
        if (requestedByController) {
            try {
                @Suppress("DEPRECATION")
                audioManager.stopBluetoothSco()
            } catch (_: Exception) {
                // 释放阶段即使系统拒绝 stop，也必须继续注销接收器并清理本地状态。
            }
        }
        if (scoFlagChangedByController && !previousScoOn) {
            try {
                @Suppress("DEPRECATION")
                audioManager.isBluetoothScoOn = false
            } catch (_: Exception) {
                // 某些 ROM 在 SCO 已断开后拒绝修改标志，不能阻止后续状态清理。
            }
        }
        if (receiverRegistered) {
            try {
                appContext.unregisterReceiver(receiver)
            } catch (_: Exception) {
                // 接收器可能已由系统回收，释放路径保持幂等。
            }
        }
        receiver = null
        receiverRegistered = false
        requestedByController = false
        if (modeChangedByController) {
            try {
                audioManager.mode = previousMode
            } catch (_: Exception) {
                // 恢复失败只记录系统状态，不让页面销毁流程崩溃。
            }
        }
        modeChangedByController = false
        scoFlagChangedByController = false
        routeActive = false
    }

    private fun result(
        ok: Boolean,
        route: String? = null,
        alreadyActive: Boolean = false,
        error: String? = null
    ): String {
        return resultJson(ok, route, alreadyActive, error).toString()
    }

    private fun resultJson(
        ok: Boolean,
        route: String? = null,
        alreadyActive: Boolean = false,
        error: String? = null
    ): JSONObject {
        val json = JSONObject().put("ok", ok)
        if (route != null) json.put("route", route)
        if (alreadyActive) json.put("alreadyActive", true)
        if (!error.isNullOrBlank()) json.put("error", error)
        return json
    }

    private companion object {
        const val SCO_CONNECT_TIMEOUT_SECONDS = 8L
    }
}
