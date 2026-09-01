package com.aasc.yolo

/** 五个用于横向速度比较的 Ultralytics YOLO11 目标检测模型。 */
enum class YoloModel(
    val id: String,
    val displayName: String,
    val fileName: String
) {
    N("yolo11n", "YOLO11n", "yolo11n.onnx"),
    S("yolo11s", "YOLO11s", "yolo11s.onnx"),
    M("yolo11m", "YOLO11m", "yolo11m.onnx"),
    L("yolo11l", "YOLO11l", "yolo11l.onnx"),
    X("yolo11x", "YOLO11x", "yolo11x.onnx");

    companion object {
        fun fromId(id: String): YoloModel? = entries.firstOrNull { it.id == id }
    }
}
