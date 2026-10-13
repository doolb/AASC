package com.aasc.display

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream

/** Download中的每次导出都拥有独立新文件；失败只能删除本次创建的目标。 */
object FullConfigBackupDownloads {
    class Target internal constructor(
        val fileName: String,
        private val file: File? = null,
        private val context: Context? = null,
        private val uri: Uri? = null
    ) {
        fun open(): OutputStream = file?.let { FileOutputStream(it) }
            ?: context!!.contentResolver.openOutputStream(uri!!, "wt")
            ?: error("无法打开 Download 文件")

        fun commit() {
            if (file != null) return
            val values = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
            check(context!!.contentResolver.update(uri!!, values, null, null) == 1) {
                "无法完成 Download 文件保存"
            }
        }

        fun discard() {
            if (file != null) {
                check(!file.exists() || file.delete()) { "无法移除本次未完成 ZIP" }
                return
            }
            context!!.contentResolver.delete(uri!!, null, null)
        }
    }

    fun create(context: Context, fileName: String): Target {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            @Suppress("DEPRECATION")
            val directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            return createLegacy(directory, fileName)
        }
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, "application/zip")
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: error("无法创建 Download 文件")
        return Target(fileName, context = context, uri = uri)
    }

    /** 旧Android使用独占创建，遇到重名只增加序号，不覆盖用户已有下载文件。 */
    fun createLegacy(directory: File, fileName: String): Target {
        require(fileName.matches(Regex("aasc-full-config-[0-9]+\\.zip"))) { "备份文件名无效" }
        check(directory.isDirectory || directory.mkdirs()) { "无法创建 Download 目录" }
        for (suffix in 0..1000) {
            val name = if (suffix == 0) fileName else "${fileName.removeSuffix(".zip")}-$suffix.zip"
            val file = File(directory, name)
            if (file.createNewFile()) return Target(name, file = file)
        }
        error("Download中备份重名过多，请稍后再试")
    }
}
