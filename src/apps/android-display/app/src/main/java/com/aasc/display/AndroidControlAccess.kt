package com.aasc.display

/** 原生控制端按钮只由服务端授权状态决定，页面当前是否可见不影响授权本身。 */
object AndroidControlAccess {
    enum class ButtonState {
        COLLAPSED,
        EXPANDED
    }

    enum class ButtonClickAction {
        EXPAND,
        TOGGLE_PAGE
    }

    fun shouldShowButton(allowed: Boolean, pageVisible: Boolean): Boolean {
        return allowed && !pageVisible
    }

    /** 收缩入口第一次点击只展开按钮，第二次点击才切换控制端页面。 */
    fun clickAction(pageVisible: Boolean, state: ButtonState): ButtonClickAction {
        return if (!pageVisible && state == ButtonState.COLLAPSED) {
            ButtonClickAction.EXPAND
        } else {
            ButtonClickAction.TOGGLE_PAGE
        }
    }
}
