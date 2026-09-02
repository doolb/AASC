package com.aasc.display.vision.ocr

import android.graphics.Bitmap
import kotlin.math.hypot
import kotlin.math.max
import org.opencv.android.Utils
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc

/** 将检测到的四边形透视变换成水平文字图。 */
object PerspectiveCropper {
    fun crop(bitmap: Bitmap, box: List<OcrPoint>): Bitmap {
        require(box.size >= 4) { "透视裁剪需要四个文字框点" }
        val ordered = OcrGeometry.orderClockwise(box).take(4)
        val width = max(distance(ordered[0], ordered[1]), distance(ordered[2], ordered[3])).toInt().coerceAtLeast(1)
        val height = max(distance(ordered[0], ordered[3]), distance(ordered[1], ordered[2])).toInt().coerceAtLeast(1)
        val source = Mat()
        val transformed = Mat()
        val sourcePoints = MatOfPoint2f(*ordered.map { Point(it.x.toDouble(), it.y.toDouble()) }.toTypedArray())
        val targetPoints = MatOfPoint2f(
            Point(0.0, 0.0), Point(width.toDouble() - 1.0, 0.0),
            Point(width.toDouble() - 1.0, height.toDouble() - 1.0), Point(0.0, height.toDouble() - 1.0)
        )
        return try {
            Utils.bitmapToMat(bitmap, source)
            val perspective = Imgproc.getPerspectiveTransform(sourcePoints, targetPoints)
            try {
                Imgproc.warpPerspective(source, transformed, perspective, Size(width.toDouble(), height.toDouble()))
                Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { Utils.matToBitmap(transformed, it) }
            } finally {
                perspective.release()
            }
        } finally {
            targetPoints.release()
            sourcePoints.release()
            transformed.release()
            source.release()
        }
    }

    private fun distance(first: OcrPoint, second: OcrPoint): Double =
        hypot((first.x - second.x).toDouble(), (first.y - second.y).toDouble())
}
