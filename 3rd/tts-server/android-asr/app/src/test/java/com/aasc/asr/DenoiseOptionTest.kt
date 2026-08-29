package com.aasc.asr

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DenoiseOptionTest {
    @Test
    fun parsesEnabledAndDisabledQueryValues() {
        assertTrue(DenoiseOption.parse("1"))
        assertTrue(DenoiseOption.parse("true"))
        assertTrue(DenoiseOption.parse(" ON "))
        assertFalse(DenoiseOption.parse(null))
        assertFalse(DenoiseOption.parse("0"))
        assertFalse(DenoiseOption.parse("false"))
        assertFalse(DenoiseOption.parse("unknown"))
    }
}
