package com.aasc.display

import org.junit.Assert.*
import org.junit.Test

class NodeStartupStatusTest {
    @Test
    fun 未收到启动状态时重放不伪造健康() {
        NodeStartupStatus().replay { fail("空状态不能补发ready") }
    }

    @Test
    fun 后台错过健康广播后恢复页面可以补发并提示() {
        val status = NodeStartupStatus()
        status.publish(NodeStartupSnapshot(NodeServerService.STATUS_STARTING)) { }
        status.publish(NodeStartupSnapshot(NodeServerService.STATUS_READY)) { }
        val restored = OfflineVoiceFirstRunState().apply { displayReady = true }
        assertFalse(restored.tryPrompt(true, true, true, true) { fail("缺健康状态"); true })
        status.replay { restored.nodeReady = it.status == NodeServerService.STATUS_READY }
        assertTrue(restored.tryPrompt(true, true, true, true) { true })
        // 新Activity仍使用同一运行中服务，补发不消耗服务快照。
        val recreated = OfflineVoiceFirstRunState()
        status.replay { recreated.nodeReady = it.status == NodeServerService.STATUS_READY }
        assertTrue(recreated.nodeReady)
        assertFalse(recreated.tryPrompt(true, true, true, true) { fail("重建后仍须等新页面"); true })
        recreated.displayReady = true
        assertTrue(recreated.tryPrompt(true, true, true, true) { true })
    }

    @Test
    fun 服务更新提示与进度不覆盖启动健康快照() {
        val status = NodeStartupStatus()
        val delivered = mutableListOf<String>()
        status.publish(NodeStartupSnapshot(NodeServerService.STATUS_READY)) { delivered += it.status }
        for (event in listOf(NodeServerService.STATUS_SERVICE_UPDATE_APPLYING,
            NodeServerService.STATUS_SERVICE_UPDATE_PROGRESS, NodeServerService.STATUS_SERVICE_UPDATE_APPLIED,
            NodeServerService.STATUS_SERVICE_UPDATE_FAILED)) {
            status.publish(NodeStartupSnapshot(event)) { delivered += it.status }
            status.replay { assertEquals(NodeServerService.STATUS_READY, it.status) }
        }
        assertEquals(5, delivered.size)
    }

    @Test
    fun 新一轮准备及失败覆盖旧ready并保留完整详情() {
        val status = NodeStartupStatus()
        status.publish(NodeStartupSnapshot(NodeServerService.STATUS_READY)) { }
        val preparing = NodeStartupSnapshot(NodeServerService.STATUS_PREPARING)
        status.publish(preparing) { }
        status.replay { assertEquals(preparing, it) }
        val failed = NodeStartupSnapshot(NodeServerService.STATUS_FAILED, "空间不足")
        status.publish(failed) { }
        status.replay { assertEquals(failed, it) }
    }

    @Test
    fun 更新停进程后旧健康失效直到新进程通过健康检查() {
        val status = NodeStartupStatus()
        status.publish(NodeStartupSnapshot(NodeServerService.STATUS_READY)) { }
        status.invalidate()
        status.publish(NodeStartupSnapshot(NodeServerService.STATUS_SERVICE_UPDATE_PROGRESS)) { }
        status.replay { fail("进程已停不能补发旧健康或把更新进度当健康") }
        status.publish(NodeStartupSnapshot(NodeServerService.STATUS_STARTING)) { }
        status.replay { assertEquals(NodeServerService.STATUS_STARTING, it.status) }
        status.publish(NodeStartupSnapshot(NodeServerService.STATUS_READY)) { }
        status.replay { assertEquals(NodeServerService.STATUS_READY, it.status) }
    }

    @Test
    fun 首装进度补发保留阶段和字节且后续健康替换进度() {
        val status = NodeStartupStatus()
        val progress = NodeStartupSnapshot(NodeServerService.STATUS_INSTALLING, "code.zip", "download", 30, 100)
        status.publish(progress) { }
        status.replay { assertEquals(progress, it) }
        status.publish(NodeStartupSnapshot(NodeServerService.STATUS_READY)) { }
        status.replay {
            assertEquals(NodeServerService.STATUS_READY, it.status)
            assertNull(it.completedBytes)
            assertNull(it.detail)
        }
    }
}
