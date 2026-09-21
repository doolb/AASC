package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceprintPrecisionTest {
    @Test
    fun exposesOnlyFp32Variant() {
        assertEquals(VoiceprintPrecision.FP32, VoiceprintPrecision.fromId(null))
        assertEquals(VoiceprintPrecision.FP32, VoiceprintPrecision.fromId("FP32"))
        assertEquals(null, VoiceprintPrecision.fromId("INT8"))

        val variant = VoiceprintModelVariant(VoiceprintModel.ERES2NET_BASE, VoiceprintPrecision.FP32)
        assertEquals("eres2net-base-fp32", variant.id)
        assertEquals(
            "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
            variant.embeddingFileName
        )
        assertEquals("ERes2Net-base (FP32)", variant.displayName)
    }

    @Test
    fun bundlesOnlyBaseFp32AndSegmentation() {
        val embeddingFiles = VoiceprintModelFiles.ALL_FILE_NAMES.filter { it.endsWith(".onnx") }
        VoiceprintModel.values().forEach { model ->
            assertTrue(embeddingFiles.contains(model.embeddingFileName))
        }
        assertTrue(embeddingFiles.contains(VoiceprintModelFiles.SEGMENTATION_FILE_NAME))
        assertEquals(2, embeddingFiles.size)
    }
}
