package com.aasc.display

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import java.io.File

/** 接收 PackageInstaller 的异步结果，并把最终确认页交还给 Android 系统。 */
class OfflineApkInstallReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != OfflineUpdateManager.MIN_APK_INSTALL_ACTION) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
        sendInstallStatus(context, status, detail)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> launchSystemConfirmation(context, intent)
            PackageInstaller.STATUS_SUCCESS -> {
                deleteInstalledUpdateCache(context, intent.getStringExtra(EXTRA_APK_PATH))
                Log.i(TAG, "Offline min APK 已由 PackageInstaller 安装")
            }
            else -> Log.e(
                TAG,
                "Offline min APK 安装失败: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()}"
            )
        }
    }

    private fun sendInstallStatus(context: Context, status: Int, detail: String) {
        context.sendBroadcast(
            Intent(ACTION_INSTALL_STATUS)
                .setPackage(context.packageName)
                .putExtra(EXTRA_INSTALL_STATUS, status)
                .putExtra(EXTRA_INSTALL_DETAIL, detail)
        )
    }

    private fun launchSystemConfirmation(context: Context, callback: Intent) {
        val confirmation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            callback.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            callback.getParcelableExtra(Intent.EXTRA_INTENT)
        }
        if (confirmation == null) {
            Log.e(TAG, "PackageInstaller 未提供系统确认 Intent")
            return
        }
        confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(confirmation)
    }

    private fun deleteInstalledUpdateCache(context: Context, path: String?) {
        if (path.isNullOrBlank()) return
        runCatching {
            val root = File(context.filesDir, "aasc-server/updates/apk").canonicalFile
            val apk = File(path).canonicalFile
            if (apk.toPath().startsWith(root.toPath()) && apk.isFile) {
                check(apk.delete()) { "无法删除已安装的 min APK 缓存" }
            }
        }.onFailure { error ->
            Log.w(TAG, "清理已安装的 min APK 缓存失败: ${error.message}")
        }
    }

    companion object {
        const val EXTRA_APK_PATH = "offline_min_apk_path"
        const val ACTION_INSTALL_STATUS = "com.aasc.display.action.OFFLINE_MIN_APK_INSTALL_STATUS"
        const val EXTRA_INSTALL_STATUS = "offline_min_apk_install_status"
        const val EXTRA_INSTALL_DETAIL = "offline_min_apk_install_detail"
        private const val TAG = "AASC-Offline-Install"
    }
}
