package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class Chat2ApiNativeBridgeTest {
    @Test fun runtimePage_只允许本机Offline来源() {
        for (url in listOf("http://127.0.0.1:8081", "https://localhost/control", "http://[::1]:8080")) {
            assertTrue(url, Chat2ApiNativeBridge.isLocalRuntimeUrl(url))
        }
        for (url in listOf(null, "", "file:///android_asset/control.html", "http://192.168.1.39:8081",
            "http://127.0.0.1.example.com", "https://user@localhost", "http://localhost:999999", "not a url")) {
            assertFalse(url, Chat2ApiNativeBridge.isLocalRuntimeUrl(url))
        }
    }

    @Test
    fun normalizeDownloadFileName_拒绝路径和控制字符() {
        assertEquals("chat2api-accounts-20260918120000.json", Chat2ApiNativeBridge.normalizeDownloadFileName("chat2api-accounts-20260918120000.json"))
        assertNull(Chat2ApiNativeBridge.normalizeDownloadFileName("../credentials.json"))
        assertNull(Chat2ApiNativeBridge.normalizeDownloadFileName("Download/credentials.json"))
        assertNull(Chat2ApiNativeBridge.normalizeDownloadFileName("credentials\u0000.json"))
    }
}
