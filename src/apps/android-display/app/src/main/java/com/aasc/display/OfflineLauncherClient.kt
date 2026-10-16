package com.aasc.display

import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** 仅连接由本应用创建的进程管道，不开放端口，不接受网页指定执行入口。 */
internal object OfflineLauncherClient {
    private val monitor = Object()
    @Volatile private var session: OfflineLauncherSession? = null
    @Volatile var catalog: JSONObject? = null
        private set
    @Volatile var modelStates = org.json.JSONArray()
        private set
    @Volatile var uiRoot: String? = null
        private set
    private val listeners = java.util.concurrent.CopyOnWriteArraySet<(JSONObject) -> Unit>()
    fun subscribe(listener: (JSONObject) -> Unit) { listeners.add(listener) }
    fun unsubscribe(listener: (JSONObject) -> Unit) { listeners.remove(listener) }
    val available get() = session?.ready == true
    private data class Pending(val result: CompletableFuture<Any>, val progress: ((JSONObject) -> Unit)?)
    private val pending = ConcurrentHashMap<String, Pending>()

    fun attach(value: OfflineLauncherSession) = synchronized(monitor) {
        pending.values.forEach { it.result.completeExceptionally(IllegalStateException("JS启动器会话已替换")) }
        pending.clear()
        catalog = null
        modelStates = org.json.JSONArray()
        session = value
        monitor.notifyAll()
    }

    fun receive(value: OfflineLauncherSession, message: JSONObject) {
        if (session !== value || message.optString("generation") != value.generation) return
        if (message.optString("type") == "launcher.ready") synchronized(monitor) {
            uiRoot = message.optJSONObject("payload")?.optString("uiRoot")
            catalog = message.optJSONObject("payload")?.optJSONObject("catalog")
            value.ready = true
            monitor.notifyAll()
        }
        if (message.optString("type") == "models.state") modelStates = message.getJSONArray("payload")
        listeners.forEach { runCatching { it(message) } }
        val id = message.optString("requestId")
        if (message.optString("type") == "rpc.result") {
            val request = pending.remove(id) ?: return
            if (message.has("error")) request.result.completeExceptionally(IllegalStateException(message.optString("error")))
            else request.result.complete(message.opt("result") ?: JSONObject())
            return
        }
        if (id.isNotEmpty()) runCatching { pending[id]?.progress?.invoke(message) }
        else if (message.optString("type") == "update.progress") pending.values.forEach { runCatching { it.progress?.invoke(message) } }
    }

    fun detach(value: OfflineLauncherSession) = synchronized(monitor) {
        if (session !== value) return@synchronized
        session = null
        pending.values.forEach { it.result.completeExceptionally(IllegalStateException("JS启动器已停止，请重试")) }
        pending.clear()
        monitor.notifyAll()
    }

    fun call(type: String, payload: JSONObject = JSONObject(), timeoutSeconds: Long = 180,
        progress: ((JSONObject) -> Unit)? = null): Any {
        val selected = synchronized(monitor) {
            val deadline = android.os.SystemClock.elapsedRealtime() + 30_000
            while (session?.ready != true) {
                val left = deadline - android.os.SystemClock.elapsedRealtime()
                check(left > 0) { "JS启动器尚未就绪，请稍后重试" }
                monitor.wait(left)
            }
            session!!
        }
        val id = UUID.randomUUID().toString()
        val result = CompletableFuture<Any>()
        pending[id] = Pending(result, progress)
        try {
            selected.write(JSONObject().put("type", type).put("payload", payload).put("requestId", id).put("generation", selected.generation))
            return result.get(timeoutSeconds, TimeUnit.SECONDS)
        } catch (error: java.util.concurrent.ExecutionException) {
            throw IllegalStateException(error.cause?.message ?: "JS操作失败", error.cause)
        } finally { pending.remove(id) }
    }

    fun objectCall(type: String, payload: JSONObject = JSONObject(), timeoutSeconds: Long = 180,
        progress: ((JSONObject) -> Unit)? = null): JSONObject = call(type, payload, timeoutSeconds, progress) as JSONObject

    /** 取消不能排在长下载之后，单独线程发送并接收结果。 */
    fun notify(type: String, payload: JSONObject = JSONObject()) {
        Thread({
            try { call(type, payload, 10) }
            catch (error: Exception) { android.util.Log.w("AASC-JS-Launcher", "启动器通知失败: ${error.message}") }
        }, "aasc-launcher-notify").apply { isDaemon = true; start() }
    }
}
