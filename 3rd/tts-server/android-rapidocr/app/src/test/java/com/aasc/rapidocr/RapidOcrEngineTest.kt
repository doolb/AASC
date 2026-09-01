package com.aasc.rapidocr

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Test

class RapidOcrEngineTest {
    @Test
    fun rejectsIncompleteModelDirectoryBeforeCreatingSessions() {
        val directory = Files.createTempDirectory("rapidocr-incomplete").toFile()
        try {
            directory.resolve(RapidOcrModelFiles.FILE_NAMES.first()).writeText("not-a-model")
            val engine = RapidOcrEngine()

            val error = try {
                engine.load(directory)
                null
            } catch (exception: IllegalArgumentException) {
                exception
            }

            assertEquals("RapidOCR 模型文件不完整", error?.message)
        } finally {
            directory.listFiles()?.forEach { it.delete() }
            directory.delete()
        }
    }
}
