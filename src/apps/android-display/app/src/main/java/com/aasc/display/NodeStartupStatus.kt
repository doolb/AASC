package com.aasc.display

/** 启动状态独立于更新进度保存，供前台恢复后重放；不代表模型已准备。 */
internal data class NodeStartupSnapshot(
    val status: String,
    val detail: String? = null,
    val phase: String? = null,
    val completedBytes: Long? = null,
    val totalBytes: Long? = null
)

internal class NodeStartupStatus {
    private var latest: NodeStartupSnapshot? = null

    /** 保存与广播使用同一把锁，避免补发旧 ready 晚于新一轮 preparing。 */
    @Synchronized
    fun publish(snapshot: NodeStartupSnapshot, broadcast: (NodeStartupSnapshot) -> Unit) {
        when (snapshot.status) {
            NodeServerService.STATUS_PREPARING,
            NodeServerService.STATUS_INSTALLING,
            NodeServerService.STATUS_STARTING,
            NodeServerService.STATUS_READY,
            NodeServerService.STATUS_FAILED -> latest = snapshot
        }
        broadcast(snapshot)
    }

    /** 无快照时不虚构 ready；服务稍后正常发送启动状态即可。 */
    @Synchronized
    fun replay(broadcast: (NodeStartupSnapshot) -> Unit) {
        latest?.let(broadcast)
    }

    /** 服务更新停止进程后，旧 ready 不得用于恢复前台的健康门槛。 */
    @Synchronized
    fun invalidate() {
        latest = null
    }
}
