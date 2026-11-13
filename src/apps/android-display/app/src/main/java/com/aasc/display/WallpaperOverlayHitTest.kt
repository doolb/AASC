package com.aasc.display

/** 只在简略圆钮绘制的圆形内启动点击或拖动。 */
internal object WallpaperOverlayHitTest {
    fun contains(width: Int, height: Int, x: Float, y: Float): Boolean {
        val radius = minOf(width, height) / 2f
        if (radius <= 0f) return false
        val dx = x - width / 2f
        val dy = y - height / 2f
        return dx * dx + dy * dy <= radius * radius
    }

    fun containsHalf(width: Int, height: Int, x: Float, y: Float, edge: Int): Boolean {
        if (edge == 0 || width <= 0 || height <= 0) return false
        val radius = height / 2f
        val dx = x - if (edge < 0) 0f else width.toFloat()
        val dy = y - radius
        return x >= 0f && x <= width && y >= 0f && y <= height && dx * dx + dy * dy <= radius * radius
    }
}
