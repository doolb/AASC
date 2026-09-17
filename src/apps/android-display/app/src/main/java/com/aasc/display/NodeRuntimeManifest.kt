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
    val files: List<NodeRuntimeFile>,
    val modelAssets: List<NodeRuntimeFile> = emptyList(),
    val verifyRuntime: Boolean = true,
    val updateOnly: Boolean = false,
    val allowedRuntimeLibraryPaths: Set<String> = emptySet()
) {

    companion object {
        private const val REQUIRED_ABI = "arm64-v8a"
        private const val REQUIRED_ENTRYPOINT = "server/src/apps/server/boot/server-launcher.js"
        private const val REQUIRED_NODE_PATH = "native/arm64-v8a/libaasc_node.so"
        private val SHA256_PATTERN = Regex("^[a-fA-F0-9]{64}$")
        private val UPDATE_ONLY_RUNTIME_LIBRARIES = setOf(
            "libz.so.1",
            "libcares.so",
            "libsqlite3.so",
            "libffi.so",
            "libcrypto.so.3",
            "libssl.so.3",
            "libicui18n.so.78",
            "libicuuc.so.78",
            "libicudata.so.78"
        )

        fun parse(rawJson: String): NodeRuntimeManifest {
            val root = JSONObject(rawJson)
            val version = root.optString("version").trim()
            val abi = root.optString("abi").trim()
            val updateOnly = if (root.has("updateOnly")) {
                require(!root.isNull("updateOnly") && root.opt("updateOnly") is Boolean) {
                    "Runtime manifest updateOnly 必须是布尔值"
                }
                root.optBoolean("updateOnly")
            } else {
                false
            }
            val entrypoint = root.optString("entrypoint").trim()
            val nodePath = root.optString("nodePath").trim()
            val verifyRuntime = if (root.has("verifyRuntime")) {
                require(!root.isNull("verifyRuntime")) { "Runtime manifest verifyRuntime 不能为 null" }
                root.optBoolean("verifyRuntime")
            } else {
                true
            }
            require(version.isNotEmpty()) { "Runtime manifest 缺少 version" }
            require(abi == REQUIRED_ABI) { "Runtime manifest ABI 不支持: $abi" }
            if (!updateOnly) {
                require(entrypoint == REQUIRED_ENTRYPOINT) { "Runtime manifest 启动入口无效" }
                require(nodePath == REQUIRED_NODE_PATH) { "Runtime manifest Node 路径无效" }
            }

            val files = parseFiles(root.optJSONArray("files"))
            val modelAssets = parseFiles(root.optJSONArray("modelAssets"), "modelAssets")
            require(modelAssets.none { asset -> files.any { file -> file.path == asset.path } }) {
                "Runtime manifest 模型资产不能与安装文件重复"
            }
            val allowedRuntimeLibraryPaths = parseAllowedRuntimeLibraryPaths(root.optJSONArray("allowedRuntimeLibraryPaths"))
            if (updateOnly) {
                val expectedPrefix = "runtime/$abi/lib/"
                require(modelAssets.isEmpty()) { "update-only Runtime 不允许模型资产" }
                require(allowedRuntimeLibraryPaths.isNotEmpty() && files.map { it.path }.toSet() == allowedRuntimeLibraryPaths) {
                    "update-only Runtime files 必须与动态库允许列表完全一致"
                }
                require(files.all { file ->
                    file.path.startsWith(expectedPrefix) &&
                        file.path.substringAfterLast('/') in UPDATE_ONLY_RUNTIME_LIBRARIES
                }) { "update-only Runtime 只能包含指定 Node 动态库" }
            } else {
                require(allowedRuntimeLibraryPaths.isEmpty()) {
                    "普通 Runtime manifest 不允许声明 update-only 动态库列表"
                }
                require(files.any { it.path == entrypoint }) { "Runtime manifest 缺少服务器启动入口" }
            }
            return NodeRuntimeManifest(
                version,
                abi,
                entrypoint,
                nodePath,
                files,
                modelAssets,
                verifyRuntime,
                updateOnly,
                allowedRuntimeLibraryPaths
            )
        }

        private fun parseAllowedRuntimeLibraryPaths(rawPaths: JSONArray?): Set<String> {
            if (rawPaths == null) return emptySet()
            val paths = linkedSetOf<String>()
            for (index in 0 until rawPaths.length()) {
                val value = rawPaths.optString(index).trim()
                require(isSafeRelativePath(value) && paths.add(value)) {
                    "Runtime manifest allowedRuntimeLibraryPaths[$index] 无效: $value"
                }
            }
            return paths
        }

        private fun parseFiles(rawFiles: JSONArray?, fieldName: String = "files"): List<NodeRuntimeFile> {
            if (rawFiles == null) {
                return if (fieldName == "modelAssets") {
                    emptyList()
                } else {
                    throw IllegalArgumentException("Runtime manifest files 不能为空")
                }
            }
            if (fieldName == "files") require(rawFiles.length() > 0) { "Runtime manifest files 不能为空" }
            val files = mutableListOf<NodeRuntimeFile>()
            for (index in 0 until rawFiles.length()) {
                val item = rawFiles.optJSONObject(index)
                    ?: throw IllegalArgumentException("Runtime manifest $fieldName[$index] 格式无效")
                val filePath = item.optString("path").trim()
                val size = item.optLong("size", -1L)
                val sha256 = item.optString("sha256").trim()
                require(isSafeRelativePath(filePath)) { "Runtime manifest $fieldName 路径无效: $filePath" }
                require(size >= 0L) { "Runtime manifest $fieldName 文件大小无效: $filePath" }
                require(SHA256_PATTERN.matches(sha256)) { "Runtime manifest $fieldName SHA-256 无效: $filePath" }
                require(files.none { it.path == filePath }) { "Runtime manifest $fieldName 文件重复: $filePath" }
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
