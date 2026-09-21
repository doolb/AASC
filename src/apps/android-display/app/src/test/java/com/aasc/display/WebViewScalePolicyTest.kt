package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class WebViewScalePolicyTest {

    @Test
    fun Offline模式以一千二百八十像素三百二十dpi为百分之百基准() {
        assertEquals(
            100,
            WebViewScalePolicy.initialScalePercent(
                true, 1280, 720, 320, WebViewDeviceClass.COMPUTER
            )
        )
    }

    @Test
    fun Offline模式按设备类别系数和运行时metrics计算() {
        assertEquals(
            100,
            WebViewScalePolicy.initialScalePercent(
                true, 1920, 1080, 160, WebViewDeviceClass.COMPUTER
            )
        )
        assertEquals(
            150,
            WebViewScalePolicy.initialScalePercent(
                true, 1920, 1080, 320, WebViewDeviceClass.COMPUTER
            )
        )
        assertEquals(
            112,
            WebViewScalePolicy.initialScalePercent(
                true, 720, 1480, 280, WebViewDeviceClass.PHONE
            )
        )
        assertEquals(
            300,
            WebViewScalePolicy.initialScalePercent(
                true, 2309, 1080, 480, WebViewDeviceClass.PHONE
            )
        )
        assertEquals(
            271,
            WebViewScalePolicy.initialScalePercent(
                true, 2309, 1080, 480, WebViewDeviceClass.COMPUTER
            )
        )
    }

    @Test
    fun 设备类别由最小屏幕宽度判断而不是由固定机型判断() {
        assertEquals(WebViewDeviceClass.PHONE, WebViewScalePolicy.deviceClass(360))
        assertEquals(WebViewDeviceClass.COMPUTER, WebViewScalePolicy.deviceClass(600))
        assertEquals(WebViewDeviceClass.COMPUTER, WebViewScalePolicy.deviceClass(0))
    }

    @Test
    fun 手机验算样例的缩放因子约为三() {
        assertEquals(
            3.0,
            WebViewScalePolicy.scaleFactor(
                true, 2309, 1080, 480, WebViewDeviceClass.PHONE
            ),
            0.000001
        )
    }

    @Test
    fun 普通APK不受分辨率公式影响() {
        assertEquals(
            100,
            WebViewScalePolicy.initialScalePercent(
                false, 2560, 1440, 560, WebViewDeviceClass.PHONE
            )
        )
    }

    @Test
    fun 无效分辨率或dpi回退百分之百() {
        assertEquals(
            100,
            WebViewScalePolicy.initialScalePercent(
                true, 0, 0, 320, WebViewDeviceClass.PHONE
            )
        )
        assertEquals(
            100,
            WebViewScalePolicy.initialScalePercent(
                true, -1, 720, 320, WebViewDeviceClass.PHONE
            )
        )
        assertEquals(
            100,
            WebViewScalePolicy.initialScalePercent(
                true, 1920, 1080, 0, WebViewDeviceClass.PHONE
            )
        )
        assertEquals(
            100,
            WebViewScalePolicy.initialScalePercent(
                true, 1920, 1080, -1, WebViewDeviceClass.PHONE
            )
        )
    }
}
