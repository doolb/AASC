package com.aasc.rapidocr

import org.junit.Assert.assertEquals
import org.junit.Test

class CpuModeTest {
    @Test
    fun persistedValuesMapToAutomaticBigAndLittleModes() {
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(0))
        assertEquals(CpuMode.BIG, CpuMode.fromPersistedValue(1))
        assertEquals(CpuMode.LITTLE, CpuMode.fromPersistedValue(2))
    }

    @Test
    fun unknownPersistedValueFallsBackToAutomaticMode() {
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(99))
    }
}
