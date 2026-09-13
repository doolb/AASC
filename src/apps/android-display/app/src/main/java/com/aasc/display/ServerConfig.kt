package com.aasc.display

// 启动配置选择器：部署命令传入的服务器地址优先于 APK 本地保存值。
object ServerConfig {

    const val DEFAULT_OFFLINE_SERVER_URL = "https://127.0.0.1:8081"

    fun chooseUrl(intentUrl: String?, savedUrl: String?, offlineMode: Boolean = false): String {
        val injected = intentUrl?.trim().orEmpty()
        if (injected.isNotEmpty()) return injected
        val saved = savedUrl?.trim().orEmpty()
        if (saved.isNotEmpty()) return saved
        return if (offlineMode) DEFAULT_OFFLINE_SERVER_URL else ""
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

    fun controlPageUrl(input: String): String {
        val base = baseUrl(input)
        if (base.isEmpty()) return ""
        return "$base/control"
    }

    // Node 子服务器需要主服务器根地址，不能把 /display 页面路径写进 aasc.mainServerUrl。
    fun baseUrl(input: String): String {
        val value = input.trim()
        if (value.isEmpty()) return ""
        val withScheme = if (value.startsWith("http://") || value.startsWith("https://")) value else "https://$value"
        return withScheme.substringBefore('?').trimEnd('/').removeSuffix("/display")
    }
}
