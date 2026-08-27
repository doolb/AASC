package com.aasc.asr

import android.content.res.AssetManager
import java.io.File
import java.io.InputStream
import java.security.KeyFactory
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

// 将测试用 PEM 证书和 PKCS#8 私钥装入内存 KeyStore，生成 HTTPS 服务端 SSLContext。
object TlsMaterial {
    private const val CERTIFICATE_ASSET = "tls/android-asr-cert.pem"
    private const val PRIVATE_KEY_ASSET = "tls/android-asr-key.pem"
    private const val KEY_ALIAS = "android-asr-server"

    fun load(assetManager: AssetManager): SSLContext =
        assetManager.open(CERTIFICATE_ASSET).use { certificate ->
            assetManager.open(PRIVATE_KEY_ASSET).use { privateKey -> load(certificate, privateKey) }
        }

    fun load(certificateFile: File, privateKeyFile: File): SSLContext =
        certificateFile.inputStream().use { certificate ->
            privateKeyFile.inputStream().use { privateKey -> load(certificate, privateKey) }
        }

    fun load(certificateInput: InputStream, privateKeyInput: InputStream): SSLContext {
        val certificate = CertificateFactory.getInstance("X.509")
            .generateCertificate(certificateInput)
        val privateKey = KeyFactory.getInstance("RSA")
            .generatePrivate(PKCS8EncodedKeySpec(decodePem(privateKeyInput.readBytes(), "PRIVATE KEY")))
        val password = CharArray(0)
        val keyStore = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, password)
            setKeyEntry(KEY_ALIAS, privateKey, password, arrayOf(certificate))
        }
        val keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
            init(keyStore, password)
        }
        return SSLContext.getInstance("TLS").apply {
            init(keyManagers.keyManagers, null, SecureRandom())
        }
    }

    private fun decodePem(bytes: ByteArray, label: String): ByteArray {
        val text = bytes.toString(Charsets.US_ASCII)
        val begin = "-----BEGIN $label-----"
        val end = "-----END $label-----"
        val body = text.substringAfter(begin, "").substringBefore(end, "")
        require(body.isNotBlank()) { "PEM 私钥格式无效" }
        return Base64.getMimeDecoder().decode(body)
    }
}
