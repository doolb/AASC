package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import com.aasc.display.vision.yolo.YoloModel

class RemoteModelManifestTest {
    @Test
    fun parsesManifestAndSelectsRequestedModel() {
        val manifest = RemoteModelManifest.parse(
            """
            {"models":[{"id":"yolo11n","files":[{"name":"yolo11n.onnx","size":12,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}]}
            """.trimIndent()
        )

        val model = manifest.requireModel("yolo11n")
        assertEquals("yolo11n.onnx", model.files.single().name)
        assertEquals(12L, model.files.single().size)
    }

    @Test
    fun rejectsMalformedSha256Metadata() {
        assertThrows(IllegalArgumentException::class.java) {
            RemoteModelManifest.parse(
                """
                {"models":[{"id":"rapidocr","files":[{"name":"det.onnx","size":1,"sha256":"abc"}]}]}
                """.trimIndent()
            )
        }
    }

    @Test
    fun missingModelIsRejectedBeforeDownload() {
        val manifest = RemoteModelManifest.parse("{\"models\":[]}")
        assertThrows(IllegalStateException::class.java) {
            manifest.requireModel("yolo11x")
        }
    }

    @Test
    fun supportsAllPreparedYoloSizes() {
        assertEquals("yolo11n.onnx", YoloModel.fromId("yolo11n").fileName)
        assertEquals("yolo11s.onnx", YoloModel.fromId("yolo11s").fileName)
        assertEquals("yolo11m.onnx", YoloModel.fromId("yolo11m").fileName)
        assertEquals("yolo11l.onnx", YoloModel.fromId("yolo11l").fileName)
        assertEquals("yolo11x.onnx", YoloModel.fromId("yolo11x").fileName)
    }

    @Test
    fun singleModelEndpointDoesNotInsertModelId() {
        assertEquals(
            "/api/speech-enhancement/model/gtcrn_simple.onnx",
            RemoteModelManager.buildDownloadPath(
                "/api/speech-enhancement/model",
                "gtcrn",
                "gtcrn_simple.onnx",
                includeModelId = false
            )
        )
    }
}
