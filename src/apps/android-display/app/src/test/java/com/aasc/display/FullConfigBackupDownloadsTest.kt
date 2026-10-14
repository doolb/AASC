package com.aasc.display

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class FullConfigBackupDownloadsTest {
    @Test fun 重名独占创建与失败清理保留已有文件() {
        val directory = Files.createTempDirectory("aasc-download-test").toFile()
        try {
            val existing = directory.resolve("aasc-full-config-123.zip")
            existing.writeText("用户已有文件")
            val target = FullConfigBackupDownloads.createLegacy(directory, existing.name)
            assertEquals("aasc-full-config-123-1.zip", target.fileName)
            target.open().use { it.write(byteArrayOf(1, 2, 3)) }
            target.discard()
            assertEquals("用户已有文件", existing.readText())
            assertFalse(directory.resolve(target.fileName).exists())
            val successful = FullConfigBackupDownloads.createLegacy(directory, existing.name)
            successful.open().use { it.write("备份".toByteArray()) }
            successful.commit()
            assertEquals("备份", directory.resolve(successful.fileName).readText())
        } finally { directory.deleteRecursively() }
    }

    @Test fun 下载文件名不能越出Download() {
        val directory = Files.createTempDirectory("aasc-download-test").toFile()
        try {
            try {
                FullConfigBackupDownloads.createLegacy(directory, "../outside.zip")
                fail("必须拒绝越界文件名")
            } catch (_: IllegalArgumentException) { }
            assertTrue(directory.listFiles()!!.isEmpty())
        } finally { directory.deleteRecursively() }
    }
}
