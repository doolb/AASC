package com.aasc.display.vision

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream

/**
 * 统一处理网页传入的图片 Base64，先限制字节和像素，再把 EXIF 方向应用到 Bitmap。
 *
 * 该对象不持有 Bitmap；调用者拿到 Bitmap 后必须负责 recycle，避免连续图片测试时
 * native heap 持续增长。浏览器传来的 data URL MIME 只用于校验，真实解码仍由 Android
 * BitmapFactory 完成。
 */
object VisionImageCodec {
    const val MAX_BODY_BYTES = 20 * 1024 * 1024
    const val MAX_PIXELS = 12 * 1024 * 1024

    private val supportedContentTypes = setOf("image/jpeg", "image/png", "image/webp")

    fun decode(encodedImage: String): Bitmap {
        val (contentType, encoded) = splitDataUrl(encodedImage)
        contentType?.let(::validateContentType)
        require(encoded.isNotBlank()) { "图片数据不能为空" }

        val bytes = try {
            Base64.decode(encoded, Base64.DEFAULT)
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("图片 Base64 无效", error)
        }
        require(bytes.isNotEmpty()) { "图片数据不能为空" }
        require(bytes.size <= MAX_BODY_BYTES) { "图片请求体不能超过 20 MiB" }

        val bounds = BitmapFactory.Options().apply {
            // 先读取图片头，避免压缩图片在像素限制检查前分配超大 Bitmap。
            inJustDecodeBounds = true
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        validatePixelCount(bounds.outWidth, bounds.outHeight)

        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: throw IllegalArgumentException("图片无法解码")
        return try {
            validatePixelCount(bitmap.width, bitmap.height)
            applyExifOrientation(bitmap, bytes)
        } catch (error: Exception) {
            bitmap.recycle()
            throw if (error is IllegalArgumentException) error
            else IllegalArgumentException("图片方向信息无法处理", error)
        }
    }

    fun splitDataUrl(encodedImage: String): Pair<String?, String> {
        val value = encodedImage.trim()
        if (!value.startsWith("data:", ignoreCase = true)) return null to value
        val commaIndex = value.indexOf(',')
        require(commaIndex > 0) { "图片 data URL 格式无效" }
        val metadata = value.substring(5, commaIndex)
        val contentType = metadata.substringBefore(';').trim().lowercase()
            .takeIf { it.isNotEmpty() }
        require(metadata.split(';').any { it.equals("base64", ignoreCase = true) }) {
            "图片 data URL 必须使用 Base64"
        }
        return contentType to value.substring(commaIndex + 1)
    }

    fun validateContentType(contentType: String) {
        require(contentType in supportedContentTypes) {
            "图片类型必须是 image/jpeg、image/png 或 image/webp"
        }
    }

    fun validatePixelCount(width: Int, height: Int) {
        require(width > 0 && height > 0) { "图片尺寸无效" }
        require(width.toLong() * height.toLong() <= MAX_PIXELS) {
            "图片像素不能超过 12 MP"
        }
    }

    private fun applyExifOrientation(bitmap: Bitmap, bytes: ByteArray): Bitmap {
        val orientation = try {
            ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )
        } catch (_: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
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
        val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (oriented !== bitmap) bitmap.recycle()
        return oriented
    }
}
