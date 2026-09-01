package com.aasc.rapidocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream

// 图片入口统一校验类型、大小、像素数量和 EXIF 方向，避免 HTTP 层把不可信字节直接交给推理流程。
object OcrImagePolicy {
    const val MAX_BODY_BYTES = 20 * 1024 * 1024
    const val MAX_PIXELS = 12 * 1024 * 1024

    private val supportedContentTypes = setOf("image/jpeg", "image/png", "image/webp")

    fun normalizeContentType(value: String?): String? {
        return value
            ?.substringBefore(';')
            ?.trim()
            ?.lowercase()
            ?.takeIf { it.isNotEmpty() }
    }

    fun validateContentType(value: String?): String {
        val normalized = normalizeContentType(value)
        require(normalized in supportedContentTypes) {
            "Content-Type 必须是 image/jpeg、image/png 或 image/webp"
        }
        return normalized ?: throw IllegalArgumentException("Content-Type 不能为空")
    }

    fun decode(bytes: ByteArray): DecodedImage {
        require(bytes.isNotEmpty()) { "图片请求体不能为空" }
        require(bytes.size <= MAX_BODY_BYTES) { "图片请求体不能超过 20 MiB" }

        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: throw IllegalArgumentException("图片无法解码")
        val width = bitmap.width.toLong()
        val height = bitmap.height.toLong()
        if (width * height > MAX_PIXELS) {
            bitmap.recycle()
            throw IllegalArgumentException("图片像素不能超过 12 MiB")
        }

        return try {
            val orientation = ExifInterface(ByteArrayInputStream(bytes))
                .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            val oriented = applyOrientation(bitmap, orientation)
            if (oriented !== bitmap) bitmap.recycle()
            DecodedImage(oriented)
        } catch (error: Exception) {
            bitmap.recycle()
            throw IllegalArgumentException("图片方向信息无法处理", error)
        }
    }

    private fun applyOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}
