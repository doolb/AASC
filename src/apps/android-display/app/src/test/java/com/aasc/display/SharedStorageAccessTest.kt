package com.aasc.display

import android.Manifest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SharedStorageAccessTest {

    @Test
    fun Android9需要读写共享存储权限() {
        assertArrayEquals(
            arrayOf(
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ),
            SharedStorageAccess.requiredPermissions(28)
        )
    }

    @Test
    fun Android10及以上不申请整个共享存储权限() {
        assertTrue(SharedStorageAccess.requiredPermissions(29).isEmpty())
        assertTrue(SharedStorageAccess.requiredPermissions(34).isEmpty())
        assertFalse(SharedStorageAccess.requiresTreeAccess(28))
        assertTrue(SharedStorageAccess.requiresTreeAccess(29))
        assertTrue(SharedStorageAccess.requiresTreeAccess(34))
    }

    @Test
    fun SAF选择器使用可持久化读写授权() {
        val flags = SharedStorageAccess.treeAccessIntentFlags()

        assertTrue(flags and android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(flags and android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0)
        assertTrue(flags and android.content.Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0)
    }

    @Test
    fun 共享存储必须同时拥有读写权限() {
        val granted = setOf(Manifest.permission.READ_EXTERNAL_STORAGE)

        assertFalse(SharedStorageAccess.arePermissionsGranted(28) { granted.contains(it) })
        assertTrue(
            SharedStorageAccess.arePermissionsGranted(28) {
                it == Manifest.permission.READ_EXTERNAL_STORAGE ||
                    it == Manifest.permission.WRITE_EXTERNAL_STORAGE
            }
        )
    }
}
