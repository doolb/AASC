package com.aasc.display

// 触摸注入入口：服务未开启时返回 false，display.html 回退 JS 合成（同源仍可用）
object TouchInjector {

    var service: DisplayAccessibilityService? = null

    fun injectTouch(x: Int, y: Int, action: String): Boolean {
        val svc = service ?: return false
        return svc.performTouch(x, y, action)
    }

    fun injectWheel(x: Int, y: Int, deltaY: Int): Boolean {
        val svc = service ?: return false
        return svc.performWheel(x, y, deltaY)
    }
}
