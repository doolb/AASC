package com.aasc.yolo

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer

/** 统一 YOLO11 的 ONNX Runtime Tensor 创建和浮点输出读取。 */
internal object YoloOrtUtils {
    data class FloatTensor(val shape: LongArray, val values: FloatArray)

    fun createInput(environment: OrtEnvironment, values: FloatArray, shape: LongArray): OnnxTensor {
        return OnnxTensor.createTensor(environment, FloatBuffer.wrap(values), shape)
    }

    fun readFloatTensor(result: OrtSession.Result): FloatTensor {
        val value = result.get(0)
        val tensor = value as? OnnxTensor ?: throw IllegalStateException("YOLO11 输出不是浮点 Tensor")
        val buffer = tensor.floatBuffer
        buffer.rewind()
        val values = FloatArray(buffer.remaining())
        buffer.get(values)
        return FloatTensor(tensor.info.shape, values)
    }
}
