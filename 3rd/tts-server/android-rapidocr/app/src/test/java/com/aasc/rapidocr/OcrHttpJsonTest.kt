package com.aasc.rapidocr

import org.junit.Assert.assertTrue
import org.junit.Test

class OcrHttpJsonTest {
    @Test
    fun successJsonContainsImageSizeBoxesAndElapsedTime() {
        val result = OcrResult(
            text = "你好",
            elapsedMs = 123L,
            imageWidth = 640,
            imageHeight = 480,
            boxes = listOf(
                OcrBox(
                    text = "你\"好",
                    score = 0.98f,
                    points = listOf(
                        OcrPoint(10f, 20f),
                        OcrPoint(200f, 20f),
                        OcrPoint(200f, 60f),
                        OcrPoint(10f, 60f)
                    )
                )
            )
        )

        val json = OcrHttpJson.success(result)

        assertTrue(json.contains("\"success\":true"))
        assertTrue(json.contains("\"elapsedMs\":123"))
        assertTrue(json.contains("\"imageWidth\":640"))
        assertTrue(json.contains("\"imageHeight\":480"))
        assertTrue(json.contains("\"text\":\"你\\\"好\""))
        assertTrue(json.contains("\"points\":[[10.0,20.0]"))
    }

    @Test
    fun jsonEscapesQuotesNewlinesAndBackslashes() {
        val json = OcrHttpJson.error("a\\b\"c\nd")

        assertTrue(json.contains("a\\\\b\\\"c\\nd"))
        assertTrue(json.contains("\"success\":false"))
    }
}
