package com.aasc.asr

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AsrModelFilesTest {
    @Test
    fun modelListRequiresSenseVoiceFiles() {
        assertEquals(listOf("model.int8.onnx", "tokens.txt"), AsrModelFiles.FILE_NAMES)
        val directory = Files.createTempDirectory("asr-model-").toFile()
        assertFalse(AsrModelFiles.isComplete(directory))
        File(directory, "model.int8.onnx").writeBytes(ByteArray(1))
        assertFalse(AsrModelFiles.isComplete(directory))
        File(directory, "tokens.txt").writeText("0 a")
        assertTrue(AsrModelFiles.isComplete(directory))
    }
}
