package com.aasc.yolo

import org.junit.Assert.assertTrue
import org.junit.Test

class YoloHttpServerTest {
    @Test
    fun embeddedPageContainsUploadModelAndBenchmarkControls() {
        assertTrue(YoloWebPage.HTML.contains("type=\"file\""))
        assertTrue(YoloWebPage.HTML.contains("modelSelect"))
        assertTrue(YoloWebPage.HTML.contains("benchmarkButton"))
        assertTrue(YoloWebPage.HTML.contains("/api/benchmark"))
    }
}
