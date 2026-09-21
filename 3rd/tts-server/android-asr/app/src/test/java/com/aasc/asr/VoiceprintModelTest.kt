package com.aasc.asr

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceprintModelTest {
    @Test
    fun exposesOnlyBaseVoiceprintModel() {
        assertEquals(
            listOf(VoiceprintModel.ERES2NET_BASE),
            VoiceprintModel.values().toList()
        )
        assertEquals("eres2net-base", VoiceprintModel.ERES2NET_BASE.id)
        assertEquals(VoiceprintModel.ERES2NET_BASE, VoiceprintModel.fromId("ERES2NET-BASE"))
        assertNull(VoiceprintModel.fromId("eres2net-large"))
        assertNull(VoiceprintModel.fromId("eres2netv2"))
        assertNull(VoiceprintModel.fromId("unknown"))
    }

    @Test
    fun modelDirectoryRequiresBaseEmbeddingAndSegmentation() {
        val directory = Files.createTempDirectory("voiceprint-model-").toFile()
        assertFalse(VoiceprintModelFiles.isComplete(directory))

        VoiceprintModelFiles.ALL_FILE_NAMES.dropLast(1).forEach { name ->
            File(directory, name).writeBytes(ByteArray(1))
        }
        assertFalse(VoiceprintModelFiles.isComplete(directory))

        File(directory, VoiceprintModelFiles.ALL_FILE_NAMES.last()).writeBytes(ByteArray(1))
        assertTrue(VoiceprintModelFiles.isComplete(directory))
    }
}
