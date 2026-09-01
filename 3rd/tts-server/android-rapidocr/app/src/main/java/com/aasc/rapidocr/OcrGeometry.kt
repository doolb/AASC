package com.aasc.rapidocr

import kotlin.math.atan2

/**
 * 处理检测框的点坐标，统一使用图片左上角为原点、向右向下为正方向。
 */
object OcrGeometry {
    /**
     * 将四边形按左上、右上、右下、左下顺序排列。
     *
     * 通过中心点和极角排序可以覆盖轻微旋转的文字框，避免堆叠很长的条件分支。
     */
    fun orderClockwise(points: List<OcrPoint>): List<OcrPoint> {
        require(points.size >= 4) { "文字框至少需要四个点" }

        val centerX = points.map { it.x }.average().toFloat()
        val centerY = points.map { it.y }.average().toFloat()
        val sorted = points.sortedBy { point -> atan2(point.y - centerY, point.x - centerX) }
        val topLeftIndex = sorted.indices.minWithOrNull(
            compareBy<Int> { sorted[it].x + sorted[it].y }
                .thenBy { sorted[it].y }
                .thenBy { sorted[it].x }
        ) ?: 0

        return sorted.drop(topLeftIndex) + sorted.take(topLeftIndex)
    }

    /**
     * 将检测网络坐标还原到原图坐标。
     * offset 表示预处理前在原图坐标系中的裁剪偏移，因此先除以缩放比例再加回偏移。
     */
    fun scaleToOriginal(
        points: List<OcrPoint>,
        scaleX: Float,
        scaleY: Float,
        offsetX: Float,
        offsetY: Float
    ): List<OcrPoint> {
        require(scaleX > 0f && scaleY > 0f) { "缩放比例必须大于零" }

        return points.map { point ->
            OcrPoint(
                x = point.x / scaleX + offsetX,
                y = point.y / scaleY + offsetY
            )
        }
    }
}
