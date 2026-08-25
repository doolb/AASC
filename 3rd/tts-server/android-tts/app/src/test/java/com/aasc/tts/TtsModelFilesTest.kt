package com.aasc.tts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class TtsModelFilesTest {
    @Test
    fun modelListContainsExactlyRequiredFiles() {
        assertEquals(14, TtsModelFiles.FILE_NAMES.size)
        assertTrue(TtsModelFiles.FILE_NAMES.contains("2052.INI"))
        assertTrue(TtsModelFiles.FILE_NAMES.contains("MSTTSLocZhCN.dat"))
        assertTrue(TtsModelFiles.FILE_NAMES.contains("device_vocoder_v6_streaming.bin"))
    }

    @Test
    fun incompleteDirectoryIsNotReady() {
        val directory = Files.createTempDirectory("tts-model-test-").toFile()
        try {
            File(directory, "2052.INI").writeText("partial")
            assertTrue(!TtsModelFiles.isComplete(directory))
        } finally {
            directory.deleteRecursively()
        }
    }
}
