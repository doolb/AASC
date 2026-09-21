package com.aasc.asr

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 管理 Android 旧版 Bluetooth SCO 录音链路。
 *
 * Android 9 的蓝牙输入虽然已经出现在 AudioManager 的设备列表中，
 * 但 AudioRecord 启动前仍需要先建立 SCO，并等待异步连接完成。
 */
class BluetoothScoController(
    context: Context,
    private val audioManager: AudioManager
) {
    private val appContext = context.applicationContext
    private var receiver: BroadcastReceiver? = null
    private var receiverRegistered = false
    private var requestedByController = false
    private var modeChangedByController = false
    private var scoFlagChangedByController = false
    private var previousMode = AudioManager.MODE_NORMAL
    private var previousScoOn = false

    /** 为经典蓝牙 SCO 输入建立音频链路；非 SCO 设备不改变系统音频路由。 */
    fun startForInput(device: AudioDeviceInfo): Boolean {
        if (device.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true
        synchronized(this) {
            if (receiverRegistered) return true
            val connectedLatch = CountDownLatch(1)
            var requestStarted = false
            var connectedByBroadcast = false
            var terminalState: Int? = null
            val stateReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    val state = intent?.getIntExtra(
                        AudioManager.EXTRA_SCO_AUDIO_STATE,
                        AudioManager.SCO_AUDIO_STATE_ERROR
                    ) ?: AudioManager.SCO_AUDIO_STATE_ERROR
                    if (!requestStarted) return
                    when (state) {
                        AudioManager.SCO_AUDIO_STATE_CONNECTED -> {
                            connectedByBroadcast = true
                            connectedLatch.countDown()
                        }
                        AudioManager.SCO_AUDIO_STATE_DISCONNECTED,
                        AudioManager.SCO_AUDIO_STATE_ERROR -> {
                            terminalState = state
                            connectedLatch.countDown()
                        }
                    }
                }
            }
            receiver = stateReceiver
            return try {
                val filter = IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    appContext.registerReceiver(stateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
                } else {
                    @Suppress("DEPRECATION")
                    appContext.registerReceiver(stateReceiver, filter)
                }
                receiverRegistered = true
                previousScoOn = audioManager.isBluetoothScoOn
                previousMode = audioManager.mode
                if (previousScoOn) {
                    @Suppress("DEPRECATION")
                    audioManager.stopBluetoothSco()
                    @Suppress("DEPRECATION")
                    audioManager.isBluetoothScoOn = false
                    scoFlagChangedByController = true
                }

                audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
                modeChangedByController = true
                requestStarted = true
                requestedByController = true
                @Suppress("DEPRECATION")
                audioManager.startBluetoothSco()
                val connected = connectedLatch.await(SCO_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS) &&
                    terminalState != AudioManager.SCO_AUDIO_STATE_DISCONNECTED &&
                    terminalState != AudioManager.SCO_AUDIO_STATE_ERROR &&
                    (connectedByBroadcast || audioManager.isBluetoothScoOn)
                if (!connected) {
                    stopLocked()
                    false
                } else {
                    if (!audioManager.isBluetoothScoOn) {
                        @Suppress("DEPRECATION")
                        audioManager.isBluetoothScoOn = true
                        scoFlagChangedByController = true
                    }
                    true
                }
            } catch (_: Exception) {
                stopLocked()
                false
            }
        }
    }

    /** 释放本次录音建立的 SCO 请求，并恢复录音前的 AudioManager 模式。 */
    fun stop() {
        synchronized(this) { stopLocked() }
    }

    private fun stopLocked() {
        if (requestedByController) {
            @Suppress("DEPRECATION")
            audioManager.stopBluetoothSco()
        }
        if (scoFlagChangedByController) {
            try {
                @Suppress("DEPRECATION")
                audioManager.isBluetoothScoOn = previousScoOn
            } catch (_: Exception) {
                // SCO 已断开时部分系统可能拒绝修改标志，不能阻止后续资源清理。
            }
        }
        if (receiverRegistered) {
            try {
                appContext.unregisterReceiver(receiver)
            } catch (_: Exception) {
                // 释放阶段兜底，不能阻止 AudioRecord 资源回收。
            }
        }
        receiver = null
        receiverRegistered = false
        requestedByController = false
        if (modeChangedByController) audioManager.mode = previousMode
        modeChangedByController = false
        scoFlagChangedByController = false
    }

    companion object {
        private const val SCO_CONNECT_TIMEOUT_SECONDS = 8L
    }
}
