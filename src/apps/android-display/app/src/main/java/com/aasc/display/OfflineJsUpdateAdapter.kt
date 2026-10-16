package com.aasc.display

import org.json.JSONObject
import java.io.File

/** 保留既有界面数据类型；APK适配器不重新进行下载、版本规划或服务指针切换。 */
internal object OfflineJsUpdateAdapter {
    private fun optionalInt(value: JSONObject, key: String): Int? =
        if (value.has(key) && !value.isNull(key)) value.getInt(key) else null

    fun serviceCheck(manualRetry: Boolean): ServiceUpdateResult = try {
        val result = OfflineLauncherClient.objectCall("service.check", JSONObject().put("manualRetry", manualRetry))
        val current = result.optJSONObject("installed")
        ServiceUpdateResult(result.getString("status"), result.optBoolean("hasUpdate"),
            OfflineUpdateManager.ServiceUpdatePlan.valueOf(result.optString("plan", "CURRENT")),
            current?.let { InstalledServiceVersion(it.getInt("codeVersion"), it.getInt("dependencyVersion"), it.getString("lockSha256"),
                optionalInt(it, "taskCodeVersion"), it.optString("taskCodeSha256").takeIf(String::isNotBlank)) },
            optionalInt(result, "targetCodeVersion"), optionalInt(result, "targetDependencyVersion"), result.optLong("downloadBytes"),
            dataRepair = result.optJSONObject("dataRepair")?.let { value ->
                val capabilities = value.getJSONArray("capabilities")
                val compatible = value.optJSONArray("compatibleDataVersions")
                OfflineDataRepairArtifact(value.getInt("repairVersion"), value.getString("repairId"),
                    OfflineUpdateArtifact(value.getInt("repairVersion"), value.getString("relativeUrl"), value.getLong("size"), value.getString("sha256")),
                    value.getInt("requiredCodeVersion"), optionalInt(value, "requiredApkVersionCode"), value.getInt("requiredDataVersion"),
                    value.getInt("targetDataVersion"), value.getString("scriptSha256"),
                    (0 until capabilities.length()).map { capabilities.getString(it) }, value.optBoolean("sensitive"),
                    value.optString("releaseNotes").takeIf(String::isNotBlank),
                    compatible?.let { rows -> (0 until rows.length()).map { rows.getInt(it) } } ?: listOf(value.getInt("requiredDataVersion")))
            }, targetTaskCodeVersion = optionalInt(result, "targetTaskCodeVersion"))
    } catch (error: Exception) { ServiceUpdateResult(error.message ?: "JS更新检查失败", failed = true) }

    fun serviceApply(progress: ((OfflineUpdateProgress) -> Unit)?): ServiceUpdateApplyResult = try {
        val result = OfflineLauncherClient.objectCall("service.apply", timeoutSeconds = 600, progress = listener(progress))
        ServiceUpdateApplyResult(result.getString("status"), result.optBoolean("applied"))
    } catch (error: Exception) { ServiceUpdateApplyResult(error.message ?: "JS更新失败") }

    fun apk(prepare: Boolean, progress: ((OfflineUpdateProgress) -> Unit)? = null): MinApkUpdateResult = try {
        val result = OfflineLauncherClient.objectCall(if (prepare) "apk.prepare" else "apk.check", timeoutSeconds = 600, progress = listener(progress))
        val metadata = result.optJSONObject("metadata")?.let { value ->
            OfflineMinApkArtifact(value.getInt("versionCode"), value.getString("versionName"),
                OfflineUpdateArtifact(value.getInt("versionCode"), value.getString("relativeUrl"), value.getLong("size"), value.getString("sha256")),
                value.getString("packageName"), value.getString("signerSha256"), value.getString("modelCompatibilitySha256"),
                value.optString("releaseNotes").takeIf(String::isNotBlank), value.optJSONObject("runtimeCompatibility"))
        }
        MinApkUpdateResult(result.getString("status"), result.optString("apkFile").takeIf(String::isNotBlank)?.let(::File), metadata)
    } catch (error: Exception) { MinApkUpdateResult(error.message ?: "JS APK准备失败", failed = true) }

    private fun listener(progress: ((OfflineUpdateProgress) -> Unit)?): (JSONObject) -> Unit = { message ->
        if (message.optString("type") == "update.progress") {
            val value = message.getJSONObject("payload")
            progress?.invoke(OfflineUpdateProgress(value.optString("phase"), value.optLong("completedBytes"), value.optLong("totalBytes"), value.optString("detail")))
        }
    }
}
