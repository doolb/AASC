package com.aasc.display

// 启动配置选择器：部署命令传入的服务器地址优先于 APK 本地保存值。
object ServerConfig {

    fun chooseUrl(intentUrl: String?, savedUrl: String?): String {
        val injected = intentUrl?.trim().orEmpty()
        if (injected.isNotEmpty()) return injected
        return savedUrl?.trim().orEmpty()
    }

    /**
     * 将配置地址转换为 APK 要加载的正式显示页面。
     * 普通主机地址仍然默认进入 display，兼容既有部署参数。
     */
    fun pageUrl(input: String): String {
        val value = input.trim()
        if (value.isEmpty()) return ""
        val withScheme = if (value.startsWith("http://") || value.startsWith("https://")) value else "https://$value"
        val path = withScheme.substringBefore('?').trimEnd('/')
        return when {
            path.endsWith("/display") -> withScheme
            else -> "$withScheme/display"
        }
    }
}
