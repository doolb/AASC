package com.aasc.display

import org.junit.Assert.*
import org.junit.Test

class FullConfigBackupSavePolicyTest {
    @Test fun 只从当前控制页来源构造固定下载路径() {
        assertEquals("http://127.0.0.1:8081/api/config-backup/export",
            FullConfigBackupSavePolicy.downloadUrl("http://127.0.0.1:8081/upload.html?v=1"))
        assertEquals("https://example.com/api/config-backup/export",
            FullConfigBackupSavePolicy.downloadUrl("https://example.com/upload.html"))
        assertEquals("http://[::1]:8081/api/config-backup/export",
            FullConfigBackupSavePolicy.downloadUrl("http://[::1]:8081/upload.html"))
    }
    @Test fun 拒绝其他网页文件地址和带用户名来源() {
        for (value in listOf(null, "", "file:///android_asset/upload.html", "javascript:alert(1)",
            "http://example.com/display.html", "http://user@example.com/upload.html")) {
            assertNull(FullConfigBackupSavePolicy.downloadUrl(value))
        }
    }
    @Test fun 请求标识有界且不能包含脚本符号() {
        assertTrue(FullConfigBackupSavePolicy.validRequestId("backup-123_abc"))
        assertFalse(FullConfigBackupSavePolicy.validRequestId("\";alert(1)"))
        assertFalse(FullConfigBackupSavePolicy.validRequestId("a".repeat(97)))
        assertFalse(FullConfigBackupSavePolicy.validRequestId(""))
    }
    @Test fun ZIP头和大小上限不接受错误响应() {
        assertTrue(FullConfigBackupSavePolicy.isZipHeader(byteArrayOf(0x50, 0x4b, 0x03, 0x04)))
        assertFalse(FullConfigBackupSavePolicy.isZipHeader("{bad".toByteArray()))
        assertFalse(FullConfigBackupSavePolicy.isZipHeader(byteArrayOf(0x50, 0x4b)))
        assertEquals(104857600L, FullConfigBackupSavePolicy.MAX_ZIP_BYTES)
    }
}
