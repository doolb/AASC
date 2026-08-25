package com.aasc.tts

import org.junit.Assert.assertTrue
import org.junit.Test

class CpuAffinityTest {
    @Test
    fun unavailableNativeLibraryFallsBackWithoutThrowing() {
        val status = CpuAffinity.apply(CpuMode.AUTO)
        assertTrue(status.contains("自动"))
    }
}
