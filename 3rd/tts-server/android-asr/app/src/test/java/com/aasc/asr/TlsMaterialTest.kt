package com.aasc.asr

import java.io.File
import org.junit.Assert.assertNotNull
import org.junit.Test

class TlsMaterialTest {
    @Test
    fun loadsBundledCertificateAndPrivateKey() {
        val certificate = File("../../../../res/certs/android-asr-cert.pem")
        val privateKey = File("../../../../res/certs/android-asr-key.pem")

        assertNotNull(TlsMaterial.load(certificate, privateKey))
    }
}
