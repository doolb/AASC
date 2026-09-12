package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceprintPrecisionTest {
    @Test
    fun exposesStablePrecisionVariants() {
        assertEquals(VoiceprintPrecision.FP32, VoiceprintPrecision.fromId(null))
        assertEquals(VoiceprintPrecision.INT8, VoiceprintPrecision.fromId("INT8"))

        val variant = VoiceprintModelVariant(VoiceprintModel.ERES2NET_V2, VoiceprintPrecision.INT8)
        assertEquals("eres2netv2-int8", variant.id)
        assertEquals(
            "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common_int8.onnx",
            variant.embeddingFileName
        )
        assertEquals("ERes2NetV2 (INT8)", variant.displayName)
    }

    @Test
    fun bundlesBothPrecisionsForEachModel() {
        val embeddingFiles = VoiceprintModelFiles.ALL_FILE_NAMES.filter { it.endsWith(".onnx") }
        VoiceprintModel.values().forEach { model ->
            assertTrue(embeddingFiles.contains(model.embeddingFileName))
            assertTrue(embeddingFiles.contains(model.variant(VoiceprintPrecision.INT8).embeddingFileName))
        }
        assertTrue(embeddingFiles.contains(VoiceprintModelFiles.SEGMENTATION_FILE_NAME))
        assertEquals(7, embeddingFiles.size)
    }
}
