package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class WebViewScalePolicyTest {

    @Test
    fun mdpi保持百分之百初始缩放() {
        assertEquals(100, WebViewScalePolicy.initialScalePercent(160))
    }

    @Test
    fun 高密度显示屏按mdpi基准缩小页面() {
        assertEquals(50, WebViewScalePolicy.initialScalePercent(320))
        assertEquals(29, WebViewScalePolicy.initialScalePercent(560))
    }

    @Test
    fun 非法密度回退默认缩放且结果受下限保护() {
        assertEquals(100, WebViewScalePolicy.initialScalePercent(0))
        assertEquals(100, WebViewScalePolicy.initialScalePercent(-1))
        assertEquals(25, WebViewScalePolicy.initialScalePercent(10_000))
    }
}
