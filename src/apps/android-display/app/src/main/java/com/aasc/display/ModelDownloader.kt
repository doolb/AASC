package com.aasc.display

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import java.security.SecureRandom
import java.security.cert.X509Certificate

// 模型文件下载（共享）：服务器证书校验 + .tmp 原子改名 + 失败日志。
// 当前开发服务器使用固定自签名证书，只有匹配下面指纹时才允许跳过系统 CA 校验；普通 HTTPS 仍走系统信任链。
object ModelDownloader {
    private const val DEVELOPMENT_SERVER_CERT_SHA256 =
        "8b6ba1e4f802f3e74ec49dc33ad61a1424da59f36019a9db58a67eab496b1ba9"
    private val systemTrustManager: X509TrustManager by lazy { createSystemTrustManager() }

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
        var temporary: File? = null
        var installed = false
        return try {
            conn = openConnection(urlStr)
            conn.apply { connectTimeout = 10000; readTimeout = 60000 }
            if (conn.responseCode !in 200..299) return false
            val total = conn.contentLengthLong
            val tmp = File(dest.parentFile, dest.name + ".tmp")
            temporary = tmp
            tmp.delete()
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
            if (expectedSha256 != null && !ModelHash.matches(tmp, expectedSha256)) {
                android.util.Log.e("ModelDownloader", "模型 hash 校验失败: ${urlStr}")
                return false
            }
            installed = installAtomically(tmp, dest)
            if (!installed) android.util.Log.e("ModelDownloader", "模型文件原子安装失败: ${dest.absolutePath}")
            installed
        } catch (e: Exception) {
            android.util.Log.e("ModelDownloader", "模型下载失败: ${urlStr} ${e.message}")
            false
        } finally {
            if (!installed) temporary?.delete()
            conn?.disconnect()
        }
    }

    // 读取服务器端很小的 hash 文件；网络失败返回 null，由模型管理器决定是否沿用本地已验证模型。
    fun readText(urlStr: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = openConnection(urlStr)
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

    private fun openConnection(urlStr: String): HttpURLConnection {
        val raw = URL(urlStr).openConnection()
        if (raw !is HttpsURLConnection) return raw as HttpURLConnection
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf<TrustManager>(PinnedOrSystemTrustManager()), SecureRandom())
        raw.sslSocketFactory = sslContext.socketFactory
        raw.hostnameVerifier = HostnameVerifier { hostname, session ->
            if (isPinned(session)) isDevelopmentHost(hostname)
            else HttpsURLConnection.getDefaultHostnameVerifier().verify(hostname, session)
        }
        return raw
    }

    private fun installAtomically(temporary: File, destination: File): Boolean {
        if (temporary.renameTo(destination)) return true
        val backup = File(destination.parentFile, "${destination.name}.backup")
        backup.delete()
        val movedOld = !destination.exists() || destination.renameTo(backup)
        if (!movedOld) return false
        val movedNew = temporary.renameTo(destination)
        if (!movedNew) {
            if (backup.isFile) backup.renameTo(destination)
            return false
        }
        backup.delete()
        return true
    }

    private fun isPinned(session: SSLSession): Boolean {
        return try {
            val certificate = session.peerCertificates.firstOrNull() as? X509Certificate ?: return false
            certificateSha256(certificate.encoded) == DEVELOPMENT_SERVER_CERT_SHA256
        } catch (_: Exception) {
            false
        }
    }

    private fun isDevelopmentHost(hostname: String): Boolean {
        val normalized = hostname.trim().lowercase()
        if (normalized == "localhost" || normalized == "127.0.0.1" || normalized == "::1") return true
        val parts = normalized.split('.')
        if (parts.size != 4 || parts.any { it.toIntOrNull() == null }) return false
        val octets = parts.map { it.toInt() }
        return octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168)
    }

    private fun certificateSha256(encoded: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(encoded)
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private fun createSystemTrustManager(): X509TrustManager {
        val factory = javax.net.ssl.TrustManagerFactory.getInstance(
            javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm()
        )
        factory.init(null as KeyStore?)
        return factory.trustManagers.filterIsInstance<X509TrustManager>().first()
    }

    private class PinnedOrSystemTrustManager : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            systemTrustManager.checkClientTrusted(chain, authType)
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val first = chain?.firstOrNull()
            if (first != null && certificateSha256(first.encoded) == DEVELOPMENT_SERVER_CERT_SHA256) return
            systemTrustManager.checkServerTrusted(chain, authType)
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = systemTrustManager.acceptedIssuers
    }
}
