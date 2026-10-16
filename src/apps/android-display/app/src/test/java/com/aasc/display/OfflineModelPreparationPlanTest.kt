package com.aasc.display

import java.io.IOException
import java.util.concurrent.CancellationException
import org.junit.Assert.*
import org.junit.Test

class OfflineModelPreparationPlanTest {
    private fun model(id: String, bytes: Long) = OfflineModelDefinition(id, "revision-$id",
        listOf(OfflineModelFile("model.bin", "$id/model.bin", bytes, "a".repeat(64))))
    private val definitions = listOf(model("sensevoice", 30), model("voiceprint", 40),
        model("tts", 10), model("llm-example", 100))
    private val groups get() = OfflineModelPreparationPlan.groups(definitions)
    private fun asrPlan() = OfflineModelPreparationPlan(definitions, groups.filter { it.title == "ASR/声纹" })

    @Test
    fun 入口合组但原模型ID路径与全部LLM均保持可达() {
        assertEquals(listOf("TTS", "ASR/声纹"), groups.filter { it.defaultSelected }.map { it.title })
        assertEquals(listOf("sensevoice", "voiceprint"), groups[1].modelIds)
        val all = OfflineModelPreparationPlan(definitions, groups).models
        assertEquals(definitions.map { it.modelId }.toSet(), all.map { it.modelId }.toSet())
        assertEquals(definitions.associate { it.modelId to it.files }, all.associate { it.modelId to it.files })
        assertEquals(4, all.size)
    }

    @Test
    fun 部分缓存只计算缺项且重复选择不会准备重复模型() {
        val plan = OfflineModelPreparationPlan(definitions, groups + groups)
        assertEquals(4, plan.models.size)
        assertEquals(50L, OfflineModelPreparationPlan(definitions, groups.filter { it.defaultSelected })
            .pendingBytes { it == "sensevoice" })
        assertEquals(0L, plan.pendingBytes { true })
    }

    @Test
    fun 汇总按字节进度且换源重试不倒退缓存仍做准备校验() {
        val started = mutableListOf<String>()
        val ready = mutableListOf<String>()
        val progress = mutableListOf<Int>()
        asrPlan().prepare({ false }, { model, update ->
            started += model.modelId
            if (model.modelId == "voiceprint") { update(90); update(20); update(100) }
        }, { _, value -> progress += value }, ready::add)
        assertEquals(listOf("sensevoice", "voiceprint"), started)
        assertEquals(started, ready)
        assertEquals(listOf(42, 94, 94, 99, 100), progress)
    }

    @Test
    fun 单项失败保留已完成通知且不报告整组百分之百() {
        val ready = mutableListOf<String>()
        val progress = mutableListOf<Int>()
        try {
            asrPlan().prepare({ false }, { model, _ ->
                if (model.modelId == "voiceprint") throw IOException("传输失败")
            }, { _, value -> progress += value }, ready::add)
            fail("应报告下载失败")
        } catch (error: IOException) { assertEquals("传输失败", error.message) }
        assertEquals(listOf("sensevoice"), ready)
        assertEquals(listOf(42), progress)
    }

    @Test
    fun 完成首项后取消不启动下一项() {
        var cancelled = false
        val started = mutableListOf<String>()
        val ready = mutableListOf<String>()
        try {
            asrPlan().prepare({ cancelled }, { model, _ -> started += model.modelId }, { _, _ -> }, {
                ready += it; cancelled = true
            })
            fail("应取消后续项")
        } catch (_: CancellationException) { }
        assertEquals(listOf("sensevoice"), started)
        assertEquals(started, ready)
    }

    @Test
    fun 下载中取消阻止迟到进度与完成回调() {
        var cancelled = false
        val ready = mutableListOf<String>()
        val progress = mutableListOf<Int>()
        try {
            asrPlan().prepare({ cancelled }, { _, update ->
                update(30); cancelled = true; update(100)
            }, { _, value -> progress += value }, ready::add)
            fail("应拒绝取消后的回调")
        } catch (_: CancellationException) { }
        assertTrue(ready.isEmpty())
        assertEquals(listOf(12), progress)
    }

    @Test
    fun 首次提示同时等待健康与页面且两种到达顺序均只提示一次() {
        for (nodeFirst in listOf(true, false)) {
            val state = OfflineVoiceFirstRunState()
            if (nodeFirst) state.nodeReady = true else state.displayReady = true
            assertFalse(state.tryPrompt(true, true, true, true) { fail("门槛未就绪不展示"); true })
            state.nodeReady = true; state.displayReady = true
            assertTrue(state.tryPrompt(true, true, true, true) { true })
            assertFalse(state.tryPrompt(true, true, true, true) { fail("不能重复展示"); true })
            state.displayReady = false
            assertFalse(state.tryPrompt(true, true, true, true) { true })
            state.displayReady = true
            assertFalse(state.tryPrompt(true, true, true, true) { true })
        }
    }

    @Test
    fun 普通及完整APK不消耗首次标记而已有验证模型无需提示() {
        val state = OfflineVoiceFirstRunState().apply { nodeReady = true; displayReady = true }
        assertFalse(state.tryPrompt(false, false, true, true) { fail("普通APK不能自动提示"); true })
        assertFalse(state.tryPrompt(true, false, true, true) { fail("完整APK不能自动提示"); true })
        assertFalse(state.prompted)
        assertTrue(state.tryPrompt(true, true, true, false) { fail("完整缓存不能弹框"); true })
        assertTrue(state.prompted)
    }

    @Test
    fun 取消稍后的持久化标记恢复后不自动下载或重复提示() {
        val state = OfflineVoiceFirstRunState().apply { nodeReady = true; displayReady = true }
        assertTrue(state.tryPrompt(true, true, true, true) { true })
        val recreated = OfflineVoiceFirstRunState().apply {
            prompted = state.prompted; nodeReady = true; displayReady = true
        }
        assertFalse(recreated.tryPrompt(true, true, true, true) { fail("恢复标记后不能重复展示"); true })
    }

    @Test
    fun 后台完成服务与页面后不消耗提示返回前台仍可展示() {
        val state = OfflineVoiceFirstRunState().apply { nodeReady = true; displayReady = true }
        assertFalse(state.tryPrompt(true, true, false, true) { fail("后台不能弹框"); true })
        assertFalse(state.prompted)
        assertTrue(state.tryPrompt(true, true, true, true) { true })
    }

    @Test
    fun 展示失败保留首次机会直到实际展示成功才提交() {
        val state = OfflineVoiceFirstRunState().apply { nodeReady = true; displayReady = true }
        assertFalse(state.tryPrompt(true, true, true, true) { false })
        assertFalse(state.prompted)
        assertTrue(state.tryPrompt(true, true, true, true) {
            assertFalse(state.prompted)
            true
        })
        assertTrue(state.prompted)
    }

    @Test
    fun 窗口展示异常不消耗标记下一次就绪允许重试() {
        val state = OfflineVoiceFirstRunState().apply { nodeReady = true; displayReady = true }
        try {
            state.tryPrompt(true, true, true, true) { throw IllegalStateException("窗口已失效") }
            fail("应向Activity报告展示失败")
        } catch (error: IllegalStateException) {
            assertEquals("窗口已失效", error.message)
        }
        assertFalse(state.prompted)
        assertTrue(state.tryPrompt(true, true, true, true) { true })
    }
}
