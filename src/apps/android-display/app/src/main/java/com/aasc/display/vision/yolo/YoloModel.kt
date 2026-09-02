package com.aasc.display.vision.yolo

/** 正式显示端只内置经过单小核验证的 YOLO11n。 */
enum class YoloModel(val id: String, val fileName: String) {
    N("yolo11n", "yolo11n.onnx")
}
