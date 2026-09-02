package com.aasc.display

import com.aasc.display.vision.VisionModelFiles
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class VisionModelFilesTest {
    @Test
    fun yoloModelIsIncompleteUntilTheBundledFileIsNonEmpty() {
        val directory = Files.createTempDirectory("vision-model-test-").toFile()
        try {
            assertFalse(VisionModelFiles.isYoloComplete(directory))
            File(directory, "yolo11n.onnx").writeBytes(byteArrayOf(1))
            File(directory, "yolo11n.classes.json").writeText("{\"names\":[\"person\"]}")
            assertTrue(VisionModelFiles.isYoloComplete(directory))
        } finally {
            directory.deleteRecursively()
        }
    }
}
