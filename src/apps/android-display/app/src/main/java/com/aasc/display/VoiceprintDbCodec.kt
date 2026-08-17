package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject

// 声纹库编解码（纯逻辑，JVM 单测）：{version, dim, speakers:{name:[512 个浮点]}}
// dim 由 onnxruntime 实测为 512（Task 4 已验证），与服务器端一致
object VoiceprintDbCodec {

    // 解析服务器 /api/voiceprint/db 响应里的 speakers 对象 → name -> embedding
    // 长度以实际数组为准（不依赖 dim 字段，容错不同维度）
    fun speakersFromDb(dbJson: JSONObject): Map<String, FloatArray> {
        val out = LinkedHashMap<String, FloatArray>()
        val speakers = dbJson.optJSONObject("speakers") ?: return out
        val keys = speakers.keys()
        while (keys.hasNext()) {
            val name = keys.next()
            val arr = speakers.optJSONArray(name) ?: continue
            val emb = FloatArray(arr.length())
            for (i in 0 until arr.length()) emb[i] = arr.optDouble(i).toFloat()
            out[name] = emb
        }
        return out
    }

    // 本机缓存序列化
    fun toJson(speakers: Map<String, FloatArray>): JSONObject {
        val obj = JSONObject()
        val speakersObj = JSONObject()
        for ((name, emb) in speakers) {
            val arr = JSONArray()
            for (v in emb) arr.put(v.toDouble())
            speakersObj.put(name, arr)
        }
        obj.put("version", 1)
        obj.put("dim", 512)
        obj.put("speakers", speakersObj)
        return obj
    }
}
