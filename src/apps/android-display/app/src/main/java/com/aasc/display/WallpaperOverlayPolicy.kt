package com.aasc.display

/** 壁纸曾经实际显示，才允许在其他应用遮挡壁纸时继续显示语音浮窗。 */
internal object WallpaperOverlayPolicy {
    fun canShow(hideOtherApps: Boolean, visible: Boolean, wasVisible: Boolean, desktop: Boolean?,
                preview: Boolean, foreground: Boolean, suspended: Boolean, attached: Boolean): Boolean {
        if (preview || foreground || suspended || !attached) return false
        if (!hideOtherApps && wasVisible) return true
        return visible && desktop != false
    }
}
