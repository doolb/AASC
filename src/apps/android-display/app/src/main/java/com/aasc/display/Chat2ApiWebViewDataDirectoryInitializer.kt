package com.aasc.display

/**
 * 在 Chat2API 登录独立进程内只设置一次 WebView 数据目录。
 * Activity 关闭后进程可能继续存活，因此初始化状态必须跨 Activity 实例保留。
 */
internal class Chat2ApiWebViewDataDirectoryInitializer {
    private var initialized = false

    /**
     * Android P 及以上调用数据目录后缀设置器；设置成功后才记为完成。
     * 同步保护状态，避免 Activity 重建或并发入口重复触发平台的一次性接口。
     */
    @Synchronized
    fun initialize(sdkInt: Int, setDataDirectorySuffix: (String) -> Unit) {
        if (sdkInt < ANDROID_P_API_LEVEL || initialized) return

        setDataDirectorySuffix(DATA_DIRECTORY_SUFFIX)
        initialized = true
    }

    private companion object {
        const val ANDROID_P_API_LEVEL = 28
        const val DATA_DIRECTORY_SUFFIX = "aasc_chat2api_login"
    }
}
