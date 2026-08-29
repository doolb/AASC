package com.aasc.asr

import java.util.Locale

// 网页和 HTTP 接口使用的离线 ASR 语言模式；流式 ASR 使用独立的固定双语模型，不走这里的配置。
enum class AsrLanguageMode(
    val queryValue: String,
    val engineLanguage: String
) {
    AUTO("auto", "auto"),
    ZH("zh", "zh"),
    EN("en", "en");

    companion object {
        fun parse(value: String?): AsrLanguageMode? = when (value?.trim()?.lowercase(Locale.ROOT)) {
            null, "" -> AUTO
            "auto" -> AUTO
            "zh" -> ZH
            "en" -> EN
            else -> null
        }
    }
}
