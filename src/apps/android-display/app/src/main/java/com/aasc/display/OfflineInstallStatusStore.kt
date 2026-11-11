package com.aasc.display

import android.content.Context
import android.content.pm.PackageInstaller

/** 系统安装结果可能在界面退后台时到达，先保存终态，再由前台一次性消费。 */
internal object OfflineInstallStatusStore {
    private const val PREFS = "aasc_offline_install_result"
    private const val STATUS = "status"
    private const val DETAIL = "detail"

    @Synchronized
    fun save(context: Context, status: Int, detail: String) {
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt(STATUS, status).putString(DETAIL, detail).commit()
    }

    @Synchronized
    fun consume(context: Context): Pair<Int, String>? {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!preferences.contains(STATUS)) return null
        val result = preferences.getInt(STATUS, PackageInstaller.STATUS_FAILURE) to preferences.getString(DETAIL, "").orEmpty()
        preferences.edit().clear().commit()
        return result
    }

    @Synchronized
    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
    }
}
