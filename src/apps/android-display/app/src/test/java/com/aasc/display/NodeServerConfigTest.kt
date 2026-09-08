package com.aasc.display

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NodeServerConfigTest {

    @Test
    fun 写入APK子服务器配置并保留稳定节点ID() {
        val root = createTempDirectory("aasc-node-config")

        val firstFile = NodeServerConfig.write(root, " https://192.168.1.39:8081/ ", "APK 子服务器")
        val first = JSONObject(firstFile.readText())
        val firstAasc = first.getJSONObject("aasc")
        val firstNodeId = firstAasc.getString("nodeId")

        val secondFile = NodeServerConfig.write(root, "https://main.example:8081", "新节点名")
        val second = JSONObject(secondFile.readText())
        val secondAasc = second.getJSONObject("aasc")

        assertEquals("subserver", firstAasc.getString("role"))
        assertEquals("https://192.168.1.39:8081", firstAasc.getString("mainServerUrl"))
        assertEquals(8081, first.getJSONObject("server").getInt("port"))
        assertFalse(first.getJSONObject("asr").getBoolean("serverEnabled"))
        assertFalse(first.getJSONObject("tts").getBoolean("serverEnabled"))
        assertFalse(first.getJSONObject("asr").getJSONObject("isolateProcess").getBoolean("enabled"))
        assertEquals(firstNodeId, secondAasc.getString("nodeId"))
        assertEquals("新节点名", secondAasc.getString("nodeName"))
        assertEquals("https://main.example:8081", secondAasc.getString("mainServerUrl"))

        root.deleteRecursively()
        assertTrue(!root.exists())
    }

    private fun createTempDirectory(prefix: String): File {
        return kotlin.io.path.createTempDirectory(prefix).toFile()
    }
}
