package com.aasc.display

import org.json.JSONObject

// image2D storage 格式：internalFormat/imageFormat/readbackFormat/readbackType
// 值为 OpenGL ES 3.1 标准常量（硬编码以便 JVM 单元测试，与 android.opengl.GLES31 一致）
enum class ImageFormat(
    val internalFormat: Int,
    val imageFormat: Int,
    val readbackFormat: Int,
    val readbackType: Int
) {
    RGBA32F(0x8814, 0x8814, 0x1908, 0x1406),   // float32 四通道
    RGBA16F(0x881A, 0x881A, 0x1908, 0x1406),   // half float 四通道
    R32F(0x822E, 0x822E, 0x1903, 0x1406),      // float32 单通道
    RGBA8(0x8058, 0x8058, 0x1908, 0x1401),     // 归一化 uint8 四通道
    RGBA8UI(0x8D7C, 0x8D7C, 0x8D99, 0x1401),   // uint8 整型四通道
    RGBA32UI(0x8D70, 0x8D70, 0x8D99, 0x1405);  // uint32 整型四通道

    companion object {
        fun fromString(name: String): ImageFormat? =
            entries.firstOrNull { it.name.equals(name, ignoreCase = true) }
    }
}

// 单个 SSBO 数据缓冲
data class ComputeBuffer(val binding: Int, val data: FloatArray, val readback: Boolean)

// 单个 image2D
data class ComputeImage(
    val binding: Int,
    val width: Int,
    val height: Int,
    val readback: Boolean,
    val format: ImageFormat
)

// 解析并验证后的计算请求，dispatchSize 已 resolve 为长度 3
data class ComputeRequest(
    val shader: String,
    val dispatchSize: IntArray,
    val buffers: List<ComputeBuffer>,
    val images: List<ComputeImage>
)

class ComputeException(message: String) : Exception(message)

object ComputeProtocol {

    // 解析请求 JSON：验证 + binding 分配 + dispatch 计算，失败抛 ComputeException
    fun parse(json: String): ComputeRequest {
        val obj = JSONObject(json)

        val shader = obj.optString("shader")
        if (shader.isBlank()) throw ComputeException("shader 不能为空")

        val workgroupSize = parseTriple(obj.optJSONArray("workgroupSize"), intArrayOf(64, 1, 1), "workgroupSize")
        val dispatchSize = if (obj.has("dispatchSize") && !obj.isNull("dispatchSize"))
            parseTriple(obj.optJSONArray("dispatchSize"), null, "dispatchSize") else null
        val count = if (obj.has("count") && !obj.isNull("count")) obj.getInt("count") else null

        if (count != null && dispatchSize != null) throw ComputeException("count 与 dispatchSize 互斥")

        val (buffers, images) = parseResources(obj)
        if (buffers.isEmpty() && images.isEmpty()) throw ComputeException("至少提供一个 buffer 或 image")

        val finalDispatch = resolveDispatchSize(workgroupSize, dispatchSize, count)

        return ComputeRequest(shader, finalDispatch, buffers, images)
    }

    // 计算最终 dispatch 尺寸（长度 3）：dispatchSize 优先，否则 count 按 1D 线程总数算
    fun resolveDispatchSize(workgroupSize: IntArray, dispatchSize: IntArray?, count: Int?): IntArray {
        if (dispatchSize != null) return padToThree(dispatchSize)
        if (count != null) {
            if (count <= 0) throw ComputeException("count 必须为正数")
            return intArrayOf(ceilDiv(count, workgroupSize[0]), 1, 1)
        }
        throw ComputeException("count 与 dispatchSize 至少提供一个")
    }

    // 将 IntArray 补全/裁剪到长度 3（缺省维度填 1），保证 dispatchSize 恒为 3 维
    private fun padToThree(arr: IntArray): IntArray = intArrayOf(
        if (arr.size > 0) arr[0] else 1,
        if (arr.size > 1) arr[1] else 1,
        if (arr.size > 2) arr[2] else 1
    )

    // 解析 workgroupSize/dispatchSize：补全/裁剪到 3 维
    private fun parseTriple(arr: org.json.JSONArray?, default: IntArray?, name: String): IntArray {
        if (arr == null) return default ?: throw ComputeException("$name 不能为空")
        val out = intArrayOf(
            if (arr.length() > 0) arr.getInt(0) else 1,
            if (arr.length() > 1) arr.getInt(1) else 1,
            if (arr.length() > 2) arr.getInt(2) else 1
        )
        if (out.any { it <= 0 }) throw ComputeException("$name 必须为正整数")
        return out
    }

    // 解析 buffers/images，缺省 binding 按声明顺序从 0 起自动分配（显式 binding 保留并推高计数器）
    private fun parseResources(obj: JSONObject): Pair<List<ComputeBuffer>, List<ComputeImage>> {
        var nextBinding = 0
        val buffers = mutableListOf<ComputeBuffer>()
        val images = mutableListOf<ComputeImage>()

        obj.optJSONArray("buffers")?.let { arr ->
            for (i in 0 until arr.length()) {
                val b = arr.getJSONObject(i)
                val binding = resolveBinding(b, nextBinding)
                nextBinding = maxOf(nextBinding, binding + 1)
                val dataArr = b.getJSONArray("data")
                val data = FloatArray(dataArr.length()) { dataArr.getDouble(it).toFloat() }
                buffers.add(ComputeBuffer(binding, data, b.optBoolean("readback", false)))
            }
        }

        obj.optJSONArray("images")?.let { arr ->
            for (i in 0 until arr.length()) {
                val im = arr.getJSONObject(i)
                val binding = resolveBinding(im, nextBinding)
                nextBinding = maxOf(nextBinding, binding + 1)
                val formatName = im.optString("format", "rgba32f")
                val format = ImageFormat.fromString(formatName)
                    ?: throw ComputeException("不支持的 image 格式: $formatName")
                images.add(ComputeImage(
                    binding,
                    im.getInt("width"),
                    im.getInt("height"),
                    im.optBoolean("readback", false),
                    format
                ))
            }
        }
        return buffers to images
    }

    private fun resolveBinding(obj: JSONObject, nextBinding: Int): Int =
        if (obj.has("binding") && !obj.isNull("binding")) obj.getInt("binding") else nextBinding

    private fun ceilDiv(a: Int, b: Int): Int = (a + b - 1) / b
}
