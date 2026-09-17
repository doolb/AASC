package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class WebViewScalePolicyTest {

    @Test
    fun Offline模式以长边一千二百八十像素为百分之百基准() {
        assertEquals(100, WebViewScalePolicy.initialScalePercent(true, 1280, 720))
    }

    @Test
    fun Offline模式按长边分辨率等比例放大并四舍五入() {
        assertEquals(150, WebViewScalePolicy.initialScalePercent(true, 1920, 1080))
        assertEquals(116, WebViewScalePolicy.initialScalePercent(true, 720, 1480))
        assertEquals(50, WebViewScalePolicy.initialScalePercent(true, 640, 480))
    }

    @Test
    fun 普通APK不受分辨率公式影响() {
        assertEquals(100, WebViewScalePolicy.initialScalePercent(false, 2560, 1440))
    }

    @Test
    fun 无效分辨率回退百分之百() {
        assertEquals(100, WebViewScalePolicy.initialScalePercent(true, 0, 0))
        assertEquals(100, WebViewScalePolicy.initialScalePercent(true, -1, 720))
    }
}
