package com.aasc.display.vision.ocr

import kotlin.math.min
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Scalar
import org.opencv.imgproc.Imgproc

/** DB 检测结果后处理：概率图二值化、轮廓提取、扩张和坐标还原。 */
object DbPostProcessor {
    private const val THRESHOLD = 0.3f
    private const val BOX_THRESHOLD = 0.5
    private const val UNCLIP_RATIO = 1.6f
    private const val MIN_SIDE = 3.0
    private const val MAX_CANDIDATES = 1000

    fun extractBoxes(
        probabilityMap: FloatArray,
        mapWidth: Int,
        mapHeight: Int,
        originalWidth: Int,
        originalHeight: Int
    ): List<List<OcrPoint>> {
        require(mapWidth > 0 && mapHeight > 0) { "检测概率图尺寸必须大于零" }
        require(probabilityMap.size >= mapWidth * mapHeight) { "检测概率图数据长度不足" }
        val probability = Mat(mapHeight, mapWidth, CvType.CV_32FC1)
        val binaryMat = Mat(mapHeight, mapWidth, CvType.CV_8UC1)
        val kernel = Mat.ones(2, 2, CvType.CV_8UC1)
        val contours = mutableListOf<MatOfPoint>()
        val hierarchy = Mat()
        return try {
            probability.put(0, 0, probabilityMap)
            val binary = ByteArray(mapWidth * mapHeight) { index ->
                if (probabilityMap[index] > THRESHOLD) 255.toByte() else 0
            }
            binaryMat.put(0, 0, binary)
            Imgproc.dilate(binaryMat, binaryMat, kernel)
            Imgproc.findContours(binaryMat, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE)
            contours.asSequence()
                .take(MAX_CANDIDATES)
                .mapNotNull { contour -> toBox(contour, probability, mapWidth, mapHeight, originalWidth, originalHeight) }
                .sortedWith(compareBy<List<OcrPoint>> { points -> points.minOf { it.y } / 10f }.thenBy { points -> points.minOf { it.x } })
                .toList()
        } finally {
            contours.forEach { it.release() }
            hierarchy.release()
            kernel.release()
            binaryMat.release()
            probability.release()
        }
    }

    private fun toBox(
        contour: MatOfPoint,
        probability: Mat,
        mapWidth: Int,
        mapHeight: Int,
        originalWidth: Int,
        originalHeight: Int
    ): List<OcrPoint>? {
        if (Imgproc.contourArea(contour) < MIN_SIDE * MIN_SIDE) return null
        val rawPoints = contour.toArray()
        if (rawPoints.size < 4) return null
        val contour2f = MatOfPoint2f(*rawPoints)
        val rotated = try {
            Imgproc.minAreaRect(contour2f)
        } finally {
            contour2f.release()
        }
        if (min(rotated.size.width, rotated.size.height) < MIN_SIDE) return null
        val corners = Array(4) { Point() }
        rotated.points(corners)
        val ordered = OcrGeometry.orderClockwise(corners.map { OcrPoint(it.x.toFloat(), it.y.toFloat()) })
        if (scoreBox(probability, ordered, mapWidth, mapHeight) < BOX_THRESHOLD) return null
        return expandAroundCenter(ordered).map { point ->
            OcrPoint(
                point.x.coerceIn(0f, (mapWidth - 1).toFloat()) / mapWidth * originalWidth,
                point.y.coerceIn(0f, (mapHeight - 1).toFloat()) / mapHeight * originalHeight
            )
        }
    }

    private fun expandAroundCenter(points: List<OcrPoint>): List<OcrPoint> {
        val centerX = points.map { it.x }.average().toFloat()
        val centerY = points.map { it.y }.average().toFloat()
        return points.map { point ->
            OcrPoint(centerX + (point.x - centerX) * UNCLIP_RATIO, centerY + (point.y - centerY) * UNCLIP_RATIO)
        }
    }

    private fun scoreBox(probability: Mat, points: List<OcrPoint>, mapWidth: Int, mapHeight: Int): Double {
        val polygon = MatOfPoint(*points.map { point ->
            Point(
                point.x.coerceIn(0f, (mapWidth - 1).toFloat()).toDouble(),
                point.y.coerceIn(0f, (mapHeight - 1).toFloat()).toDouble()
            )
        }.toTypedArray())
        val mask = Mat.zeros(mapHeight, mapWidth, CvType.CV_8UC1)
        return try {
            Imgproc.fillPoly(mask, listOf(polygon), Scalar(1.0))
            Core.mean(probability, mask).`val`[0]
        } finally {
            mask.release()
            polygon.release()
        }
    }
}
