package com.aasc.display

import java.io.File
import java.security.MessageDigest
import java.util.Locale

// 模型文件 SHA-256 工具：下载完成后校验临时文件，启动时只读取已保存的 hash 文本比较。
object ModelHash {

    // 分块读取文件，避免把 234MB 模型一次性加载到内存。
    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    // 同时兼容纯 hash 和 sha256sum 的“hash 空格 文件名”格式。
    fun normalize(raw: String): String = raw.trim()
        .split(Regex("\\s+"), limit = 2)
        .firstOrNull()
        .orEmpty()
        .lowercase(Locale.US)

    fun matches(file: File, expectedHash: String): Boolean =
        sha256(file).equals(normalize(expectedHash), ignoreCase = true)
}
