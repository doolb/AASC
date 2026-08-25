package com.aasc.tts

import org.junit.Assert.assertEquals
import org.junit.Test

class TtsStatusTextTest {
    @Test
    fun generationCompletedIncludesElapsedTime() {
        assertEquals("生成完成，用时 1.24 秒", TtsStatusText.generationCompleted(1240L))
    }
}
