package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AsrLanguageModeTest {
    @Test
    fun 支持自动中文英文模式() {
        assertEquals(AsrLanguageMode.AUTO, AsrLanguageMode.parse(null))
        assertEquals(AsrLanguageMode.ZH, AsrLanguageMode.parse("zh"))
        assertEquals(AsrLanguageMode.EN, AsrLanguageMode.parse("en"))
        assertNull(AsrLanguageMode.parse("ja"))
        assertNull(AsrLanguageMode.parse("zh-en-filter"))
    }
}
