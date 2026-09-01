package com.aasc.yolo

import android.graphics.Bitmap
import android.graphics.BitmapFactory

/** 限制 HTTP 图片输入，避免无效类型和超大图片进入 Bitmap 或模型流程。 */
object YoloImagePolicy {
    const val MAX_BODY_BYTES = 20 * 1024 * 1024
    const val MAX_PIXELS = 12 * 1024 * 1024
    private val supportedContentTypes = setOf("image/jpeg", "image/png", "image/webp")

    fun normalizeContentType(contentType: String?): String {
        return contentType?.substringBefore(';')?.trim()?.lowercase().orEmpty()
    }

    fun validateContentType(contentType: String?) {
        require(normalizeContentType(contentType) in supportedContentTypes) {
            "Content-Type 必须是 image/jpeg、image/png 或 image/webp"
        }
    }

    fun decode(bytes: ByteArray): Bitmap {
        require(bytes.isNotEmpty()) { "图片请求体不能为空" }
        val bounds = BitmapFactory.Options().apply {
            // 先只读取图片头，避免恶意压缩图片在像素限制检查前分配超大 Bitmap。
            inJustDecodeBounds = true
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        validatePixelCount(bounds.outWidth, bounds.outHeight)

        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: throw IllegalArgumentException("图片无法解码")
        return try {
            // 实际解码后再次校验，覆盖 EXIF 方向或解码器返回尺寸与头信息不一致的情况。
            validatePixelCount(bitmap.width, bitmap.height)
            bitmap
        } catch (error: IllegalArgumentException) {
            bitmap.recycle()
            throw error
        }
    }

    fun validatePixelCount(width: Int, height: Int) {
        require(width > 0 && height > 0) { "图片尺寸无效" }
        require(width.toLong() * height.toLong() <= MAX_PIXELS) {
            "图片像素数不能超过 ${MAX_PIXELS}"
        }
    }
}
