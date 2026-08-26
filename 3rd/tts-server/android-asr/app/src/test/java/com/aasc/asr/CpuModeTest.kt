package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class CpuModeTest {
    @Test
    fun cpuModeRoundTripsPersistedValues() {
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(0))
        assertEquals(CpuMode.BIG, CpuMode.fromPersistedValue(1))
        assertEquals(CpuMode.LITTLE, CpuMode.fromPersistedValue(2))
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(99))
    }
}
