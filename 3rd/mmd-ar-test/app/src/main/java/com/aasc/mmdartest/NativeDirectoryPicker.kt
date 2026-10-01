package com.aasc.mmdartest

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.concurrent.Executors

/** WebView目录选择适配：保留PMX与贴图相对路径，只读取用户主动授权的目录树。 */
internal class NativeDirectoryPicker(
    private val activity: Activity,
    private val server: LocalAssetHttpServer,
    private val notifyPage: (JSONObject) -> Unit
) : AutoCloseable {
    companion object {
        const val REQUEST_CODE = 504
        private const val MAX_FILES = 4096
        private const val MAX_DIRECTORIES = 1024
    }
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var closed = false
    @Volatile private var operation: String? = null

    @JavascriptInterface
    fun chooseDirectory(requestId: String) {
        if (!requestId.matches(Regex("[0-9]{1,16}"))) return
        activity.runOnUiThread {
            if (closed) return@runOnUiThread
            if (operation != null) {
                notifyPage(result(requestId, "error", "已有目录选择正在进行"))
                return@runOnUiThread
            }
            operation = requestId
            try {
                @Suppress("DEPRECATION")
                activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }, REQUEST_CODE)
            } catch (error: Exception) {
                operation = null
                notifyPage(result(requestId, "error", error.message ?: "无法打开目录选择器"))
            }
        }
    }

    @JavascriptInterface
    fun releaseDirectory(requestId: String) { server.releasePickedFiles(requestId) }

    fun onResult(resultCode: Int, data: Intent?) {
        val requestId = operation ?: return
        val tree = data?.data
        if (resultCode != Activity.RESULT_OK || tree?.scheme != "content") {
            operation = null
            notifyPage(result(requestId, "cancelled", "已取消目录选择"))
            return
        }
        worker.execute {
            val response = try {
                result(requestId, "selected", "").put("files", enumerate(tree, requestId))
            } catch (error: Exception) {
                server.releasePickedFiles(requestId)
                result(requestId, "error", error.message ?: "目录读取失败")
            }
            activity.runOnUiThread {
                operation = null
                if (!closed) notifyPage(response) else server.releasePickedFiles(requestId)
            }
        }
    }

    private fun result(requestId: String, status: String, message: String) = JSONObject()
        .put("operation", requestId).put("status", status).put("message", message)

    private fun enumerate(tree: Uri, requestId: String): JSONArray {
        val resolver = activity.contentResolver
        val pending = ArrayDeque<Pair<String, String>>()
        pending.add(DocumentsContract.getTreeDocumentId(tree) to "")
        val visited = HashSet<String>()
        val files = JSONArray()
        val columns = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE)
        while (pending.isNotEmpty()) {
            check(!closed) { "目录选择已结束" }
            val (documentId, prefix) = pending.removeFirst()
            if (!visited.add(documentId)) continue
            check(visited.size <= MAX_DIRECTORIES) { "所选目录超过1024个子目录" }
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
            val cursor = resolver.query(children, columns, null, null, null)
                ?: throw IllegalStateException("所选目录无法读取")
            cursor.use {
                while (it.moveToNext()) {
                    val id = it.getString(0)
                    val name = it.getString(1)
                    check(name.isNotBlank() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\')) {
                        "目录中有不支持的文件名"
                    }
                    val mime = it.getString(2) ?: "application/octet-stream"
                    val path = prefix + name
                    if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                        pending.add(id to "$path/")
                    } else {
                        check(files.length() < MAX_FILES) { "所选目录超过4096个文件" }
                        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
                        val size = if (it.isNull(3)) -1L else it.getLong(3)
                        files.put(JSONObject().put("path", path).put("name", name).put("type", mime)
                            .put("size", size).put("url", server.registerPickedFile(requestId, uri, mime, size)))
                    }
                }
            }
        }
        return files
    }

    override fun close() {
        closed = true
        operation?.let { server.releasePickedFiles(it) }
        operation = null
        worker.shutdownNow()
    }
}
