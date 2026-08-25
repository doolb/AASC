package com.aasc.tts

// 文本提交策略集中在纯逻辑对象中，避免界面层重复判断和生成阶段才发现输入无效。
object TtsTextPolicy {
    const val MAX_LENGTH = 2000

    // 去除首尾空白后校验内容和长度，返回可以直接交给 SDK 的文本。
    fun normalize(rawText: String): String {
        val text = rawText.trim()
        require(text.isNotEmpty()) { "请输入要生成的文本" }
        require(text.length <= MAX_LENGTH) { "文本不能超过 ${MAX_LENGTH} 个字符" }
        return text
    }
}
