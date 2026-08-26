package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class UiStatusTest {
    @Test
    fun resultStatusContainsTextAndElapsedMilliseconds() {
        assertEquals("识别完成，用时 1234 ms\n你好", UiStatus.result("你好", 1234))
    }

    @Test
    fun blankAudioIsRejectedBeforeEngineCall() {
        assertEquals("没有可识别的音频", UiStatus.validate(FloatArray(0)))
    }
}
