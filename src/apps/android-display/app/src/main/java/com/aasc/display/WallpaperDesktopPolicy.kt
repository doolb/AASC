package com.aasc.display

/** null 表示系统浮窗等事件不能用于判断当前桌面状态。 */
object WallpaperDesktopPolicy {
    /** 窗口变动只接受明确变为活动或焦点的事件，避免浮窗和其他后台窗口误判。 */
    fun acceptsWindowEvent(isStateChange: Boolean, isWindowsChange: Boolean, changes: Int,
                           activeMask: Int, focusedMask: Int): Boolean =
        isStateChange || (isWindowsChange && changes and (activeMask or focusedMask) != 0)

    fun classify(packageName: String, className: String, ownPackage: String, homes: Set<String>): Boolean? {
        if (packageName.isBlank() || packageName == "com.android.systemui") return null
        if (packageName == ownPackage) return if (className.endsWith("Activity")) false else null
        if (homes.isEmpty()) return null
        return packageName in homes
    }
}
