package com.aasc.yolo

import org.junit.Assert.assertEquals
import org.junit.Test

class CpuModeTest {
    @Test
    fun unknownPersistedValueFallsBackToAuto() {
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(99))
    }

    @Test
    fun persistedValuesMapToThreeCpuModes() {
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(0))
        assertEquals(CpuMode.BIG, CpuMode.fromPersistedValue(1))
        assertEquals(CpuMode.LITTLE, CpuMode.fromPersistedValue(2))
    }
}
