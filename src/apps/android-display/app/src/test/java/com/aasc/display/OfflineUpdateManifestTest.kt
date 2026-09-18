package com.aasc.display

import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineUpdateManifestTest {

    @Test
    fun canonicalJsonSortsObjectKeysAndPreservesArrayOrderWithoutEscapingSlashes() {
        val value = JSONObject("""{"z":"https://host/path","a":[3,true,"喵"]}""")

        assertEquals(
            """{"a":[3,true,"喵"],"z":"https://host/path"}""",
            OfflineUpdateManifest.canonicalJson(value)
        )
    }

    @Test
    fun signedManifestValidatesCodeAndDependencyCompatibility() {
        val keyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val payload = validPayload()
        val manifest = signedManifest(payload, keyPair.private.encoded, keyPair.public.encoded)

        val parsed = OfflineUpdateManifest.parse(manifest, publicPem(keyPair.public.encoded))

        assertEquals(4, parsed.code.version)
        assertEquals(3, parsed.code.requiredDependencyVersion)
        assertEquals(3, parsed.dependencies.version)
        assertTrue(parsed.apkMin == null)
    }

    @Test
    fun optionalReleaseNotesAreVerifiedAndParsed() {
        val keyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val payload = validPayload().apply {
            getJSONObject("components").put("apkMin", validMinApk().put("releaseNotes", "修复缩放\n\n- Display 2 调整为 100%"))
        }
        val manifest = signedManifest(payload, keyPair.private.encoded, keyPair.public.encoded)

        val parsed = OfflineUpdateManifest.parse(manifest, publicPem(keyPair.public.encoded))

        assertEquals("修复缩放\n\n- Display 2 调整为 100%", parsed.apkMin?.releaseNotes)
    }

    @Test
    fun oversizedReleaseNotesAreRejected() {
        val keyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val payload = validPayload().apply {
            getJSONObject("components").put("apkMin", validMinApk().put("releaseNotes", "x".repeat(4097)))
        }
        val manifest = signedManifest(payload, keyPair.private.encoded, keyPair.public.encoded)

        assertRejected(manifest, publicPem(keyPair.public.encoded), "releaseNotes")
    }

    @Test
    fun invalidSignatureOrDifferentPublicKeyIsRejected() {
        val signingKeys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val otherKeys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val manifest = signedManifest(validPayload(), signingKeys.private.encoded, signingKeys.public.encoded)

        try {
            OfflineUpdateManifest.parse(manifest, publicPem(otherKeys.public.encoded))
            throw AssertionError("different public key must reject the manifest")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message.orEmpty().contains("签名"))
        }
    }

    @Test
    fun unsafeUrlsAndDependencyMismatchAreRejectedAfterSignatureVerification() {
        val keyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val unsafePayload = validPayload().apply {
            getJSONObject("components").getJSONObject("code").put("relativeUrl", "code/../evil.zip")
        }
        val unsafeManifest = signedManifest(unsafePayload, keyPair.private.encoded, keyPair.public.encoded)
        val mismatchPayload = validPayload().apply {
            getJSONObject("components").getJSONObject("code").put("requiredDependencyVersion", 2)
        }
        val mismatchManifest = signedManifest(mismatchPayload, keyPair.private.encoded, keyPair.public.encoded)

        assertRejected(unsafeManifest, publicPem(keyPair.public.encoded), "路径")
        assertRejected(mismatchManifest, publicPem(keyPair.public.encoded), "依赖")
    }

    @Test
    fun safeRelativePathRejectsTraversalAbsoluteAndBackslash() {
        assertTrue(OfflineUpdateManifest.isSafeRelativePath("code/code-v4.zip"))
        assertFalse(OfflineUpdateManifest.isSafeRelativePath("../code.zip"))
        assertFalse(OfflineUpdateManifest.isSafeRelativePath("/tmp/code.zip"))
        assertFalse(OfflineUpdateManifest.isSafeRelativePath("code\\code.zip"))
    }

    private fun validPayload(): JSONObject {
        val lockSha = "a".repeat(64)
        return JSONObject().apply {
            put("schemaVersion", 1)
            put("generatedAt", "2026-09-16T00:00:00.000Z")
            put("components", JSONObject().apply {
                put("code", JSONObject().apply {
                    put("version", 4)
                    put("requiredDependencyVersion", 3)
                    put("requiredLockSha256", lockSha)
                    put("relativeUrl", "code/code-v4.zip")
                    put("size", 123)
                    put("sha256", "b".repeat(64))
                })
                put("dependencies", JSONObject().apply {
                    put("version", 3)
                    put("lockSha256", lockSha)
                    put("relativeUrl", "dependencies/dependencies-v3.zip")
                    put("size", 456)
                    put("sha256", "c".repeat(64))
                })
            })
        }
    }


    private fun validMinApk(): JSONObject = JSONObject().apply {
        put("versionCode", 10)
        put("versionName", "0.2.8-offline-min")
        put("packageName", "com.aasc.display.offline")
        put("signerSha256", "d".repeat(64))
        put("modelCompatibilitySha256", "e".repeat(64))
        put("relativeUrl", "apk/aasc-display-offline-min-v10.apk")
        put("size", 789)
        put("sha256", "f".repeat(64))
    }

    private fun signedManifest(payload: JSONObject, privateKeyBytes: ByteArray, publicKeyBytes: ByteArray): String {
        val privateKey = java.security.KeyFactory.getInstance("RSA")
            .generatePrivate(java.security.spec.PKCS8EncodedKeySpec(privateKeyBytes))
        val signature = Signature.getInstance("SHA256withRSA").apply {
            initSign(privateKey)
            update(OfflineUpdateManifest.canonicalJson(payload).toByteArray(Charsets.UTF_8))
        }.sign()
        return JSONObject().apply {
            put("payload", payload)
            put("signature", JSONObject().apply {
                put("algorithm", "SHA256withRSA")
                put("value", Base64.getEncoder().encodeToString(signature))
            })
        }.toString()
    }

    private fun publicPem(encoded: ByteArray): String {
        val body = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(encoded)
        return "-----BEGIN PUBLIC KEY-----\n$body\n-----END PUBLIC KEY-----\n"
    }

    private fun assertRejected(manifest: String, publicKey: String, expectedText: String) {
        try {
            OfflineUpdateManifest.parse(manifest, publicKey)
            throw AssertionError("invalid manifest must be rejected")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message.orEmpty().contains(expectedText))
        }
    }
}
