package com.aasc.display

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent

// 无障碍服务：真实触摸注入（系统输入管道 → 跨域 iframe 内容同样接收事件）
class DisplayAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        TouchInjector.service = this
    }

    override fun onDestroy() {
        if (TouchInjector.service === this) TouchInjector.service = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    // action: click=点按 / down=按住 / up=轻点抬起 / contextmenu=长按
    fun performTouch(x: Int, y: Int, action: String): Boolean {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val stroke = when (action) {
            "click" -> GestureDescription.StrokeDescription(path, 0, 120)
            "down" -> GestureDescription.StrokeDescription(path, 0, 2000)
            "up" -> GestureDescription.StrokeDescription(path, 0, 80)
            "contextmenu" -> GestureDescription.StrokeDescription(path, 0, 600)
            else -> return false
        }
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture, null, null)
    }

    // 滚轮 → 垂直滑动：deltaY>0 向下滚 → 手指上滑
    fun performWheel(x: Int, y: Int, deltaY: Int): Boolean {
        if (deltaY == 0) return false
        val dist = deltaY.coerceIn(-2000, 2000)
        val offset = 300f
        val startY = y + offset
        val path = Path().apply {
            moveTo(x.toFloat(), startY)
            lineTo(x.toFloat(), startY - dist)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 250))
            .build()
        return dispatchGesture(gesture, null, null)
    }
}
