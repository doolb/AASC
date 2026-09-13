package com.aasc.display

/**
 * SAF 媒体库对外只暴露一个虚拟 POSIX 根目录，不把 content:// URI 转换成文件系统路径。
 */
object SafMediaPath {

    private val RANGE_PATTERN = Regex("^bytes=(\\d*)-(\\d*)$")

    /**
     * 统一路径格式并拒绝所有可能越出 SAF 根目录的分段。
     * SAF 文档树本身负责实际的目录边界，本方法负责协议层的路径边界。
     */
    fun normalize(rawPath: String): String {
        require(!rawPath.contains('\u0000')) { "路径包含非法空字符" }
        require(!rawPath.contains('\\')) { "路径不支持反斜杠" }
        if (rawPath.isEmpty() || rawPath == "/") return "/"

        val slashPath = if (rawPath.startsWith('/')) rawPath else "/$rawPath"
        val pathWithoutTrailingSlash = if (slashPath.endsWith('/')) {
            slashPath.dropLast(1)
        } else {
            slashPath
        }
        require(pathWithoutTrailingSlash.isNotEmpty() && !pathWithoutTrailingSlash.endsWith('/')) {
            "路径包含空分段"
        }

        val segments = pathWithoutTrailingSlash.split('/').drop(1)
        require(segments.none { it.isEmpty() || it == "." || it == ".." }) {
            "路径包含非法分段"
        }
        return "/${segments.joinToString("/")}"
    }

    /**
     * 解析单段 HTTP Range。返回 null 表示没有 Range 或范围无效，调用方可回退到完整响应。
     */
    fun parseRange(rangeHeader: String?, totalSize: Long): SafMediaRange? {
        if (rangeHeader.isNullOrBlank() || totalSize <= 0L) return null
        val match = RANGE_PATTERN.matchEntire(rangeHeader.trim()) ?: return null
        var start = match.groupValues[1].toLongOrNull()
        var end = match.groupValues[2].toLongOrNull()
        if (start == null && end == null) return null

        if (start == null) {
            val suffixLength = end ?: return null
            if (suffixLength <= 0L) return null
            start = (totalSize - suffixLength).coerceAtLeast(0L)
            end = totalSize - 1L
        } else if (end == null) {
            end = totalSize - 1L
        }

        val resolvedStart = start ?: return null
        val resolvedEnd = end ?: return null
        if (resolvedStart > resolvedEnd || resolvedStart >= totalSize) return null
        return SafMediaRange(resolvedStart, resolvedEnd.coerceAtMost(totalSize - 1L))
    }
}

data class SafMediaRange(
    val start: Long,
    val end: Long
)
