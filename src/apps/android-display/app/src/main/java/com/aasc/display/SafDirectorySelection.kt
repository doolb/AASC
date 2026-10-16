package com.aasc.display

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.lang.ref.WeakReference
import java.util.UUID
import org.json.JSONObject

/**
 * 只维护一个SAF目录选择会话。系统选择结果才是授权完成，发起动作不等于成功。
 * 前台宿主使用弱引用，避免回环网关持有Activity；URI只由SharedStorageAccess保存。
 */
object SafDirectorySelection {
    private val lock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var foregroundHost = WeakReference<Activity>(null)
    private var requestId: String? = null
    private var state = "idle"
    private var pickerOpened = false
    private var message = "尚未发起目录选择"

    fun setForegroundHost(activity: Activity, resumed: Boolean) {
        synchronized(lock) {
            if (resumed) foregroundHost = WeakReference(activity)
            else if (foregroundHost.get() === activity) foregroundHost.clear()
        }
    }

    fun snapshot(context: android.content.Context, expectedId: String? = null): JSONObject = synchronized(lock) {
        val mismatch = expectedId != null && expectedId != requestId
        JSONObject().put("supported", SharedStorageAccess.requiresTreeAccess(Build.VERSION.SDK_INT))
            .put("requestId", if (mismatch) expectedId else requestId ?: JSONObject.NULL)
            .put("state", if (mismatch) "failed" else state)
            .put("message", if (mismatch) "目录选择会话已失效，请重新发起" else message)
            .put("hasDirectory", SharedStorageAccess.hasPersistedTreeUri(context))
    }

    fun request(context: android.content.Context): JSONObject {
        synchronized(lock) {
            if (state == "pending") return snapshot(context)
            requestId = UUID.randomUUID().toString()
            val id = requestId!!
            val host = foregroundHost.get()
            if (!SharedStorageAccess.requiresTreeAccess(Build.VERSION.SDK_INT)) {
                complete(id, "failed", "当前Android版本不使用SAF媒体目录")
                return snapshot(context)
            }
            if (host == null || host.isFinishing || host.isDestroyed) {
                complete(id, "failed", "请先在目标Android设备上打开显示端，再重选目录")
                return snapshot(context)
            }
            state = "pending"
            pickerOpened = false
            message = "请在目标Android设备的系统选择器中选择媒体目录"
            mainHandler.post {
                synchronized(lock) launch@ {
                    if (requestId != id || state != "pending") return@launch
                    if (foregroundHost.get() !== host || host.isFinishing || host.isDestroyed) {
                        complete(id, "failed", "目标显示端已离开前台，请返回后重试")
                        return@launch
                    }
                    try {
                        host.startActivity(Intent(host, SafDirectoryPickerActivity::class.java)
                            .putExtra(SafDirectoryPickerActivity.EXTRA_REQUEST_ID, id))
                        // 某些系统会无异常地阻止Activity拉起，未收到创建确认时必须允许用户重试。
                        mainHandler.postDelayed({
                            synchronized(lock) {
                                if (requestId == id && state == "pending" && !pickerOpened)
                                    complete(id, "failed", "系统未打开目录选择器，请回到目标显示端重试")
                            }
                        }, 10000)
                    } catch (_: Exception) {
                        complete(id, "failed", "无法打开系统目录选择器，请在设备上重试")
                    }
                }
            }
            return snapshot(context)
        }
    }

    fun isPending(id: String): Boolean = synchronized(lock) { requestId == id && state == "pending" }

    fun markOpened(id: String): Boolean = synchronized(lock) {
        if (requestId != id || state != "pending") return@synchronized false
        pickerOpened = true
        true
    }

    fun complete(id: String, result: String, detail: String) {
        synchronized(lock) {
            if (requestId != id) return
            state = result
            message = detail
        }
    }
}
