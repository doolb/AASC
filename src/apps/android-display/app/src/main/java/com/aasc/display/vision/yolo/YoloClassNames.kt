package com.aasc.display.vision.yolo

import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** 从与模型一起分发的 sidecar JSON 读取 YOLO 类别名称。 */
class YoloClassNames private constructor(
    private val names: List<String>
) {
    fun nameFor(classId: Int): String? = names.getOrNull(classId)?.takeIf { it.isNotBlank() }

    companion object {
        fun read(file: File): YoloClassNames {
            if (!file.isFile || file.length() <= 0L) return YoloClassNames(emptyList())
            return try {
                val root = JSONObject(file.readText())
                YoloClassNames(readNames(root))
            } catch (_: Exception) {
                YoloClassNames(emptyList())
            }
        }

        private fun readNames(root: JSONObject): List<String> {
            root.optJSONArray("names")?.let { return readArray(it) }
            val objectNames = root.optJSONObject("names") ?: return emptyList()
            val indexed = mutableMapOf<Int, String>()
            val keys = objectNames.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val index = key.toIntOrNull() ?: return emptyList()
                val value = objectNames.optString(key).trim()
                if (index < 0 || value.isEmpty()) return emptyList()
                indexed[index] = value
            }
            if (indexed.isEmpty()) return emptyList()
            return List((indexed.keys.maxOrNull() ?: -1) + 1) { indexed[it].orEmpty() }
        }

        private fun readArray(array: JSONArray): List<String> = buildList {
            for (index in 0 until array.length()) {
                val name = array.optString(index).trim()
                if (name.isEmpty()) return emptyList()
                add(name)
            }
        }
    }
}
