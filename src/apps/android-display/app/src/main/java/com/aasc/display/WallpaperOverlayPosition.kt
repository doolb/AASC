package com.aasc.display

/** 记录浮窗在可移动范围内的相对位置，跨分辨率恢复时始终限制在屏幕内。 */
internal data class WallpaperOverlayPosition(
    val xFraction: Float,
    val yFraction: Float,
    val edge: Int,
    val collapsed: Boolean
) {
    fun resolve(screenWidth: Int, screenHeight: Int, viewWidth: Int, viewHeight: Int): Pair<Int, Int> {
        val maxX = (screenWidth - viewWidth).coerceAtLeast(0)
        val maxY = (screenHeight - viewHeight).coerceAtLeast(0)
        val safeX = if (xFraction.isFinite()) xFraction.coerceIn(0f, 1f) else 0f
        val safeY = if (yFraction.isFinite()) yFraction.coerceIn(0f, 1f) else 0f
        val x = when {
            edge < 0 -> 0
            edge > 0 -> maxX
            else -> (safeX * maxX).toInt()
        }
        return x to (safeY * maxY).toInt()
    }

    companion object {
        fun capture(x: Int, y: Int, screenWidth: Int, screenHeight: Int, viewWidth: Int, viewHeight: Int, edge: Int, collapsed: Boolean): WallpaperOverlayPosition {
            val maxX = (screenWidth - viewWidth).coerceAtLeast(0)
            val maxY = (screenHeight - viewHeight).coerceAtLeast(0)
            val safeEdge = edge.coerceIn(-1, 1)
            val fractionX = if (maxX > 0) x.coerceIn(0, maxX).toFloat() / maxX else 0f
            val fractionY = if (maxY > 0) y.coerceIn(0, maxY).toFloat() / maxY else 0f
            return WallpaperOverlayPosition(fractionX, fractionY, safeEdge, collapsed && safeEdge != 0)
        }
    }
}
