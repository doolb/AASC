package com.aasc.display

import java.io.File
import java.nio.file.Files
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OfflineDependencyGroupsTest {
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
