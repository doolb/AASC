package com.aasc.display

/** null 表示系统浮窗等事件不能用于判断当前桌面状态。 */
object WallpaperDesktopPolicy {
    fun classify(packageName: String, className: String, ownPackage: String, homes: Set<String>): Boolean? {
        if (packageName.isBlank() || packageName == "com.android.systemui") return null
        if (packageName == ownPackage) return if (className.endsWith("Activity")) false else null
        if (homes.isEmpty()) return null
        return packageName in homes
    }
}
