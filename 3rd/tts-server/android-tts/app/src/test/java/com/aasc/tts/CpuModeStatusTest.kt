package com.aasc.tts

import org.junit.Assert.assertEquals
import org.junit.Test

class CpuModeStatusTest {
    @Test
    fun readyStatusIncludesRequestedModeAndNativeResult() {
        assertEquals(
            "CPU 模式：大核（核心 4,5）",
            CpuModeStatus.ready("大核（核心 4,5）")
        )
    }
}
