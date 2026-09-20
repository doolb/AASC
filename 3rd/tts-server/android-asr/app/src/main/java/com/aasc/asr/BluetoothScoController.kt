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
    private var previousMode = AudioManager.MODE_NORMAL

    /** 为经典蓝牙 SCO 输入建立音频链路；非 SCO 设备不改变系统音频路由。 */
    fun startForInput(device: AudioDeviceInfo): Boolean {
        if (device.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true
        synchronized(this) {
            if (receiverRegistered) return true
            val connectedLatch = CountDownLatch(1)
            var connectedByBroadcast = false
            val stateReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    val state = intent?.getIntExtra(
                        AudioManager.EXTRA_SCO_AUDIO_STATE,
                        AudioManager.SCO_AUDIO_STATE_ERROR
                    ) ?: AudioManager.SCO_AUDIO_STATE_ERROR
                    if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) connectedByBroadcast = true
                    if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED ||
                        state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED
                    ) connectedLatch.countDown()
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
                if (alreadyConnected) return true

                previousMode = audioManager.mode
                audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
                modeChangedByController = true
                @Suppress("DEPRECATION")
                audioManager.startBluetoothSco()
                requestedByController = true
                val connected = connectedLatch.await(SCO_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS) &&
                    (connectedByBroadcast || audioManager.isBluetoothScoOn || stickyState == AudioManager.SCO_AUDIO_STATE_CONNECTED)
                if (!connected) {
                    stopLocked()
                    false
                } else true
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
    }

    companion object {
        private const val SCO_CONNECT_TIMEOUT_SECONDS = 8L
    }
}
