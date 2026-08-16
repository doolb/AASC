package com.aasc.display

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

// 原生 ASR 模型管理：下载/校验/加载/状态机
// 状态：not_ready → downloading → ready | error（error 或损坏后再次 ensureModel 会重新下载）
class AsrModelManager(
    private val context: Context,
    private val uiHandler: Handler = Handler(Looper.getMainLooper())
) {
    private val modelDir = File(context.filesDir, "models/sensevoice")
    private val modelFile = File(modelDir, "model.int8.onnx")
    private val tokensFile = File(modelDir, "tokens.txt")
    private val downloadPool: ExecutorService = Executors.newSingleThreadExecutor()
    private val lock = Any()

    @Volatile var state: String = "not_ready"
        private set
    @Volatile var progress: Int = 0
        private set
    @Volatile var lastError: String = ""
        private set

    val isReady: Boolean get() = state == "ready"

    fun statusJson(): JSONObject = JSONObject()
        .put("state", state)
        .put("progress", progress)
        .put("error", lastError)

    // 幂等触发：ready 返回 "ready"；downloading 返回 "downloading"；否则启动下载返回 "downloading"
    fun ensureModel(baseUrl: String, onModelEvent: (JSONObject) -> Unit): String {
        synchronized(lock) {
            if (state == "ready") return "ready"
            if (state == "downloading") return "downloading"
            state = "downloading"
            progress = 0
            lastError = ""
        }
        downloadPool.execute {
            try {
                modelDir.mkdirs()
                val modelUrl = "$baseUrl/api/asr/model/model.int8.onnx"
                val tokensUrl = "$baseUrl/api/asr/model/tokens.txt"
                // 磁盘已有完整模型则跳过下载（下载一次即可，重启不重复拉取 234MB）
                val validOnDisk = !AsrModelFiles.needsDownload(modelFile, tokensFile)
                // 需要下载时：先下载 tokens（小文件），再下载模型（大文件，进度上屏）
                val okTokens = validOnDisk || downloadFile(tokensUrl, tokensFile) { /* tokens 很小，不细分进度 */ }
                // okTokens 短路：tokens 下载失败时不再拉取 234MB 大模型（避免无谓流量浪费）
                val okModel = okTokens && (validOnDisk || downloadFile(modelUrl, modelFile) { p ->
                    progress = p
                    postModelEvent(JSONObject().put("state", "downloading").put("progress", p), onModelEvent)
                })
                // 内存不足时不硬加载防 OOM（234MB 模型在低端机可能 OOM，设计文档风险项）
                val memOk = hasEnoughMemory()
                val loadOk = okModel && memOk && AsrEngine.load(context, modelFile, tokensFile)
                if (loadOk) {
                    state = "ready"
                    postModelEvent(JSONObject().put("state", "ready"), onModelEvent)
                } else {
                    state = "error"
                    lastError = when {
                        !okModel -> "模型下载失败"
                        !memOk -> "设备内存不足，无法加载语音模型"
                        else -> "模型加载自检失败"
                    }
                    when {
                        // 下载失败：模型/tokens 缺失或损坏，全部清掉（含 .tmp 残件）
                        !okModel -> AsrModelFiles.purge(modelFile, tokensFile)
                        // 内存不足：保留已下载文件（内存释放后可重试加载），仅清理 .tmp 残件
                        !memOk -> {
                            File(modelFile.parentFile, modelFile.name + ".tmp").delete()
                            File(tokensFile.parentFile, tokensFile.name + ".tmp").delete()
                        }
                        // 加载自检失败：清掉损坏文件（含 .tmp 残件）
                        else -> AsrModelFiles.purge(modelFile, tokensFile)
                    }
                    postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
                }
            } catch (e: Exception) {
                state = "error"
                lastError = e.message ?: "模型下载异常"
                postModelEvent(JSONObject().put("state", "error").put("error", lastError), onModelEvent)
            }
        }
        return "downloading"
    }

    private fun postModelEvent(json: JSONObject, onModelEvent: (JSONObject) -> Unit) {
        uiHandler.post { onModelEvent(json) }
    }

    // 低端机防 OOM：可用内存需 > 400MB（SenseVoice int8 模型约 234MB + 引擎原生开销）
    private fun hasEnoughMemory(): Boolean {
        return try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            val mi = android.app.ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            mi.availMem > 400L * 1024 * 1024
        } catch (_: Exception) {
            true  // 查询失败时放行，由 load 自检兜底
        }
    }

    // 下载到 .tmp 后原子改名（整文件重下，不做断点续传）；失败返回 false
    // HTTPS 自签名证书信任：服务器默认 8081 端口部署自签名证书，HttpURLConnection 走系统信任库
    // 会握手失败（SSLHandshakeException），这里显式 trust-all 与 MainActivity.onReceivedSslError
    // 的 WebView 放行保持同一安全姿态（WebView 已信任该证书，原生下载也应一致）。
    private fun downloadFile(urlStr: String, dest: File, onProgress: (Int) -> Unit): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            val raw = URL(urlStr).openConnection()
            conn = if (urlStr.startsWith("https://")) {
                val https = raw as HttpsURLConnection
                val tm = arrayOf<TrustManager>(object : X509TrustManager {
                    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
                })
                val sc = SSLContext.getInstance("TLS")
                sc.init(null, tm, SecureRandom())
                https.sslSocketFactory = sc.socketFactory
                https.hostnameVerifier = HostnameVerifier { _: String?, _: SSLSession? -> true }
                https
            } else raw as HttpURLConnection
            conn.apply { connectTimeout = 10000; readTimeout = 60000 }
            val total = conn.contentLengthLong
            val tmp = File(dest.parentFile, dest.name + ".tmp")
            conn.inputStream.use { input ->
                FileOutputStream(tmp).use { output ->
                    val buf = ByteArray(64 * 1024)
                    var downloaded = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        downloaded += n
                        if (total > 0) onProgress((downloaded * 100 / total).toInt())
                    }
                }
            }
            if (conn.responseCode !in 200..299) return false
            if (!tmp.renameTo(dest)) {
                tmp.copyTo(dest, overwrite = true)
                tmp.delete()
            }
            true
        } catch (e: Exception) {
            // 记录失败原因（自签名证书/网络/服务器 404 等），便于设备端定位
            android.util.Log.e("AsrModelManager", "模型下载失败: ${urlStr} ${e.message}")
            false
        } finally {
            conn?.disconnect()
        }
    }
}
