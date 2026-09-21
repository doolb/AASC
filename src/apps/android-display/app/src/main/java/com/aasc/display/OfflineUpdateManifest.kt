package com.aasc.display

import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject

data class OfflineUpdateArtifact(
    val version: Int,
    val relativeUrl: String,
    val size: Long,
    val sha256: String,
    val requiredDependencyVersion: Int? = null,
    val requiredLockSha256: String? = null,
    val lockSha256: String? = null
)

data class OfflineMinApkArtifact(
    val versionCode: Int,
    val versionName: String,
    val artifact: OfflineUpdateArtifact,
    val packageName: String,
    val signerSha256: String,
    val modelCompatibilitySha256: String,
    val releaseNotes: String? = null
)

data class OfflineDataRepairArtifact(
    val repairVersion: Int,
    val repairId: String,
    val artifact: OfflineUpdateArtifact,
    val requiredCodeVersion: Int,
    val requiredApkVersionCode: Int?,
    val requiredDataVersion: Int,
    val targetDataVersion: Int,
    val scriptSha256: String,
    val capabilities: List<String>,
    val sensitive: Boolean,
    val releaseNotes: String? = null
)

data class OfflineUpdateManifest(
    val code: OfflineUpdateArtifact,
    val dependencies: OfflineUpdateArtifact,
    val apkMin: OfflineMinApkArtifact?,
    val dataRepair: OfflineDataRepairArtifact? = null
) {
    companion object {
        private const val SIGNATURE_ALGORITHM = "SHA256withRSA"
        private val SHA256_PATTERN = Regex("^[a-fA-F0-9]{64}$")
        private val RELATIVE_PATH_SEGMENT_PATTERN = Regex("^[A-Za-z0-9._-]+$")
        private const val OFFLINE_PACKAGE_NAME = "com.aasc.display.offline"
        private const val MAX_RELEASE_NOTES_CHARS = 4096
        private const val MAX_REPAIR_CAPABILITIES = 32
        private val DATA_REPAIR_CAPABILITIES = setOf(
            "config",
            "user-config",
            "chat2api.config",
            "chat2api.providers",
            "chat2api.accounts",
            "chat2api.model-mappings"
        )

        fun parse(rawJson: String, publicKeyPem: String): OfflineUpdateManifest {
            require(publicKeyPem.isNotBlank()) { "Offline 更新验证公钥为空" }
            val root = JSONObject(rawJson)
            val payload = root.optJSONObject("payload")
                ?: throw IllegalArgumentException("Offline 更新清单缺少 payload")
            val signature = root.optJSONObject("signature")
                ?: throw IllegalArgumentException("Offline 更新清单缺少 signature")
            require(signature.optString("algorithm") == SIGNATURE_ALGORITHM) {
                "Offline 更新清单签名算法不支持"
            }
            val signatureValue = signature.optString("value").trim()
            require(signatureValue.isNotEmpty()) { "Offline 更新清单签名为空" }

            val publicKeyBytes = decodePublicKey(publicKeyPem)
            val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(publicKeyBytes))
            val verifier = Signature.getInstance(SIGNATURE_ALGORITHM).apply {
                initVerify(publicKey)
                update(canonicalJson(payload).toByteArray(Charsets.UTF_8))
            }
            val decodedSignature = try {
                Base64.getDecoder().decode(signatureValue)
            } catch (error: IllegalArgumentException) {
                throw IllegalArgumentException("Offline 更新清单签名编码无效", error)
            }
            require(verifier.verify(decodedSignature)) { "Offline 更新清单签名验证失败" }

            require(readInteger(payload, "schemaVersion") == 1L) {
                "Offline 更新清单 schemaVersion 不支持"
            }
            val components = payload.optJSONObject("components")
                ?: throw IllegalArgumentException("Offline 更新清单缺少 components")
            val codeJson = components.optJSONObject("code")
                ?: throw IllegalArgumentException("Offline 更新清单缺少 code 组件")
            val dependenciesJson = components.optJSONObject("dependencies")
                ?: throw IllegalArgumentException("Offline 更新清单缺少 dependencies 组件")
            val code = parseArtifact(codeJson, "code")
            val dependencies = parseArtifact(dependenciesJson, "dependencies")
            val requiredDependencyVersion = readPositiveInt(codeJson, "requiredDependencyVersion")
            val requiredLockSha256 = readSha256(codeJson, "requiredLockSha256")
            val dependencyLockSha256 = readSha256(dependenciesJson, "lockSha256")
            require(requiredDependencyVersion == dependencies.version && requiredLockSha256 == dependencyLockSha256) {
                "Offline 更新代码与依赖版本或 lockfile 指纹不匹配"
            }

            val apkMin = components.optJSONObject("apkMin")?.let { parseMinApk(it) }
            val dataRepair = components.optJSONObject("dataRepair")?.let { parseDataRepair(it) }
            return OfflineUpdateManifest(
                code.copy(
                    requiredDependencyVersion = requiredDependencyVersion,
                    requiredLockSha256 = requiredLockSha256
                ),
                dependencies.copy(lockSha256 = dependencyLockSha256),
                apkMin,
                dataRepair
            )
        }

        fun canonicalJson(value: Any?): String = when (value) {
            null, JSONObject.NULL -> "null"
            is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { key ->
                "${quoteJsonString(key)}:${canonicalJson(value.get(key))}"
            }
            is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { index ->
                canonicalJson(value.get(index))
            }
            is String -> quoteJsonString(value)
            is Number -> value.toString()
            is Boolean -> value.toString()
            else -> throw IllegalArgumentException("Offline 清单包含不支持的 JSON 类型: ${value.javaClass.name}")
        }

        fun isSafeRelativePath(value: String): Boolean {
            if (value.isBlank() || value.startsWith('/') || value.contains('\\') ||
                value.contains(':') || value.contains('?') || value.contains('#')) return false
            val segments = value.split('/')
            return segments.all { segment ->
                segment.isNotEmpty() && segment != "." && segment != ".." &&
                    RELATIVE_PATH_SEGMENT_PATTERN.matches(segment)
            }
        }

        private fun parseArtifact(value: JSONObject, name: String): OfflineUpdateArtifact {
            val version = readPositiveInt(value, "version")
            val relativeUrl = value.optString("relativeUrl").trim()
            require(isSafeRelativePath(relativeUrl)) { "Offline 清单 $name 路径不安全: $relativeUrl" }
            val size = readInteger(value, "size")
            require(size in 1..MAX_ARTIFACT_SIZE) { "Offline 清单 $name 文件大小无效" }
            return OfflineUpdateArtifact(
                version = version,
                relativeUrl = relativeUrl,
                size = size,
                sha256 = readSha256(value, "sha256")
            )
        }

        private fun parseMinApk(value: JSONObject): OfflineMinApkArtifact {
            val versionCode = readPositiveInt(value, "versionCode")
            val versionName = value.optString("versionName").trim()
            require(versionName.isNotEmpty()) { "Offline 清单 apkMin.versionName 无效" }
            val artifact = parseArtifact(value.apply { put("version", versionCode) }, "apkMin")
            val packageName = value.optString("packageName").trim()
            require(packageName == OFFLINE_PACKAGE_NAME) { "Offline 更新 APK 包名不匹配" }
            val releaseNotes = if (!value.has("releaseNotes") || value.isNull("releaseNotes")) {
                null
            } else {
                val rawReleaseNotes = value.opt("releaseNotes")
                require(rawReleaseNotes is String) { "Offline 清单 apkMin.releaseNotes 必须是字符串" }
                val normalized = rawReleaseNotes.trim()
                require(normalized.isNotEmpty()) { "Offline 清单 apkMin.releaseNotes 不能为空" }
                require(normalized.codePointCount(0, normalized.length) <= MAX_RELEASE_NOTES_CHARS) {
                    "Offline 清单 apkMin.releaseNotes 超过 $MAX_RELEASE_NOTES_CHARS 个 Unicode 字符"
                }
                normalized
            }
            return OfflineMinApkArtifact(
                versionCode = versionCode,
                versionName = versionName,
                artifact = artifact,
                packageName = packageName,
                signerSha256 = readSha256(value, "signerSha256"),
                modelCompatibilitySha256 = readSha256(value, "modelCompatibilitySha256"),
                releaseNotes = releaseNotes
            )
        }

        private fun parseDataRepair(value: JSONObject): OfflineDataRepairArtifact {
            val repairVersion = readPositiveInt(value, "repairVersion")
            val artifact = parseArtifact(value.apply { put("version", repairVersion) }, "dataRepair")
            val repairId = value.optString("repairId").trim()
            require(Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$").matches(repairId)) {
                "Offline 清单 dataRepair.repairId 无效"
            }
            require(artifact.version == repairVersion) { "Offline 清单 dataRepair 版本不一致" }
            val requiredCodeVersion = readPositiveInt(value, "requiredCodeVersion")
            val requiredApkVersionCode = if (value.has("requiredApkVersionCode") && !value.isNull("requiredApkVersionCode")) {
                readPositiveInt(value, "requiredApkVersionCode")
            } else {
                null
            }
            val requiredDataVersion = readNonNegativeInt(value, "requiredDataVersion")
            val targetDataVersion = readNonNegativeInt(value, "targetDataVersion")
            require(targetDataVersion >= requiredDataVersion) {
                "Offline 清单 dataRepair.targetDataVersion 不能小于 requiredDataVersion"
            }
            val scriptSha256 = readSha256(value, "scriptSha256")
            val capabilitiesJson = value.optJSONArray("capabilities")
                ?: throw IllegalArgumentException("Offline 清单 dataRepair.capabilities 缺失")
            require(capabilitiesJson.length() in 1..MAX_REPAIR_CAPABILITIES) {
                "Offline 清单 dataRepair.capabilities 数量无效"
            }
            val capabilities = (0 until capabilitiesJson.length()).map { index ->
                val capability = capabilitiesJson.optString(index).trim()
                require(capability.isNotEmpty() && capability.length <= 128) {
                    "Offline 清单 dataRepair.capabilities[$index] 无效"
                }
                capability
            }
            require(capabilities.distinct().size == capabilities.size) {
                "Offline 清单 dataRepair.capabilities 不能重复"
            }
            require(capabilities.all(DATA_REPAIR_CAPABILITIES::contains)) {
                "Offline 清单 dataRepair.capabilities 包含未注册能力"
            }
            val sensitive = value.optBoolean("sensitive", false)
            require(!capabilities.contains("chat2api.accounts") || sensitive) {
                "Offline 清单 dataRepair 访问 Chat2API 账号必须声明 sensitive"
            }
            val releaseNotes = parseReleaseNotes(value, "dataRepair")
            return OfflineDataRepairArtifact(
                repairVersion,
                repairId,
                artifact,
                requiredCodeVersion,
                requiredApkVersionCode,
                requiredDataVersion,
                targetDataVersion,
                scriptSha256,
                capabilities,
                sensitive,
                releaseNotes
            )
        }

        private fun parseReleaseNotes(value: JSONObject, component: String): String? {
            if (!value.has("releaseNotes") || value.isNull("releaseNotes")) return null
            val raw = value.opt("releaseNotes")
            require(raw is String) { "Offline 清单 $component.releaseNotes 必须是字符串" }
            val normalized = raw.trim()
            require(normalized.isNotEmpty() && normalized.codePointCount(0, normalized.length) <= MAX_RELEASE_NOTES_CHARS) {
                "Offline 清单 $component.releaseNotes 无效"
            }
            return normalized
        }

        private fun readPositiveInt(value: JSONObject, key: String): Int {
            val parsed = readInteger(value, key)
            require(parsed in 1..Int.MAX_VALUE.toLong()) { "Offline 清单 $key 必须是正整数" }
            return parsed.toInt()
        }

        private fun readNonNegativeInt(value: JSONObject, key: String): Int {
            val parsed = readInteger(value, key)
            require(parsed in 0..Int.MAX_VALUE.toLong()) { "Offline 清单 $key 必须是非负整数" }
            return parsed.toInt()
        }

        private fun readInteger(value: JSONObject, key: String): Long {
            val number = value.opt(key) as? Number
                ?: throw IllegalArgumentException("Offline 清单 $key 必须是整数")
            val longValue = number.toLong()
            require(number.toDouble() == longValue.toDouble()) { "Offline 清单 $key 必须是整数" }
            return longValue
        }

        private fun readSha256(value: JSONObject, key: String): String {
            val hash = value.optString(key).trim().lowercase()
            require(SHA256_PATTERN.matches(hash)) { "Offline 清单 $key SHA-256 无效" }
            return hash
        }

        private fun decodePublicKey(pem: String): ByteArray {
            val encoded = pem
                .replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .filterNot { it.isWhitespace() }
            require(encoded.isNotEmpty()) { "Offline 更新公钥 PEM 无效" }
            return try {
                Base64.getDecoder().decode(encoded)
            } catch (error: IllegalArgumentException) {
                throw IllegalArgumentException("Offline 更新公钥 Base64 无效", error)
            }
        }

        private fun quoteJsonString(value: String): String = buildString(value.length + 2) {
            append('"')
            for (character in value) {
                when (character) {
                    '"' -> append("\\\"")
                    '\\' -> append("\\\\")
                    '\b' -> append("\\b")
                    '\u000C' -> append("\\f")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> if (character.code < 0x20) {
                        append("\\u%04x".format(character.code))
                    } else {
                        append(character)
                    }
                }
            }
            append('"')
        }

        private const val MAX_ARTIFACT_SIZE = 8L * 1024L * 1024L * 1024L
    }
}
