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
    fun exposesThreeVoiceprintModelsInStableOrder() {
        assertEquals(
            listOf(
                VoiceprintModel.ERES2NET_BASE,
                VoiceprintModel.ERES2NET_LARGE,
                VoiceprintModel.ERES2NET_V2
            ),
            VoiceprintModel.values().toList()
        )
        assertEquals("eres2net-base", VoiceprintModel.ERES2NET_BASE.id)
        assertEquals("eres2net-large", VoiceprintModel.ERES2NET_LARGE.id)
        assertEquals("eres2netv2", VoiceprintModel.ERES2NET_V2.id)
        assertEquals(VoiceprintModel.ERES2NET_V2, VoiceprintModel.fromId("ERES2NETV2"))
        assertNull(VoiceprintModel.fromId("unknown"))
    }

    @Test
    fun modelDirectoryRequiresAllThreeEmbeddingsAndSegmentation() {
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
