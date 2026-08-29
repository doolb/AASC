package com.aasc.display

import java.util.Locale

// 正式 APK 使用的离线 ASR 语言模式；结果不再执行 Unicode 脚本过滤。
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
