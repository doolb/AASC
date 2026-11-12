package com.aasc.display

/** 抖音精选使用桌面布局；其余网站维持系统 WebView 默认标识。 */
internal object BrowserMediaUserAgent {
    fun forOrigin(origin: String, defaultAgent: String): String {
        if (origin != "https://www.douyin.com") return defaultAgent
        return defaultAgent.replace(Regex("\\(Linux; Android[^)]*\\)"), "(X11; Linux x86_64)")
            .replace("Version/4.0 ", "").replace("Mobile Safari/", "Safari/")
    }
}
