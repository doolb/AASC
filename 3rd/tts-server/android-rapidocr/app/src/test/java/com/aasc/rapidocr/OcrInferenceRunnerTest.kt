package com.aasc.rapidocr

import org.junit.Assert.assertEquals
import org.junit.Test

class OcrInferenceRunnerTest {
    @Test
    fun appliesCurrentModeBeforeRunningInference() {
        val events = mutableListOf<String>()
        val runner = OcrInferenceRunner(
            modeProvider = { CpuMode.BIG },
            affinityApplier = { mode -> events += "affinity:${mode.name}"; "大核（核心 4,5）" }
        )

        val result = runner.run {
            events += "inference"
            "ok"
        }

        assertEquals("ok", result)
        assertEquals(listOf("affinity:BIG", "inference"), events)
    }

    @Test
    fun readsModeProviderAgainForTheNextInference() {
        var mode = CpuMode.BIG
        val appliedModes = mutableListOf<CpuMode>()
        val runner = OcrInferenceRunner(
            modeProvider = { mode },
            affinityApplier = { selected -> appliedModes += selected; "自动回退" }
        )

        runner.run { "first" }
        mode = CpuMode.LITTLE
        runner.run { "second" }

        assertEquals(listOf(CpuMode.BIG, CpuMode.LITTLE), appliedModes)
    }

    @Test
    fun affinityFallbackDoesNotRejectInference() {
        val runner = OcrInferenceRunner(
            modeProvider = { CpuMode.LITTLE },
            affinityApplier = { "自动回退，CPU 绑定失败" }
        )

        assertEquals("recognized", runner.run { "recognized" })
    }
}
