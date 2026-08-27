package com.aasc.asr

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamingAsrModelFilesTest {
    @Test
    fun modelListRequiresAllZipformerFiles() {
        val directory = Files.createTempDirectory("streaming-asr-model-").toFile()
        assertFalse(StreamingAsrModelFiles.isComplete(directory))
        StreamingAsrModelFiles.FILE_NAMES.dropLast(1).forEach { File(directory, it).writeBytes(ByteArray(1)) }
        assertFalse(StreamingAsrModelFiles.isComplete(directory))
        File(directory, StreamingAsrModelFiles.FILE_NAMES.last()).writeText("0 token")
        assertTrue(StreamingAsrModelFiles.isComplete(directory))
    }
}
