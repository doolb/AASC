package com.aasc.display.vision

import com.aasc.display.CpuPolicy
import com.aasc.display.vision.ocr.OcrResult
import com.aasc.display.vision.yolo.YoloResult
import org.json.JSONArray
import org.json.JSONObject

/** 视觉桥统一 JSON 编码，确保网页得到稳定的成功、失败和耗时字段。 */
object VisionJson {
    fun accepted(): JSONObject = JSONObject().put("accepted", true)

    fun busy(kind: String): JSONObject = JSONObject()
        .put("accepted", false)
        .put("kind", kind)
        .put("error", "视觉任务忙")

    fun success(requestId: String, kind: String, elapsedMs: Long, affinityStatus: String): JSONObject = JSONObject()
        .put("success", true)
        .put("requestId", requestId)
        .put("kind", kind)
        .put("elapsedMs", elapsedMs)
        .put("affinityStatus", affinityStatus)

    fun error(requestId: String, kind: String, message: String): JSONObject = JSONObject()
        .put("success", false)
        .put("requestId", requestId)
        .put("kind", kind)
        .put("error", message)

    fun ocrResult(requestId: String, result: OcrResult): JSONObject {
        val base = success(requestId, "ocr", result.elapsedMs, result.affinityStatus)
            .put("text", result.text)
            .put("imageWidth", result.imageWidth)
            .put("imageHeight", result.imageHeight)
        val boxes = JSONArray()
        result.boxes.forEach { box ->
            val points = JSONArray()
            box.points.forEach { point -> points.put(JSONArray().put(point.x).put(point.y)) }
            boxes.put(JSONObject().put("text", box.text).put("score", box.score).put("points", points))
        }
        return base.put("boxes", boxes)
    }

    fun yoloResult(requestId: String, result: YoloResult): JSONObject {
        val base = success(requestId, "yolo11n", result.timing.totalMs, result.affinityStatus)
            .put("model", result.model)
            .put("loadModelMs", result.loadModelMs)
            .put("preprocessMs", result.timing.preprocessMs)
            .put("inferenceMs", result.timing.inferenceMs)
            .put("postprocessMs", result.timing.postprocessMs)
        val detections = JSONArray()
        result.detections.forEach { detection ->
            detections.put(JSONObject()
                .put("classId", detection.classId)
                .put("confidence", detection.confidence)
                .put("left", detection.left)
                .put("top", detection.top)
                .put("right", detection.right)
                .put("bottom", detection.bottom))
        }
        return base.put("detections", detections)
    }

    fun cpuPolicy(policy: CpuPolicy): JSONObject = JSONObject()
        .put("selectedCpus", JSONArray(policy.selectedCpus))
        .put("bigCpus", JSONArray(policy.bigCpus))
        .put("littleCpus", JSONArray(policy.littleCpus))
        .put("cpuMask", policy.cpuMask)
        .put("totalCoreCount", policy.totalCoreCount)
        .put("fallback", policy.fallback)
        .put("fallbackReason", policy.fallbackReason ?: JSONObject.NULL)
}
