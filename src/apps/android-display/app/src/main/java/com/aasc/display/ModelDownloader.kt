package com.aasc.display

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import java.security.SecureRandom
import java.security.cert.X509Certificate

// 模型文件下载（共享）：SSL-trust 自签名证书 + .tmp 原子改名 + 失败日志
// 与 MainActivity.onReceivedSslError 的 WebView 放行保持同一安全姿态（服务器自签名证书）
object ModelDownloader {

    // 下载到 .tmp 后原子改名（整文件重下，不做断点续传）；失败返回 false 并记录原因
    fun download(urlStr: String, dest: File, onProgress: (Int) -> Unit): Boolean =
        download(urlStr, dest, null, onProgress)

    // 下载完成后才校验 hash，校验通过才把 .tmp 原子改名为正式文件。
    fun download(
        urlStr: String,
        dest: File,
        expectedSha256: String?,
        onProgress: (Int) -> Unit
    ): Boolean {
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
            if (expectedSha256 != null && !ModelHash.matches(tmp, expectedSha256)) {
                tmp.delete()
                android.util.Log.e("ModelDownloader", "模型 hash 校验失败: ${urlStr}")
                return false
            }
            if (!tmp.renameTo(dest)) {
                tmp.copyTo(dest, overwrite = true)
                tmp.delete()
            }
            true
        } catch (e: Exception) {
            android.util.Log.e("ModelDownloader", "模型下载失败: ${urlStr} ${e.message}")
            false
        } finally {
            conn?.disconnect()
        }
    }

    // 读取服务器端很小的 hash 文件；网络失败返回 null，由模型管理器决定是否沿用本地已验证模型。
    fun readText(urlStr: String): String? {
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
            conn.apply { connectTimeout = 10000; readTimeout = 10000 }
            if (conn.responseCode !in 200..299) return null
            conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Exception) {
            android.util.Log.w("ModelDownloader", "读取模型 hash 失败: ${urlStr} ${e.message}")
            null
        } finally {
            conn?.disconnect()
        }
    }
}
