package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject

data class NodeRuntimeFile(
    val path: String,
    val size: Long,
    val sha256: String
)

data class NodeRuntimeManifest(
    val version: String,
    val abi: String,
    val entrypoint: String,
    val nodePath: String,
    val files: List<NodeRuntimeFile>
) {

    companion object {
        private const val REQUIRED_ABI = "arm64-v8a"
        private const val REQUIRED_ENTRYPOINT = "server/src/apps/server/boot/server-launcher.js"
        private const val REQUIRED_NODE_PATH = "native/arm64-v8a/libaasc_node.so"
        private val SHA256_PATTERN = Regex("^[a-fA-F0-9]{64}$")

        fun parse(rawJson: String): NodeRuntimeManifest {
            val root = JSONObject(rawJson)
            val version = root.optString("version").trim()
            val abi = root.optString("abi").trim()
            val entrypoint = root.optString("entrypoint").trim()
            val nodePath = root.optString("nodePath").trim()
            require(version.isNotEmpty()) { "Runtime manifest 缺少 version" }
            require(abi == REQUIRED_ABI) { "Runtime manifest ABI 不支持: $abi" }
            require(entrypoint == REQUIRED_ENTRYPOINT) { "Runtime manifest 启动入口无效" }
            require(nodePath == REQUIRED_NODE_PATH) { "Runtime manifest Node 路径无效" }

            val files = parseFiles(root.optJSONArray("files"))
            require(files.any { it.path == entrypoint }) { "Runtime manifest 缺少服务器启动入口" }
            return NodeRuntimeManifest(version, abi, entrypoint, nodePath, files)
        }

        private fun parseFiles(rawFiles: JSONArray?): List<NodeRuntimeFile> {
            require(rawFiles != null && rawFiles.length() > 0) { "Runtime manifest files 不能为空" }
            val files = mutableListOf<NodeRuntimeFile>()
            for (index in 0 until rawFiles.length()) {
                val item = rawFiles.optJSONObject(index)
                    ?: throw IllegalArgumentException("Runtime manifest files[$index] 格式无效")
                val filePath = item.optString("path").trim()
                val size = item.optLong("size", -1L)
                val sha256 = item.optString("sha256").trim()
                require(isSafeRelativePath(filePath)) { "Runtime manifest 文件路径无效: $filePath" }
                require(size >= 0L) { "Runtime manifest 文件大小无效: $filePath" }
                require(SHA256_PATTERN.matches(sha256)) { "Runtime manifest SHA-256 无效: $filePath" }
                require(files.none { it.path == filePath }) { "Runtime manifest 文件重复: $filePath" }
                files += NodeRuntimeFile(filePath, size, sha256.lowercase())
            }
            return files
        }

        private fun isSafeRelativePath(value: String): Boolean {
            if (value.isEmpty() || value.startsWith('/') || value.contains('\\')) return false
            return value.split('/').none { it.isEmpty() || it == "." || it == ".." }
        }
    }
}
