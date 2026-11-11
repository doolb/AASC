package com.aasc.display

/** 启动状态独立于更新进度保存，供前台恢复后重放；不代表模型已准备。 */
internal data class NodeStartupSnapshot(
    val status: String,
    val detail: String? = null,
    val phase: String? = null,
    val completedBytes: Long? = null,
    val totalBytes: Long? = null,
    val updateSequence: Long = 0L
)

internal class NodeStartupStatus {
    private var latest: NodeStartupSnapshot? = null
    private var latestUpdate: NodeStartupSnapshot? = null
    private var sequence = 0L

    /** 保存与广播使用同一把锁，避免补发旧 ready 晚于新一轮 preparing。 */
    @Synchronized
    fun publish(snapshot: NodeStartupSnapshot, broadcast: (NodeStartupSnapshot) -> Unit) {
        var outgoing = snapshot
        when (snapshot.status) {
            NodeServerService.STATUS_PREPARING,
            NodeServerService.STATUS_INSTALLING,
            NodeServerService.STATUS_STARTING,
            NodeServerService.STATUS_READY,
            NodeServerService.STATUS_FAILED -> latest = snapshot
            NodeServerService.STATUS_SERVICE_UPDATE_APPLYING,
            NodeServerService.STATUS_SERVICE_UPDATE_PROGRESS,
            NodeServerService.STATUS_SERVICE_UPDATE_APPLIED,
            NodeServerService.STATUS_SERVICE_UPDATE_FAILED -> {
                outgoing = snapshot.copy(updateSequence = ++sequence)
                latestUpdate = outgoing
            }
        }
        broadcast(outgoing)
    }

    /** 无快照时不虚构 ready；服务稍后正常发送启动状态即可。 */
    @Synchronized
    fun replay(broadcast: (NodeStartupSnapshot) -> Unit) {
        latest?.let(broadcast)
    }

    /** 更新状态与健康快照分开保存；恢复时不把进度误认为服务已就绪。 */
    @Synchronized
    fun replayUpdate(broadcast: (NodeStartupSnapshot) -> Unit) {
        latestUpdate?.let(broadcast)
    }

    /** 仅确认同一终态，旧确认不得清除随后开始的新更新。 */
    @Synchronized
    fun acknowledgeUpdate(status: String, updateSequence: Long) {
        if (status in setOf(NodeServerService.STATUS_SERVICE_UPDATE_APPLIED, NodeServerService.STATUS_SERVICE_UPDATE_FAILED)
            && latestUpdate?.status == status && latestUpdate?.updateSequence == updateSequence) latestUpdate = null
    }

    /** 服务更新停止进程后，旧 ready 不得用于恢复前台的健康门槛。 */
    @Synchronized
    fun invalidate() {
        latest = null
    }
}
