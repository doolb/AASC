package com.aasc.display

import org.json.JSONObject

/** 本机IPC的第二层校验：只恢复官网两来源的受限Cookie及已保存的设备字段。 */
object DoubaoWebViewAccount {
    const val ORIGIN = "https://www.doubao.com"
    fun validate(input: JSONObject, expected: String): JSONObject {
        require(Regex("^[A-Za-z0-9_-]{16,512}$").matches(expected))
        val snapshot = input.getJSONObject("cookieSnapshot")
        require(snapshot.length() in 1..2)
        val cookieName = Regex("^[A-Za-z0-9_!#$%&'*+.^`|~-]{1,128}$")
        val cookieValue = Regex("^[\\x21\\x23-\\x2B\\x2D-\\x3A\\x3C-\\x5B\\x5D-\\x7E]{1,4096}$")
        for (origin in snapshot.keys()) {
            require(origin in setOf(ORIGIN, "https://accounts.doubao.com"))
            val raw = snapshot.getString(origin)
            require(raw.length in 1..32768 && raw.split(';').size <= 64)
            for (part in raw.split(';')) {
                val pair = part.trim().split('=', limit = 2)
                require(pair.size == 2 && cookieName.matches(pair[0]) && cookieValue.matches(pair[1]))
            }
        }
        val cookies = snapshot.getString(ORIGIN).split(';').map { it.trim().split('=', limit = 2) }
        require(cookies.firstOrNull { it[0] == "sessionid" }?.get(1) == expected)
        val profile = input.getJSONObject("nodeProfile")
        require(Regex("^[0-9]{1,32}$").matches(profile.getString("deviceId")))
        require(Regex("^[0-9]{1,32}$").matches(profile.getString("webId")))
        require(Regex("^[A-Za-z0-9_-]{8,256}$").matches(profile.getString("fp")))
        require(cookies.firstOrNull { it[0] == "s_v_web_id" }?.get(1) == profile.getString("fp"))
        val agent = profile.getString("userAgent")
        require(agent.length <= 512 && Regex("^Mozilla/5\\.0 [\\x20-\\x7E]{10,}$").matches(agent))
        return JSONObject(input.toString())
    }

    fun storageScript(profile: JSONObject): String {
        val values = JSONObject()
            .put("samantha_web_web_id", JSONObject().put("web_id", profile.getString("deviceId")).toString())
            .put("__tea_cache_tokens_497858", JSONObject().put("web_id", profile.getString("webId")).toString())
        return "if(location.origin==='https://www.doubao.com'){const values=$values;for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);}"
    }
}

/** 登录和网页请求共享Cookie目录，持有租约期间禁止另一个入口清空或切换账号。 */
object Chat2ApiWebViewLease {
    private var owner = ""
    @Synchronized fun acquire(value: String): Boolean {
        if (owner.isNotEmpty()) return false
        owner = value
        return true
    }
    @Synchronized fun release(value: String) { if (owner == value) owner = "" }
}
