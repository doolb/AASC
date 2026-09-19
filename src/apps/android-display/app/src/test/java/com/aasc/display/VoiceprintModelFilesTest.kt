package com.aasc.display

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceprintModelFilesTest {
    @Test
    fun isComplete_内置embedding和分割模型齐全才就绪() {
        val directory = Files.createTempDirectory("voiceprint-model-test-").toFile()
        try {
            assertFalse(VoiceprintModelFiles.isComplete(directory, needSegmentation = true))
            File(directory, VoiceprintModelFiles.EMBEDDING_FILE_NAME)
                .writeBytes(ByteArray(VoiceprintModelFiles.MIN_EMBEDDING_BYTES.toInt() + 1))
            assertFalse(VoiceprintModelFiles.isComplete(directory, needSegmentation = true))
            File(directory, VoiceprintModelFiles.SEGMENTATION_FILE_NAME)
                .writeBytes(ByteArray(VoiceprintModelFiles.MIN_SEGMENTATION_BYTES.toInt() + 1))
            assertTrue(VoiceprintModelFiles.isComplete(directory, needSegmentation = true))
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun isComplete_关闭多人分割时只要求embedding模型() {
        val directory = Files.createTempDirectory("voiceprint-model-test-").toFile()
        try {
            File(directory, VoiceprintModelFiles.EMBEDDING_FILE_NAME)
                .writeBytes(ByteArray(VoiceprintModelFiles.MIN_EMBEDDING_BYTES.toInt() + 1))
            assertTrue(VoiceprintModelFiles.isComplete(directory, needSegmentation = false))
        } finally {
            directory.deleteRecursively()
        }
    }
}
