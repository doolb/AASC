package com.aasc.display.vision.yolo

/** 正式显示端支持服务器按需提供的五个 YOLO11 尺寸，默认使用 n。 */
enum class YoloModel(val id: String, val fileName: String) {
    N("yolo11n", "yolo11n.onnx"),
    S("yolo11s", "yolo11s.onnx"),
    M("yolo11m", "yolo11m.onnx"),
    L("yolo11l", "yolo11l.onnx"),
    X("yolo11x", "yolo11x.onnx");

    companion object {
        fun fromId(id: String): YoloModel = values().firstOrNull { it.id == id }
            ?: throw IllegalArgumentException("不支持的 YOLO 模型: $id")
    }
}
