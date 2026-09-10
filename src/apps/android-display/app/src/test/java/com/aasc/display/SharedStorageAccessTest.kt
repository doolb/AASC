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
