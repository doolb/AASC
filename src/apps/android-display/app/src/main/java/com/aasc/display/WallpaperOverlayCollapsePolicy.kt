package com.aasc.display

/** 本机设置以秒为单位，零表示不自动收起。 */
internal object WallpaperOverlayCollapsePolicy {
    fun normalize(seconds: Int): Int = seconds.coerceIn(0, 3600)
    fun delayMillis(seconds: Int): Long? = normalize(seconds).takeIf { it > 0 }?.toLong()?.times(1000)
}
