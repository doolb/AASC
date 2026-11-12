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
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** 控制 WebView 的原生桥：负责隔离登录与运行页面入口，不读取或记录凭据。 */
class Chat2ApiNativeBridge(
    private val activity: Activity,
    private val onFullConfigBackupSave: ((String) -> Boolean)? = null,
    private val runtimeServerUrl: (() -> String?)? = null
) {

    companion object {
        const val LOGIN_REQUEST_CODE = 1006
        const val ACCOUNT_WEB_REQUEST_CODE = 1007
        private const val MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024

        /** 运行页属于本机Offline服务，远端控制页面不能误打开手机上的另一套运行时。 */
        @JvmStatic
        fun isLocalRuntimeUrl(rawUrl: String?): Boolean = try {
            val uri = URI(rawUrl ?: "")
            uri.scheme in setOf("http", "https") && uri.rawUserInfo == null &&
                (uri.port == -1 || uri.port in 1..65535) &&
                uri.host in setOf("localhost", "127.0.0.1", "[::1]", "::1")
        } catch (_: Exception) { false }

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

    @JavascriptInterface
    fun openDoubaoRuntimePage(): Boolean {
        if (runtimeServerUrl == null || activity.isFinishing || activity.isDestroyed) return false
        return launchOnUiThread {
            // 必须在主线程读取当前控制页URL，切换服务器后不能沿用首次连接时的旧来源。
            check(isLocalRuntimeUrl(runtimeServerUrl.invoke()))
            activity.startActivity(Intent(activity, DoubaoWebViewActivity::class.java))
        }
    }

    /** 只允许本机 Offline 控制页面查看网页媒体的后台 WebView。 */
    @JavascriptInterface
    fun openBrowserMediaRuntimePage(): Boolean {
        if (runtimeServerUrl == null || activity.isFinishing || activity.isDestroyed) return false
        return launchOnUiThread {
            check(isLocalRuntimeUrl(runtimeServerUrl.invoke()))
            activity.startActivity(Intent(activity, BrowserMediaWebViewActivity::class.java))
        }
    }

    private fun openLoginActivity(sessionJson: String, requestCode: Int): Boolean {
        if (sessionJson.isBlank() || activity.isFinishing || activity.isDestroyed) return false
        return launchOnUiThread {
            activity.startActivityForResult(
                Intent(activity, Chat2ApiLoginActivity::class.java)
                    .putExtra(Chat2ApiLoginActivity.EXTRA_SESSION_JSON, sessionJson),
                requestCode
            )
        }
    }

    private fun launchOnUiThread(launch: () -> Unit): Boolean {
        val opened = AtomicBoolean(false)
        val completed = CountDownLatch(1)
        val open = open@{
            try {
                if (activity.isFinishing || activity.isDestroyed) return@open
                launch()
                opened.set(true)
            } catch (_: Exception) {
                // 切换失败只回传false；不记录登录参数或异常附带的凭据。
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

    /** 全量 ZIP 只传请求标识，文件由受限服务来源流式下载，避免大包经过 Base64 桥。 */
    @JavascriptInterface
    fun saveFullConfigBackup(requestId: String): Boolean {
        if (!FullConfigBackupSavePolicy.validRequestId(requestId)
            || activity.isFinishing || activity.isDestroyed) return false
        val callback = onFullConfigBackupSave ?: return false
        val accepted = AtomicBoolean(false)
        val completed = CountDownLatch(1)
        val launch = {
            try { accepted.set(callback(requestId)) }
            catch (_: Exception) { /* 页面根据返回值报告失败，不记录备份内容。 */ }
            finally { completed.countDown() }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) launch()
        else {
            activity.runOnUiThread(launch)
            completed.await(2, TimeUnit.SECONDS)
        }
        return accepted.get()
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
