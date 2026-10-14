package com.aasc.display

import java.io.File
import java.nio.file.Files
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OfflineDataRepairStateTest {
    @Test fun 签名兼容版本集合按契约解析且拒绝重复或错误类型() {
        val pair = java.security.KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val publicKey = "-----BEGIN PUBLIC KEY-----\n${java.util.Base64.getEncoder().encodeToString(pair.public.encoded)}\n-----END PUBLIC KEY-----"
        fun signed(compatible: Any): String {
            val lock = "a".repeat(64)
            val code = JSONObject().put("version", 1).put("relativeUrl", "code/code-v1.zip").put("size", 1).put("sha256", lock)
                .put("requiredDependencyVersion", 1).put("requiredLockSha256", lock)
            val dependencies = JSONObject().put("version", 1).put("relativeUrl", "dependencies/dependencies-v1.zip")
                .put("size", 1).put("sha256", lock).put("lockSha256", lock)
            val repair = JSONObject().put("version", 3).put("repairVersion", 3).put("repairId", "repair-3")
                .put("relativeUrl", "data/data-repair-v3.zip").put("size", 1).put("sha256", lock).put("scriptSha256", lock)
                .put("requiredCodeVersion", 1).put("requiredApkVersionCode", 1).put("requiredDataVersion", 0)
                .put("targetDataVersion", 3).put("capabilities", JSONArray().put("config")).put("compatibleDataVersions", compatible)
            val payload = JSONObject().put("schemaVersion", 1).put("components", JSONObject().put("code", code)
                .put("dependencies", dependencies).put("dataRepair", repair))
            val signer = java.security.Signature.getInstance("SHA256withRSA").apply { initSign(pair.private)
                update(OfflineUpdateManifest.canonicalJson(payload).toByteArray()) }
            return JSONObject().put("payload", payload).put("signature", JSONObject().put("algorithm", "SHA256withRSA")
                .put("value", java.util.Base64.getEncoder().encodeToString(signer.sign()))).toString()
        }
        assertEquals(listOf(0, 1, 2), OfflineUpdateManifest.parse(signed(JSONArray(listOf(0, 1, 2))), publicKey).dataRepair!!.compatibleDataVersions)
        for (bad in listOf(JSONArray(listOf(0, 0)), "0,1", JSONArray(listOf(0, 4)))) {
            assertThrows(IllegalArgumentException::class.java) { OfflineUpdateManifest.parse(signed(bad), publicKey) }
        }
    }
    private fun repair() = OfflineDataRepairArtifact(2, "repair-2", OfflineUpdateArtifact(2, "data/data-repair-v2.zip", 1, "a".repeat(64)),
        1, null, 1, 2, "b".repeat(64), listOf("user-config"), false)

    private fun baseline(source: File): File {
        File(source, "config/config.json").apply { parentFile.mkdirs(); writeText("{}") }
        File(source, "userconfig/userconfig.json").apply { parentFile.mkdirs(); writeText("{\"displayStates\":{}}") }
        val files = JSONArray()
        for (name in listOf("config/config.json", "userconfig/userconfig.json")) {
            val file = File(source, name)
            files.put(JSONObject().put("path", name).put("size", file.length()).put("sha256", ModelHash.sha256(file)))
        }
        val metadata = JSONObject().put("format", "aasc-offline-data-baseline").put("schemaVersion", 1)
            .put("dataVersion", 2).put("latestRepairVersion", 2).put("files", files)
            .put("includedRepairs", JSONArray().put(JSONObject().put("repairId", "repair-2").put("repairVersion", 2)
                .put("targetDataVersion", 2).put("scriptSha256", "b".repeat(64))))
        return File(source, "config/data-repair-state.json").apply { writeText(metadata.toString()) }
    }

    @Test fun 全新种子恢复版本且中断后补齐用户配置才提交() {
        val parent = Files.createTempDirectory("repair-seed").toFile()
        try {
            val source = File(parent, "seeds"); val root = File(parent, "server"); val metadata = baseline(source)
            OfflineDataRepairState.beginSeed(root, metadata) { File(source, it) }
            File(root, "config").mkdirs(); File(source, "config/config.json").copyTo(File(root, "config/config.json"))
            assertThrows(Exception::class.java) { OfflineDataRepairState.finishSeed(root) }
            assertFalse(File(root, "data-repair/state.json").exists())
            OfflineDataRepairState.beginSeed(root, metadata) { File(source, it) }
            File(root, "home/.config/aasc-user").mkdirs()
            File(source, "userconfig/userconfig.json").copyTo(File(root, "home/.config/aasc-user/userconfig.json"))
            OfflineDataRepairState.finishSeed(root)
            assertEquals(2, OfflineDataRepairState.state(root).getInt("dataVersion"))
            assertTrue(OfflineDataRepairState.satisfied(root, repair()))
            assertEquals(0, OfflineDataRepairState.state(root).getJSONArray("appliedRepairs").length())
        } finally { parent.deleteRecursively() }
    }

    @Test fun 已有配置不从新种子抬版本或覆盖用户值() {
        val parent = Files.createTempDirectory("repair-existing").toFile()
        try {
            val source = File(parent, "seeds"); val root = File(parent, "server"); val metadata = baseline(source)
            File(root, "config/config.json").apply { parentFile.mkdirs(); writeText("{\"user\":true}") }
            OfflineDataRepairState.beginSeed(root, metadata) { File(source, it) }
            OfflineDataRepairState.finishSeed(root)
            assertFalse(File(root, "data-repair/state.json").exists())
            assertEquals("{\"user\":true}", File(root, "config/config.json").readText())
        } finally { parent.deleteRecursively() }
    }

    @Test fun 服务就绪但数据拒绝不能反馈成功并支持失败去重与手动重试() {
        val root = Files.createTempDirectory("repair-failure").toFile()
        try {
            val expected = JSONObject().put("repairId", "repair-2").put("repairVersion", 2)
                .put("scriptSha256", "b".repeat(64)).put("requiredDataVersion", 1).put("targetDataVersion", 2)
            File(root, "data-repair").mkdirs()
            File(root, "data-repair/last-result.json").writeText(JSONObject(expected.toString())
                .put("actualDataVersion", 0).put("status", "rejected-data-version").toString())
            val result = OfflineDataRepairState.completion(root, expected)
            assertFalse(result.first); assertTrue(result.second.contains("rejected-data-version"))
            assertTrue(OfflineDataRepairState.failure(root, repair())!!.contains("当前数据版本 0"))
            assertTrue(OfflineDataRepairState.shouldNotifyFailure(root, expected))
            assertFalse(OfflineDataRepairState.shouldNotifyFailure(root, expected))
            File(root, "data-repair/notified-failure.json").delete()
            assertTrue(OfflineDataRepairState.shouldNotifyFailure(root, expected))
        } finally { root.deleteRecursively() }
    }

    @Test fun 结果或记录身份不匹配不能冒充已修复且新版本明确覆盖旧迁移() {
        val root = Files.createTempDirectory("repair-record").toFile()
        try {
            File(root, "data-repair").mkdirs()
            File(root, "data-repair/state.json").writeText("""{"dataVersion":2,"latestRepairVersion":2,"appliedRepairs":[{"repairId":"repair-2","repairVersion":2,"scriptSha256":"${"c".repeat(64)}"}]}""")
            assertFalse(OfflineDataRepairState.satisfied(root, repair()))
            File(root, "data-repair/state.json").writeText("""{"dataVersion":3,"latestRepairVersion":3,"appliedRepairs":[]}""")
            assertFalse(OfflineDataRepairState.satisfied(root, repair()))
            File(root, "data-repair/state.json").writeText("""{"dataVersion":3,"latestRepairVersion":3,"appliedRepairs":[{"repairId":"repair-3","repairVersion":3,"targetDataVersion":3,"scriptSha256":"${"c".repeat(64)}"}]}""")
            assertTrue(OfflineDataRepairState.satisfied(root, repair()))
        } finally { root.deleteRecursively() }
    }
}
