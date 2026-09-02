package com.aasc.display

import com.aasc.display.vision.VisionJson
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VisionJsonTest {
    @Test
    fun successResultKeepsRequestIdAndTimingFields() {
        val result = VisionJson.success("req-1", "ocr", 12L, "单小核（核心 0）")
        assertTrue(result.getBoolean("success"))
        assertEquals("req-1", result.getString("requestId"))
        assertEquals("ocr", result.getString("kind"))
        assertEquals(12L, result.getLong("elapsedMs"))
        assertEquals("单小核（核心 0）", result.getString("affinityStatus"))
    }

    @Test
    fun errorResultIsExplicitlyUnsuccessful() {
        val result = VisionJson.error("req-2", "yolo11n", "图片无效")
        assertFalse(result.getBoolean("success"))
        assertEquals("图片无效", result.getString("error"))
        assertEquals("req-2", result.getString("requestId"))
    }
}
