package com.aasc.display

import android.Manifest
import android.os.Build

/**
 * 统一维护 APK 访问共享存储的 Android 版本边界。
 *
 * 当前 APK 的目标设备是 Android 9/API 28。Android 10 开始分区存储规则发生变化，
 * 因此本类不会把旧版 READ/WRITE_EXTERNAL_STORAGE 权限误认为可以访问整个共享存储。
 */
object SharedStorageAccess {

    private const val LEGACY_STORAGE_MAX_SDK = 28

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
