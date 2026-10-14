package com.aasc.display

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import java.util.zip.ZipFile
import org.junit.Assume
import java.nio.file.Files
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OfflineDependencyGroupsTest {
    private fun archive(root: File, name: String, entries: Map<String, String>): File {
        val file = File(root, "$name.zip")
        ZipOutputStream(file.outputStream()).use { zip ->
            for ((path, value) in entries) {
                zip.putNextEntry(ZipEntry(path)); if (!path.endsWith("/")) zip.write(value.toByteArray()); zip.closeEntry()
            }
        }
        return file
    }
    private fun assertRejected(action: () -> Unit) {
        try { action(); fail("必须拒绝无效归档") } catch (_: IllegalArgumentException) { }
    }
    @Test fun realGroupArchivesComposeWithoutGlobalManifestOrExpressInAndroidLayer() {
        val root = Files.createTempDirectory("aasc-group-archive").toFile()
        try {
            val combined = File(root, "combined/node_modules")
            for ((name, files) in linkedMapOf(
                "common" to mapOf("node_modules/express/package.json" to "{\"version\":\"4.18.2\"}"),
                "android" to mapOf("node_modules/native-addon/addon.node" to "native-fixture"))) {
                val raw = archive(root, "$name-raw", files)
                val source = File(root, "$name-source")
                OfflineUpdateManager.extractZipArchive(raw, source)
                val target = if (name == "common") null else JSONObject().put("os", "android").put("arch", "arm64")
                val hash = OfflineDependencyGroups.contentHash(File(source, "node_modules"))
                val metadata = JSONObject().put("group", name).put("version", 9).put("contentSha256", hash)
                    .put("target", target ?: JSONObject.NULL)
                val zip = archive(root, name, files + ("dependency-group.json" to metadata.toString()))
                // 与prepare生产路径同一入口，确保没有再选到旧单包校验分支。
                val inspection = OfflineDependencyGroups.inspectArchive(zip)
                assertFalse(inspection.entryNames.contains("dependency-manifest.json"))
                if (name == "android") assertFalse(inspection.entryNames.contains("node_modules/express/package.json"))
                val extracted = File(root, "$name-extracted")
                OfflineUpdateManager.extractZipArchive(zip, extracted)
                val entry = OfflineUpdateArtifact(9, "dependencies/$name/dependencies-v9.zip", zip.length(),
                    OfflineDependencyGroups.hashFile(zip), contentSha256 = hash, target = target)
                assertTrue(OfflineDependencyGroups.verifyLayer(extracted, name, entry))
                OfflineDependencyGroups.merge(File(extracted, "node_modules"), combined)
                File(extracted, files.keys.first()).appendText("tampered")
                assertFalse(OfflineDependencyGroups.verifyLayer(extracted, name, entry))
                assertRejected { OfflineUpdateManager.inspectComponentArchive(zip, "dependencies") }
            }
            assertTrue(File(combined, "express/package.json").isFile)
            assertTrue(File(combined, "native-addon/addon.node").isFile)
        } finally { root.deleteRecursively() }
    }
    @Test fun legacyArchiveStillRequiresGlobalManifestAndExpress() {
        val root = Files.createTempDirectory("aasc-legacy-archive").toFile()
        try {
            val files = mapOf("dependency-manifest.json" to "{}", "node_modules/express/package.json" to "{}")
            OfflineUpdateManager.inspectComponentArchive(archive(root, "valid", files), "dependencies")
            for (missing in files.keys) assertRejected {
                OfflineUpdateManager.inspectComponentArchive(archive(root, missing.substringBefore('/'), files - missing), "dependencies")
            }
            assertRejected { OfflineDependencyGroups.inspectArchive(archive(root, "legacy-as-group", files)) }
        } finally { root.deleteRecursively() }
    }
    @Test fun groupArchiveRejectsMissingMetadataEmptyModulesAndForeignPaths() {
        val root = Files.createTempDirectory("aasc-invalid-group").toFile()
        try {
            val files = mapOf("dependency-group.json" to "{}", "node_modules/addon/addon.node" to "native")
            val variants = listOf(files - "dependency-group.json", files - "node_modules/addon/addon.node",
                mapOf("dependency-group.json" to "{}", "node_modules/empty/" to ""),
                files + ("config/config.json" to "{}"), files + ("../escape" to "x"),
                files + ("dependency-manifest.json" to "{}"))
            for ((index, invalid) in variants.withIndex()) assertRejected {
                OfflineDependencyGroups.inspectArchive(archive(root, "invalid-$index", invalid))
            }
            assertRejected { OfflineUpdateManager.inspectComponentArchive(archive(root, "unknown", files), "unknown") }
        } finally { root.deleteRecursively() }
    }
    @Test fun publishedV9GroupsValidateAndComposeThroughProductionArchiveEntry() {
        // 仅出包机额外执行真实发布归档检查，普通开发机保持上述独立ZIP用例可运行。
        val artifactRoot = System.getenv("AASC_OFFLINE_GROUP_ARCHIVE_ROOT")
        Assume.assumeTrue("需提供出包机真实归档目录", !artifactRoot.isNullOrEmpty())
        val signedManifest = System.getenv("AASC_OFFLINE_GROUP_MANIFEST") ?: error("缺少已签名清单")
        val publicKey = System.getenv("AASC_OFFLINE_GROUP_PUBLIC_KEY") ?: error("缺少公开验证密钥")
        val manifest = OfflineUpdateManifest.parse(File(signedManifest).readText(), File(publicKey).readText())
        val root = Files.createTempDirectory("aasc-published-groups").toFile()
        try {
            for ((name, entry) in manifest.dependencies.androidLayers()) {
                val zip = File(artifactRoot, entry.relativeUrl)
                assertEquals(entry.size, zip.length()); assertEquals(entry.sha256, OfflineDependencyGroups.hashFile(zip))
                OfflineDependencyGroups.inspectArchive(zip)
                val extracted = File(root, name); OfflineUpdateManager.extractZipArchive(zip, extracted)
                assertTrue("真实${name}组内容必须匹配签名清单", OfflineDependencyGroups.verifyLayer(extracted, name, entry))
                OfflineDependencyGroups.merge(File(extracted, "node_modules"), File(root, "combined/node_modules"))
            }
            val combined = File(root, "combined")
            assertTrue(File(combined, "node_modules/express/package.json").isFile)
            val code = File(artifactRoot, manifest.code.relativeUrl)
            val lock = File(root, "package-lock.json")
            ZipFile(code).use { zip -> zip.getInputStream(zip.getEntry("package-lock.json")).use { input ->
                lock.outputStream().use { output -> input.copyTo(output) }
            } }
            assertEquals(manifest.dependencies.lockSha256, OfflineDependencyGroups.hashFile(lock))
            OfflineDependencyGroups.validateLock(combined, lock)
        } finally { root.deleteRecursively() }
    }
    @Test fun productionLockAcceptsScopedNestedPackagesAndRejectsUnsafeOrWrongVersions() {
        val root = Files.createTempDirectory("aasc-scoped-lock").toFile()
        try {
            val relative = "node_modules/@scope/parent/node_modules/@other/child"
            val manifest = File(root, "$relative/package.json")
            manifest.parentFile.mkdirs(); manifest.writeText("{\"version\":\"1.2.3\"}")
            val lock = File(root, "package-lock.json")
            fun writeLock(path: String, version: String = "1.2.3") {
                lock.writeText(JSONObject().put("packages", JSONObject().put("", JSONObject())
                    .put(path, JSONObject().put("version", version))).toString())
            }
            writeLock(relative); OfflineDependencyGroups.validateLock(root, lock)
            writeLock(relative, "9.0.0"); assertRejected { OfflineDependencyGroups.validateLock(root, lock) }
            for (invalid in listOf("node_modules/../outside", "node_modules/@scope/../../outside",
                "/node_modules/@scope/child", "node_modules/child\\outside", "config/child")) {
                writeLock(invalid); assertRejected { OfflineDependencyGroups.validateLock(root, lock) }
            }
            val linked = File(root, "node_modules/@linked"); Files.createSymbolicLink(linked.toPath(), manifest.parentFile.toPath())
            writeLock("node_modules/@linked"); assertRejected { OfflineDependencyGroups.validateLock(root, lock) }
        } finally { root.deleteRecursively() }
    }
    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    private fun payload(): JSONObject {
        val groups = JSONObject()
        for (name in listOf("common", "android", "linux64", "win64")) {
            val target = when (name) {
                "common" -> JSONObject.NULL
                "android" -> JSONObject().put("os", "android").put("arch", "arm64").put("libc", "bionic").put("nodeMajor", 26)
                "linux64" -> JSONObject().put("os", "linux").put("arch", "x64").put("libc", "glibc")
                else -> JSONObject().put("os", "win32").put("arch", "x64").put("libc", "none")
            }
            groups.put(name, JSONObject().put("version", 3).put("relativeUrl", "dependencies/$name/dependencies-v3.zip")
                .put("size", 100).put("sha256", "a".repeat(64)).put("contentSha256", "b".repeat(64)).put("target", target))
        }
        return JSONObject().put("schemaVersion", 1).put("components", JSONObject()
            .put("code", JSONObject().put("version", 4).put("relativeUrl", "code/code-v4.zip").put("size", 123)
                .put("sha256", "c".repeat(64)).put("requiredDependencyVersion", 3).put("requiredLockSha256", "d".repeat(64)))
            .put("dependencies", JSONObject().put("version", 3).put("lockSha256", "d".repeat(64)).put("size", 400)
                .put("groups", groups).put("sha256", digest(OfflineUpdateManifest.canonicalJson(groups)))))
    }
    private fun parse(payload: JSONObject): OfflineUpdateManifest {
        val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val signature = Signature.getInstance("SHA256withRSA").apply { initSign(keys.private); update(OfflineUpdateManifest.canonicalJson(payload).toByteArray()) }.sign()
        val envelope = JSONObject().put("payload", payload).put("signature", JSONObject().put("algorithm", "SHA256withRSA")
            .put("value", Base64.getEncoder().encodeToString(signature)))
        val pem = "-----BEGIN PUBLIC KEY-----\n${Base64.getEncoder().encodeToString(keys.public.encoded)}\n-----END PUBLIC KEY-----"
        return OfflineUpdateManifest.parse(envelope.toString(), pem)
    }
    @Test fun signedFourGroupsSelectOnlyCommonAndAndroid() {
        val parsed = parse(payload()); assertEquals(listOf("common", "android"), parsed.dependencies.androidLayers().map { it.first })
        assertEquals(200L, parsed.dependencies.androidDownloadBytes()); assertEquals(400L, parsed.dependencies.size)
    }
    @Test fun platformAndAggregateTamperingAreRejected() {
        for (scenario in listOf("platform", "hash", "path", "missing")) {
            val value = payload(); val dependencies = value.getJSONObject("components").getJSONObject("dependencies")
            val groups = dependencies.getJSONObject("groups")
            when (scenario) {
                "platform" -> groups.getJSONObject("android").getJSONObject("target").put("arch", "x64")
                "hash" -> dependencies.put("sha256", "e".repeat(64))
                "path" -> groups.getJSONObject("common").put("relativeUrl", "dependencies/../code.zip")
                else -> groups.remove("win64")
            }
            try { parse(value); fail("should reject $scenario") } catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun nodeAbiMismatchIsRejected() {
        val value = payload(); value.getJSONObject("components").getJSONObject("dependencies").getJSONObject("groups")
            .getJSONObject("android").getJSONObject("target").put("nodeAbi", "999")
        try { parse(value); fail("must reject ABI") } catch (error: IllegalArgumentException) { assertTrue(error.message.orEmpty().contains("ABI")) }
    }
    @Test fun contentFingerprintMatchesJsCanonicalContractAndDetectsMutation() {
        val root = Files.createTempDirectory("aasc-group").toFile()
        try {
            val modules = File(root, "node_modules").apply { mkdirs() }; File(modules, "a.js").writeText("hello")
            val expected = digest("[{\"path\":\"a.js\",\"sha256\":\"${digest("hello")}\"}]")
            assertEquals(expected, OfflineDependencyGroups.contentHash(modules))
            File(modules, "a.js").appendText("changed"); assertNotEquals(expected, OfflineDependencyGroups.contentHash(modules))
        } finally { root.deleteRecursively() }
    }
    @Test fun identicalFileConflictAndLinksAreRejected() {
        val root = Files.createTempDirectory("aasc-merge").toFile()
        try {
            val first = File(root, "first").apply { mkdirs() }; val second = File(root, "second").apply { mkdirs() }
            File(first, "same.js").writeText("hello"); File(second, "same.js").writeText("hello")
            try { OfflineDependencyGroups.merge(first, second); fail("must reject conflict") } catch (_: IllegalArgumentException) { }
            Files.createSymbolicLink(File(first, "linked").toPath(), second.toPath())
            try { OfflineDependencyGroups.contentHash(first); fail("must reject link") } catch (_: IllegalArgumentException) { }
        } finally { root.deleteRecursively() }
    }
}
