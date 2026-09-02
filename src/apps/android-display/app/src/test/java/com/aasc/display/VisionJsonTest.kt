package com.aasc.display

import com.aasc.display.vision.VisionJson
import com.aasc.display.vision.yolo.YoloClassNames
import com.aasc.display.vision.yolo.YoloDetection
import com.aasc.display.vision.yolo.YoloResult
import com.aasc.display.vision.yolo.YoloTiming
import org.junit.Rule
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.rules.TemporaryFolder

class VisionJsonTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun successResultKeepsRequestIdAndTimingFields() {
        val result = VisionJson.success("req-1", "ocr", 12L, "单小核（核心 0）")
        assertTrue(result.getBoolean("success"))
        assertEquals("req-1", result.getString("requestId"))
        assertEquals("ocr", result.getString("kind"))
        assertEquals(12L, result.getLong("elapsedMs"))
        assertEquals("单小核（核心 0）", result.getString("affinityStatus"))
    }

    @Test
    fun errorResultIsExplicitlyUnsuccessful() {
        val result = VisionJson.error("req-2", "yolo11n", "图片无效")
        assertFalse(result.getBoolean("success"))
        assertEquals("图片无效", result.getString("error"))
        assertEquals("req-2", result.getString("requestId"))
    }

    @Test
    fun yoloResultIncludesClassNameAndKeepsClassId() {
        val labelsFile = tmp.newFile("yolo11n.classes.json")
        labelsFile.writeText("""{"names":["person","class-1","class-2","class-3","class-4","class-5","class-6","class-7","class-8","class-9","class-10","class-11","class-12","class-13","class-14","class-15","class-16","class-17","class-18","class-19","class-20","class-21","class-22","class-23","class-24","class-25","class-26","class-27","class-28","class-29","class-30","class-31","sports ball"]}""")
        val result = VisionJson.yoloResult(
            "req-3",
            YoloResult(
                model = "yolo11n",
                detections = listOf(YoloDetection(32, 0.47f, 1f, 2f, 3f, 4f)),
                timing = YoloTiming(1L, 2L, 3L),
                affinityStatus = "单小核（核心 0）"
            ),
            YoloClassNames.read(labelsFile)
        )

        val detection = result.getJSONArray("detections").getJSONObject(0)
        assertEquals(32, detection.getInt("classId"))
        assertEquals("sports ball", detection.getString("className"))
    }
}
