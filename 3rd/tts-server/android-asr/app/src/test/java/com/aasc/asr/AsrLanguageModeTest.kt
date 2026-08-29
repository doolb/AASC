package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class AsrLanguageModeTest {
    @Test
    fun parsesSupportedLanguageModes() {
        assertEquals(AsrLanguageMode.AUTO, AsrLanguageMode.parse(null))
        assertEquals(AsrLanguageMode.AUTO, AsrLanguageMode.parse("auto"))
        assertEquals(AsrLanguageMode.ZH, AsrLanguageMode.parse("zh"))
        assertEquals(AsrLanguageMode.EN, AsrLanguageMode.parse("en"))
    }

    @Test
    fun rejectsUnsupportedLanguageMode() {
        assertEquals(null, AsrLanguageMode.parse("zh,en"))
        assertEquals(null, AsrLanguageMode.parse("ja"))
        assertEquals(null, AsrLanguageMode.parse("zh-en-filter"))
    }
}
