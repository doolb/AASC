package com.aasc.display

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** 控制 WebView 的原生桥：只负责启动/关闭隔离登录 Activity，不读取或记录凭据。 */
class Chat2ApiNativeBridge(private val activity: Activity) {

    companion object {
        const val LOGIN_REQUEST_CODE = 1006
        const val ACCOUNT_WEB_REQUEST_CODE = 1007
        private const val MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024

        /** 只允许单层文件名，避免 WebView 传入路径穿越或控制字符。 */
        @JvmStatic
        fun normalizeDownloadFileName(rawName: String): String? {
            val name = rawName.trim()
            if (name.isEmpty() || name.length > 128 || name == "." || name == "..") return null
            if (name.any { it == '/' || it == '\\' || it.code < 0x20 || it.code == 0x7f }) return null
            return name
        }
    }

    @JavascriptInterface
    fun openChat2ApiLogin(sessionJson: String): Boolean {
        return openLoginActivity(sessionJson, LOGIN_REQUEST_CODE)
    }

    /**
     * 打开指定账号的隔离外部网页。sessionJson 只包含一次性 sessionId/consumeUrl，原生桥不读取或记录凭证。
     */
    @JavascriptInterface
    fun openChat2ApiAccountWeb(sessionJson: String): Boolean {
        return openLoginActivity(sessionJson, ACCOUNT_WEB_REQUEST_CODE)
    }

    private fun openLoginActivity(sessionJson: String, requestCode: Int): Boolean {
        if (sessionJson.isBlank() || activity.isFinishing || activity.isDestroyed) return false
        val opened = AtomicBoolean(false)
        val completed = CountDownLatch(1)
        val open = {
            try {
                activity.startActivityForResult(
                        Intent(activity, Chat2ApiLoginActivity::class.java)
                        .putExtra(Chat2ApiLoginActivity.EXTRA_SESSION_JSON, sessionJson),
                    requestCode
                )
                opened.set(true)
            } catch (_: Exception) {
                // JavaScript 侧会在返回 false 时回退手工登录；这里不输出 sessionJson，避免凭据配置误入日志。
            } finally {
                completed.countDown()
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            open()
        } else {
            activity.runOnUiThread(open)
            completed.await(2, TimeUnit.SECONDS)
        }
        return opened.get()
    }

    @JavascriptInterface
    fun closeChat2ApiLogin() {
        // 登录成功后 Activity 已经通过 RESULT_OK 关闭，此方法保留作版本兼容的无操作确认接口。
    }

    /** 将控制端导出的 JSON 保存到系统 Download 目录，不记录或回显文件内容。 */
    @JavascriptInterface
    fun saveDownloadFile(fileName: String, mimeType: String, base64Content: String): String {
        return try {
            val safeName = normalizeDownloadFileName(fileName)
                ?: return JSONObject().put("ok", false).put("error", "文件名无效").toString()
            val bytes = Base64.decode(base64Content, Base64.DEFAULT)
            if (bytes.size > MAX_DOWNLOAD_BYTES) {
                return JSONObject().put("ok", false).put("error", "导出文件过大").toString()
            }
            val safeMimeType = mimeType.trim().takeIf { it.isNotEmpty() } ?: "application/json"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveWithMediaStore(safeName, safeMimeType, bytes)
            } else {
                saveWithLegacyStorage(safeName, bytes)
            }
            JSONObject().put("ok", true).put("fileName", safeName).put("directory", "Download").toString()
        } catch (error: Exception) {
            JSONObject().put("ok", false).put("error", error.message ?: "保存文件失败").toString()
        }
    }

    private fun saveWithMediaStore(fileName: String, mimeType: String, bytes: ByteArray) {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = activity.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("无法创建 Download 文件")
        try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: throw IllegalStateException("无法打开 Download 文件")
            resolver.update(uri, ContentValues().apply {
                put(MediaStore.Downloads.IS_PENDING, 0)
            }, null, null)
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
    }

    @Suppress("DEPRECATION")
    private fun saveWithLegacyStorage(fileName: String, bytes: ByteArray) {
        val directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw IllegalStateException("无法创建 Download 目录")
        }
        File(directory, fileName).also { file ->
            FileOutputStream(file).use { it.write(bytes) }
        }
    }
}
