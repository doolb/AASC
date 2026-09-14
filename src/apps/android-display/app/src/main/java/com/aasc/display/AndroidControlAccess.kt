package com.aasc.display

/** 原生控制端按钮只由服务端授权状态决定，页面当前是否可见不影响授权本身。 */
object AndroidControlAccess {
    fun shouldShowButton(allowed: Boolean, pageVisible: Boolean): Boolean {
        return allowed && !pageVisible
    }
}
