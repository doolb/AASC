package com.aasc.rapidocr

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RapidOcrModelFilesTest {
    @Test
    fun modelListContainsFourPinnedFiles() {
        assertEquals(
            listOf(
                "PP-OCRv6_det_small.onnx",
                "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
                "PP-OCRv6_rec_small.onnx",
                "ppocrv6_dict.txt"
            ),
            RapidOcrModelFiles.FILE_NAMES
        )
    }

    @Test
    fun incompleteDirectoryIsNotReady() {
        val directory = Files.createTempDirectory("rapidocr-model-test-").toFile()
        try {
            File(directory, RapidOcrModelFiles.FILE_NAMES.first()).writeText("partial")
            assertFalse(RapidOcrModelFiles.isComplete(directory))
        } finally {
            directory.deleteRecursively()
        }
    }
}
