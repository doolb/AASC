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
}
