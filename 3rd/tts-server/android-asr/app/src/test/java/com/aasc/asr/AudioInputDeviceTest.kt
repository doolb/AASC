package com.aasc.asr

import android.media.AudioDeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioInputDeviceTest {
    @Test
    fun systemDefaultUsesStableDefaultKey() {
        val device = AudioInputDevice.systemDefault()

        assertTrue(device.isSystemDefault)
        assertEquals(AudioInputDevice.SYSTEM_DEFAULT_KEY, device.persistenceKey)
        assertEquals(AudioInputDevice.SYSTEM_DEFAULT_LABEL, device.displayName)
    }

    @Test
    fun displayNameContainsProductAndInputType() {
        val device = AudioInputDevice(
            id = 7,
            type = AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            productName = "蓝牙麦克风",
            platformDevice = null
        )

        assertEquals("蓝牙麦克风 · 蓝牙麦克风 · ID 7", device.displayName)
        assertEquals("7", device.persistenceKey)
    }

    @Test
    fun unknownProductNameGetsReadableFallback() {
        val device = AudioInputDevice(
            id = 8,
            type = AudioDeviceInfo.TYPE_USB_DEVICE,
            productName = "  ",
            platformDevice = null
        )

        assertEquals("未命名输入设备 · USB 音频设备 · ID 8", device.displayName)
    }

    @Test
    fun backMicrophoneHasExplicitLabel() {
        assertEquals("内置后置麦克风", AudioInputDevice.typeName(AudioDeviceInfo.TYPE_BUILTIN_MIC, "back"))
    }

    @Test
    fun firstBuiltinMicrophoneIsPreferredForFreshInstall() {
        val defaultDevice = AudioInputDevice.systemDefault()
        val mainMicrophone = AudioInputDevice(10, AudioDeviceInfo.TYPE_BUILTIN_MIC, "phone", null)
        val backMicrophone = AudioInputDevice(11, AudioDeviceInfo.TYPE_BUILTIN_MIC, "phone", null)

        assertEquals(mainMicrophone, AudioInputDevice.preferredDefault(listOf(defaultDevice, mainMicrophone, backMicrophone)))
    }
}
