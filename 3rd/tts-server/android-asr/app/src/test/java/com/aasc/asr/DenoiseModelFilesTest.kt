package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class DenoiseModelFilesTest {
    @Test
    fun usesSherpaGtcrnModel() {
        assertEquals(listOf("gtcrn_simple.onnx"), DenoiseModelFiles.FILE_NAMES)
    }
}
