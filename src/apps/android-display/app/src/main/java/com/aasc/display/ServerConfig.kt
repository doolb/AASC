package com.aasc.display

// 启动配置选择器：部署命令传入的服务器地址优先于 APK 本地保存值。
object ServerConfig {

    fun chooseUrl(intentUrl: String?, savedUrl: String?): String {
        val injected = intentUrl?.trim().orEmpty()
        if (injected.isNotEmpty()) return injected
        return savedUrl?.trim().orEmpty()
    }
}
