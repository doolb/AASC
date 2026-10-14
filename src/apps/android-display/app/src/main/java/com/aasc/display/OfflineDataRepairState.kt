package com.aasc.display

import java.io.File
import java.nio.file.Files
import org.json.JSONArray
import org.json.JSONObject

/** 纯文件状态适配：服务健康、种子包含与设备执行结果分别判断。 */
internal object OfflineDataRepairState {
    private const val MAX_BYTES = 64 * 1024
    private fun reason(status: String, requiredCode: Int, requiredApk: Int?): String = when (status) {
        "rejected-data-version" -> "数据版本不兼容（rejected-data-version）"
        "waiting-code-version" -> "需先更新服务代码到 v$requiredCode"
        "waiting-apk-version" -> "需先安装 APK v${requiredApk ?: "?"} 或更高版本"
        "rolled-back" -> "修复脚本失败，配置已回滚"
        else -> status.take(128)
    }
    private fun read(file: File): JSONObject? {
        require(!Files.isSymbolicLink(file.toPath())) { "数据修复状态不能是链接" }
        if (!file.exists()) return null
        require(file.isFile && file.length() <= MAX_BYTES) { "数据修复状态类型或大小无效" }
        return JSONObject(file.readText())
    }
    fun state(root: File): JSONObject {
        val current = read(File(root, "data-repair/state.json")) ?: return JSONObject().put("dataVersion", 0)
        for (key in listOf("dataVersion", "latestRepairVersion")) {
            if (!current.has(key)) continue
            val value = current.get(key)
            require(value is Number && value.toDouble() == value.toInt().toDouble() && value.toInt() >= 0) { "数据修复状态版本无效" }
        }
        for (key in listOf("appliedRepairs", "includedRepairs")) {
            if (current.has(key)) require(current.optJSONArray(key) != null) { "数据修复记录格式无效" }
        }
        return current
    }
    private fun newerCovers(current: JSONObject, version: Int, target: Int): Boolean {
        if (current.optInt("latestRepairVersion") <= version || current.optInt("dataVersion") < target) return false
        return listOf("appliedRepairs", "includedRepairs").any { key ->
            val records = current.optJSONArray(key) ?: JSONArray()
            (0 until records.length()).any { index ->
                val item = records.optJSONObject(index) ?: return@any false
                item.optInt("repairVersion") == current.optInt("latestRepairVersion")
                    && item.optInt("targetDataVersion", -1) in target..current.optInt("dataVersion")
                    && Regex("^[a-f0-9]{64}$").matches(item.optString("scriptSha256"))
            }
        }
    }
    fun satisfied(root: File, repair: OfflineDataRepairArtifact): Boolean = runCatching {
        val current = state(root)
        (current.optInt("dataVersion", 0) >= repair.targetDataVersion && listOf("appliedRepairs", "includedRepairs").any { key ->
            val records = current.optJSONArray(key) ?: JSONArray()
            (0 until records.length()).any { index ->
                val record = records.optJSONObject(index) ?: return@any false
                record.optString("repairId") == repair.repairId
                    && (!record.has("repairVersion") || record.optInt("repairVersion") == repair.repairVersion)
                    && (!record.has("scriptSha256") || record.optString("scriptSha256") == repair.scriptSha256)
                    && (!record.has("targetDataVersion") || record.optInt("targetDataVersion") >= repair.targetDataVersion)
            }
        }) || newerCovers(current, repair.repairVersion, repair.targetDataVersion)
    }.getOrDefault(false)

    fun failure(root: File, repair: OfflineDataRepairArtifact): String? = runCatching {
        if (satisfied(root, repair)) return null
        val result = read(File(root, "data-repair/last-result.json")) ?: return null
        if (result.optString("repairId") != repair.repairId || result.optInt("repairVersion") != repair.repairVersion
            || result.optString("scriptSha256") != repair.scriptSha256) return null
        val actual = state(root).optInt("dataVersion", 0)
        if (result.optInt("actualDataVersion", -1) != actual) return null
        "数据修复 ${repair.repairId} 未完成：${reason(result.optString("status"), repair.requiredCodeVersion, repair.requiredApkVersionCode)}；当前数据版本 $actual，兼容版本 ${repair.compatibleDataVersions.joinToString()}，目标 ${repair.targetDataVersion}"
    }.getOrDefault(null)

    fun pending(root: File): JSONObject? = runCatching { read(File(root, "data-repair/pending-repair.json")) }.getOrNull()

    /** 启动前保留预期身份；pending 可能已被执行器删除，通知仍必须验证该身份的结果。 */
    fun completion(root: File, expected: JSONObject): Pair<Boolean, String> = runCatching {
        val id = expected.getString("repairId")
        val version = expected.getInt("repairVersion")
        val hash = expected.getString("scriptSha256")
        val current = state(root)
        val records = listOf("appliedRepairs", "includedRepairs").flatMap { key ->
            val items = current.optJSONArray(key) ?: JSONArray()
            (0 until items.length()).mapNotNull { items.optJSONObject(it) }
        }
        val match = current.optInt("dataVersion", 0) >= expected.getInt("targetDataVersion") && records.any { it.optString("repairId") == id
            && (!it.has("repairVersion") || it.optInt("repairVersion") == version)
            && (!it.has("scriptSha256") || it.optString("scriptSha256") == hash)
            && (!it.has("targetDataVersion") || it.optInt("targetDataVersion") >= expected.getInt("targetDataVersion")) }
        if (match || newerCovers(current, version, expected.getInt("targetDataVersion"))) {
            return true to "数据修复 $id 已满足，数据版本 ${current.optInt("dataVersion")}"
        }
        val result = read(File(root, "data-repair/last-result.json"))
        val status = if (result?.optString("repairId") == id && result.optInt("repairVersion") == version
            && result.optString("scriptSha256") == hash) result.optString("status") else "未取得匹配的成功结果"
        false to "数据修复 $id 未完成：${reason(status, expected.optInt("requiredCodeVersion"), expected.optInt("requiredApkVersionCode").takeIf { it > 0 })}；当前数据版本 ${current.optInt("dataVersion", 0)}，要求 ${expected.getInt("requiredDataVersion")}，目标 ${expected.getInt("targetDataVersion")}"
    }.getOrElse { false to "数据修复结果校验失败：${it.message}" }

    fun shouldNotifyFailure(root: File, expected: JSONObject): Boolean = runCatching {
        val result = read(File(root, "data-repair/last-result.json"))
        val key = JSONObject().put("repairId", expected.optString("repairId"))
            .put("repairVersion", expected.optInt("repairVersion"))
            .put("scriptSha256", expected.optString("scriptSha256"))
            .put("dataVersion", state(root).optInt("dataVersion", 0)).put("status", result?.optString("status"))
        val marker = File(root, "data-repair/notified-failure.json")
        if (runCatching { read(marker).toString() == key.toString() }.getOrDefault(false)) return false
        OfflineBootstrapManager.writeJson(marker, key)
        true
    }.getOrDefault(true)

    fun verifyFiles(baseline: JSONObject, fileFor: (String) -> File) {
        require(baseline.optString("format") == "aasc-offline-data-baseline" && baseline.optInt("schemaVersion") == 1
            && baseline.getInt("dataVersion") >= 0 && baseline.getInt("latestRepairVersion") >= 0)
        val included = baseline.getJSONArray("includedRepairs")
        require(included.length() <= 256)
        val ids = mutableSetOf<String>()
        for (index in 0 until included.length()) {
            val record = included.getJSONObject(index)
            require(Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$").matches(record.getString("repairId"))
                && ids.add(record.getString("repairId")) && record.getInt("repairVersion") in 1..baseline.getInt("latestRepairVersion")
                && record.getInt("targetDataVersion") in 0..baseline.getInt("dataVersion")
                && Regex("^[a-f0-9]{64}$").matches(record.getString("scriptSha256")))
        }
        val files = baseline.getJSONArray("files")
        require(files.length() in 1..256)
        val names = mutableSetOf<String>()
        for (index in 0 until files.length()) {
            val entry = files.getJSONObject(index); val name = entry.getString("path")
            require(name.substringBefore('/') in setOf("config", "userconfig") && name.split('/').size >= 2
                && name.split('/').all { Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$").matches(it) }
                && names.add(name) && name != "config/data-repair-state.json")
            val file = fileFor(name)
            require(!Files.isSymbolicLink(file.toPath()) && file.isFile && file.length() == entry.getLong("size")
                && ModelHash.matches(file, entry.getString("sha256"))) { "数据基线与种子文件不一致: $name" }
        }
        require("config/config.json" in names)
    }

    /** 在复制新配置前保存资格；进程中断重试也必须完成同一份种子后才能初始化版本。 */
    fun beginSeed(root: File, metadata: File, sourceFor: (String) -> File) {
        val marker = File(root, "data-repair/seed-initializing.json")
        val baseline = read(metadata) ?: return
        if (marker.isFile) {
            require(read(marker).toString() == baseline.toString()) { "未完成的数据初始化种子已变化" }
            return
        }
        if (File(root, "config/config.json").exists() || File(root, "home/.config/aasc-user/userconfig.json").exists()
            || File(root, "data-repair/state.json").exists()) return
        verifyFiles(baseline, sourceFor)
        OfflineBootstrapManager.writeJson(marker, baseline)
    }

    fun finishSeed(root: File) {
        val marker = File(root, "data-repair/seed-initializing.json")
        val baseline = read(marker) ?: return
        val stateFile = File(root, "data-repair/state.json")
        if (!stateFile.exists()) {
            verifyFiles(baseline) { name ->
                File(root, if (name.startsWith("userconfig/")) "home/.config/aasc-user/${name.removePrefix("userconfig/")}" else name)
            }
            OfflineBootstrapManager.writeJson(stateFile, JSONObject().put("dataVersion", baseline.getInt("dataVersion"))
                .put("latestRepairVersion", baseline.getInt("latestRepairVersion"))
                .put("includedRepairs", baseline.getJSONArray("includedRepairs")).put("appliedRepairs", JSONArray()))
        }
        require(marker.delete()) { "无法结束数据种子初始化" }
    }
}
