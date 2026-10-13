package com.aasc.display

import java.net.URI

/** 全量备份只下载控制页本身的服务，不接受网页传入任意下载地址。 */
object FullConfigBackupSavePolicy {
    const val MAX_ZIP_BYTES = 100L * 1024L * 1024L

    fun validRequestId(value: String): Boolean = value.matches(Regex("[A-Za-z0-9_-]{1,96}"))

    fun downloadUrl(pageUrl: String?): String? = try {
        val page = URI(pageUrl ?: "")
        if (page.scheme !in listOf("http", "https") || page.host.isNullOrBlank()
            || page.userInfo != null || !(page.path.endsWith("/upload.html") || page.path.trimEnd('/') == "/control")) {
            null
        } else {
            URI(page.scheme, null, page.host, page.port, "/api/config-backup/export", null, null).toString()
        }
    } catch (_: Exception) { null }

    fun isZipHeader(bytes: ByteArray): Boolean = bytes.size == 4
        && bytes[0] == 0x50.toByte() && bytes[1] == 0x4b.toByte()
        && bytes[2] == 0x03.toByte() && bytes[3] == 0x04.toByte()
}
