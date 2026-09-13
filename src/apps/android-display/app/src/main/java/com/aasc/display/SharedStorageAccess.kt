package com.aasc.display

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/**
 * 统一维护 APK 访问共享存储的 Android 版本边界。
 *
 * 当前 APK 的目标设备是 Android 9/API 28。Android 10 开始分区存储规则发生变化，
 * 因此本类不会把旧版 READ/WRITE_EXTERNAL_STORAGE 权限误认为可以访问整个共享存储。
 */
object SharedStorageAccess {

    private const val LEGACY_STORAGE_MAX_SDK = 28
    private const val STORAGE_PREFERENCES = "aasc_display"
    private const val TREE_URI_KEY = "shared_storage_tree_uri"

    /**
     * 返回指定 Android 版本需要动态申请的共享存储权限。
     * Android 10 及以上返回空数组，避免触发本次范围之外的特殊权限流程。
     */
    fun requiredPermissions(sdkInt: Int): Array<String> {
        return if (sdkInt in Build.VERSION_CODES.M..LEGACY_STORAGE_MAX_SDK) {
            arrayOf(
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            )
        } else {
            emptyArray()
        }
    }

    /**
     * Android 10/API 29 及以上改用用户主动选择的 SAF 目录，不再申请整盘存储权限。
     */
    fun requiresTreeAccess(sdkInt: Int): Boolean = sdkInt >= Build.VERSION_CODES.Q

    /**
     * ACTION_OPEN_DOCUMENT_TREE 启动时请求读、写和可持久化授权。
     * 单独暴露 flags 便于不依赖 Android Context 的单元测试验证授权契约。
     */
    fun treeAccessIntentFlags(): Int {
        return Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
    }

    fun createTreePickerIntent(): Intent {
        return Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(treeAccessIntentFlags())
    }

    /**
     * 返回当前 APK 保存的 SAF 根目录 URI。URI 只保存在 APK 私有 SharedPreferences，
     * 不写入 Node 配置文件，也不伪装成 ~/ 或普通文件系统路径。
     */
    fun persistedTreeUri(context: Context): Uri? {
        val rawUri = context
            .getSharedPreferences(STORAGE_PREFERENCES, Context.MODE_PRIVATE)
            .getString(TREE_URI_KEY, null)
            ?.trim()
            .orEmpty()
        return rawUri.takeIf { it.isNotEmpty() }?.let { Uri.parse(it) }
    }

    /**
     * 仅当系统仍保留读写持久授权时才认为 SAF 目录可用；用户撤销授权后会重新弹出选择器。
     */
    fun hasPersistedTreeUri(context: Context): Boolean {
        val uri = persistedTreeUri(context) ?: return false
        return context.contentResolver.persistedUriPermissions.any { permission ->
            permission.uri == uri &&
                permission.isReadPermission &&
                permission.isWritePermission
        }
    }

    /**
     * 保存用户刚选择的目录，并向系统申请可跨进程、跨重启保留的读写授权。
     */
    fun persistTreeUri(context: Context, uri: Uri, grantedFlags: Int): Boolean {
        val persistableFlags = grantedFlags and (
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        if (persistableFlags == 0) return false
        return try {
            context.contentResolver.takePersistableUriPermission(uri, persistableFlags)
            context
                .getSharedPreferences(STORAGE_PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putString(TREE_URI_KEY, uri.toString())
                .apply()
            true
        } catch (error: SecurityException) {
            false
        }
    }

    /**
     * 按调用方提供的系统检查结果判断共享存储是否已完整授权。
     * 读、写权限必须同时满足，避免只读授权被误判为可上传或删除。
     */
    fun arePermissionsGranted(sdkInt: Int, permissionGranted: (String) -> Boolean): Boolean {
        return requiredPermissions(sdkInt).all(permissionGranted)
    }

    /**
     * 只返回尚未授权的权限，减少系统授权框中重复展示已授权项目。
     */
    fun missingPermissions(sdkInt: Int, permissionGranted: (String) -> Boolean): Array<String> {
        return requiredPermissions(sdkInt)
            .filterNot(permissionGranted)
            .toTypedArray()
    }
}
