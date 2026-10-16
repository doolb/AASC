package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class OfflineModelDirectorySnapshotTest {
    private val root = File(System.getProperty("java.io.tmpdir"), "aasc-model-snapshot-test")
    private val bundled = listOf("tts", "sensevoice", "voiceprint", "local-llm").map { OfflineModelDefinition(it, "r1", emptyList()) }
    @Test fun JS状态为空时原生桥仍能取得可信语音占位路径() {
        for (id in listOf("tts", "sensevoice", "voiceprint"))
            assertEquals(File(root, "models/$id"), OfflineModelDirectorySnapshot.resolve(root, id, JSONArray(), bundled))
        assertEquals(File(root, "models/llm/local-llm"), OfflineModelDirectorySnapshot.resolve(root, "local-llm", JSONArray(), bundled))
        assertFalse(root.exists())
    }
    @Test fun JS快照到达后立即采用权威目录而非构造时占位() {
        val initial = OfflineModelDirectorySnapshot.resolve(root, "tts", JSONArray(), bundled)
        val current = File(root, "aasc-server/res/models/tts")
        val states = JSONArray().put(JSONObject().put("modelId", "tts").put("directory", current.absolutePath))
        assertNotEquals(initial, OfflineModelDirectorySnapshot.resolve(root, "tts", states, bundled))
        assertEquals(current, OfflineModelDirectorySnapshot.resolve(root, "tts", states, bundled))
    }
    @Test fun 未声明的占位ID与私有目录外快照被拒绝() {
        try { OfflineModelDirectorySnapshot.resolve(root, "../bad", JSONArray(), bundled); fail("越界ID必须拒绝") }
        catch (_: IllegalArgumentException) { }
        val states = JSONArray().put(JSONObject().put("modelId", "tts").put("directory", File(root, "../outside").absolutePath))
        try { OfflineModelDirectorySnapshot.resolve(root, "tts", states, bundled); fail("越界目录必须拒绝") }
        catch (_: IllegalArgumentException) { }
    }
    @Test fun JS热更新增模型仍可用有效快照提供目录() {
        val current = File(root, "models/llm/new-model")
        val states = JSONArray().put(JSONObject().put("modelId", "new-model").put("directory", current.absolutePath))
        assertEquals(current, OfflineModelDirectorySnapshot.resolve(root, "new-model", states, bundled))
    }
}
