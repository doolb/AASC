package com.aasc.rapidocr

import org.junit.Assert.assertEquals
import org.junit.Test

class CpuModeTest {
    @Test
    fun persistedValuesMapToFiveCpuModes() {
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(0))
        assertEquals(CpuMode.BIG, CpuMode.fromPersistedValue(1))
        assertEquals(CpuMode.LITTLE, CpuMode.fromPersistedValue(2))
        assertEquals(CpuMode.SINGLE_BIG, CpuMode.fromPersistedValue(3))
        assertEquals(CpuMode.SINGLE_LITTLE, CpuMode.fromPersistedValue(4))
    }

    @Test
    fun singleCoreModesUseOneOrtThreadAndClusterModesKeepTwo() {
        assertEquals(2, CpuMode.AUTO.intraOpThreads)
        assertEquals(2, CpuMode.BIG.intraOpThreads)
        assertEquals(2, CpuMode.LITTLE.intraOpThreads)
        assertEquals(1, CpuMode.SINGLE_BIG.intraOpThreads)
        assertEquals(1, CpuMode.SINGLE_LITTLE.intraOpThreads)
    }

    @Test
    fun unknownPersistedValueFallsBackToAutomaticMode() {
        assertEquals(CpuMode.AUTO, CpuMode.fromPersistedValue(99))
    }
}
