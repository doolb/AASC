package com.aasc.display

/** 自动重试继续进行，界面保留已经发现的错误，直到用户重试或实际健康确认。 */
class OfflineFailureState {
    var startupError: String? = null
        private set
    var updateError: String? = null
        private set

    fun startup(message: String, failed: Boolean): String {
        if (failed) startupError = message
        return startupError ?: message
    }
    fun updateFailed(message: String) { updateError = message }
    fun retryStartup() { startupError = null }
    fun retryUpdate() { updateError = null }
    fun restore(startup: String?, update: String?) { startupError = startup; updateError = update }
}
