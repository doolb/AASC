package com.aasc.yolo

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class YoloModelFilesTest {
    @Test
    fun modelListContainsTheFiveYolo11Variants() {
        assertEquals(
            listOf("yolo11n", "yolo11s", "yolo11m", "yolo11l", "yolo11x"),
            YoloModel.entries.map { it.id }
        )
    }

    @Test
    fun incompleteDirectoryIsNotReady() {
        val directory = Files.createTempDirectory("yolo11-model-test-").toFile()
        YoloModelFiles.FILE_NAMES.take(4).forEach { directory.resolve(it).writeText("onnx") }

        assertFalse(YoloModelFiles.isComplete(directory))
        directory.resolve(YoloModelFiles.FILE_NAMES.last()).writeText("onnx")
        assertTrue(YoloModelFiles.isComplete(directory))
    }
}
