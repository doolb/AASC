package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class WebViewScalePolicyTest {

    @Test
    fun Offline模式以一千二百八十像素三百二十dpi为百分之百基准() {
        assertEquals(100, WebViewScalePolicy.initialScalePercent(true, 1280, 720, 320))
    }

    @Test
    fun Offline模式按长边和dpi共同计算并四舍五入() {
        assertEquals(100, WebViewScalePolicy.initialScalePercent(true, 1920, 1080, 160))
        assertEquals(102, WebViewScalePolicy.initialScalePercent(true, 720, 1480, 280))
        assertEquals(125, WebViewScalePolicy.initialScalePercent(true, 1920, 1080, 320))
        assertEquals(165, WebViewScalePolicy.initialScalePercent(true, 2309, 1080, 480))
        assertEquals(75, WebViewScalePolicy.initialScalePercent(true, 1280, 720, 160))
    }

    @Test
    fun 普通APK不受分辨率公式影响() {
        assertEquals(100, WebViewScalePolicy.initialScalePercent(false, 2560, 1440, 560))
    }

    @Test
    fun 无效分辨率或dpi回退百分之百() {
        assertEquals(100, WebViewScalePolicy.initialScalePercent(true, 0, 0, 320))
        assertEquals(100, WebViewScalePolicy.initialScalePercent(true, -1, 720, 320))
        assertEquals(100, WebViewScalePolicy.initialScalePercent(true, 1920, 1080, 0))
        assertEquals(100, WebViewScalePolicy.initialScalePercent(true, 1920, 1080, -1))
    }
}
