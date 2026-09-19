package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class Chat2ApiNativeBridgeTest {
    @Test
    fun normalizeDownloadFileName_拒绝路径和控制字符() {
        assertEquals("chat2api-accounts-20260918120000.json", Chat2ApiNativeBridge.normalizeDownloadFileName("chat2api-accounts-20260918120000.json"))
        assertNull(Chat2ApiNativeBridge.normalizeDownloadFileName("../credentials.json"))
        assertNull(Chat2ApiNativeBridge.normalizeDownloadFileName("Download/credentials.json"))
        assertNull(Chat2ApiNativeBridge.normalizeDownloadFileName("credentials\u0000.json"))
    }
}
