package com.aasc.display

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NodeServerConfigTest {

    @Test
    fun 普通APK冷启动保留远端保存的8071端口与其他配置() {
        val root = createTempDirectory("aasc-node-custom-port")
        try {
            val config = NodeServerConfig.write(root, "https://main.example:8081", "测试节点")
            val saved = JSONObject(config.readText())
            val nodeId = saved.getJSONObject("aasc").getString("nodeId")
            saved.getJSONObject("server").put("port", 8071).put("customValue", "保留")
            config.writeText(saved.toString())
            repeat(2) { NodeServerConfig.write(root, "https://main.example:8081", "测试节点") }
            val actual = JSONObject(config.readText())
            assertEquals(8071, NodeServerConfig.readServerPort(root))
            assertEquals("保留", actual.getJSONObject("server").getString("customValue"))
            assertEquals(nodeId, actual.getJSONObject("aasc").getString("nodeId"))
            assertEquals("https://main.example:8081", actual.getJSONObject("aasc").getString("mainServerUrl"))
        } finally { root.deleteRecursively() }
    }

    @Test
    fun 普通APK端口边界保持且非法类型和范围回退8081() {
        val root = createTempDirectory("aasc-node-port-range")
        try {
            val file = File(root, "config/config.json")
            file.parentFile?.mkdirs()
            for (value in listOf<Any>(1, 65535, 0, -1, 65536, 8071.5, "8071", true, JSONObject.NULL, 4294975367L)) {
                file.writeText(JSONObject().put("server", JSONObject().put("port", value)).toString())
                NodeServerConfig.write(root, "https://main.example:8081", "测试节点")
                assertEquals(if (value == 1 || value == 65535) value else 8081, NodeServerConfig.readServerPort(root))
            }
        } finally { root.deleteRecursively() }
    }

    @Test
    fun Offline启动端口仍遵循8081回环页面约定() {
        val root = createTempDirectory("aasc-offline-default-port")
        try {
            val file = File(root, "config/config.json")
            file.parentFile?.mkdirs()
            file.writeText("""{"server":{"port":8071}}""")
            NodeServerConfig.write(root, "https://127.0.0.1:8081", "Offline", offlineMode = true)
            assertEquals(8081, NodeServerConfig.readServerPort(root))
        } finally { root.deleteRecursively() }
    }

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

    @Test
    fun 离线APK写入main角色且保留本机地址() {
        val root = createTempDirectory("aasc-offline-node-config")

        val file = NodeServerConfig.write(
            root,
            "https://127.0.0.1:8081",
            "AASC 显示端 Offline",
            offlineMode = true
        )
        val config = JSONObject(file.readText())

        assertEquals("main", config.getJSONObject("aasc").getString("role"))
        assertEquals("https://127.0.0.1:8081", config.getJSONObject("aasc").getString("mainServerUrl"))
        assertEquals("AASC 显示端 Offline", config.getJSONObject("aasc").getString("nodeName"))
        assertEquals("display", config.getJSONObject("asr").getString("device"))

        root.deleteRecursively()
    }

    private fun createTempDirectory(prefix: String): File {
        return kotlin.io.path.createTempDirectory(prefix).toFile()
    }
}
