package com.aasc.tts

import org.junit.Assert.assertEquals
import org.junit.Test

class CpuModeTest {
    @Test
    fun modesHaveStablePersistedValues() {
        assertEquals(0, CpuMode.AUTO.persistedValue)
        assertEquals(1, CpuMode.BIG.persistedValue)
        assertEquals(2, CpuMode.LITTLE.persistedValue)
    }

    @Test
    fun invalidPersistedValueFallsBackToAutomatic() {
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(-1))
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(99))
    }
}
