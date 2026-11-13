package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class WallpaperOverlayShowDebouncerTest {
    @Test fun `短暂返回桌面随后离开时不显示且立即隐藏`() {
        val queued = mutableListOf<Pair<Runnable, Long>>()
        val cancelled = mutableListOf<Runnable>()
        var shows = 0
        var hides = 0
        val gate = WallpaperOverlayShowDebouncer({ task, delay -> queued.add(task to delay) }, { cancelled.add(it) }, { shows++ }, { hides++ })
        gate.requestShow()
        assertEquals(250L, queued.single().second)
        gate.hideNow()
        assertEquals(1, hides)
        assertEquals(1, cancelled.size)
        queued.single().first.run()
        assertEquals(0, shows)
    }

    @Test fun `反复返回桌面只运行最后一次显示`() {
        val queued = mutableListOf<Runnable>()
        var shows = 0
        var hides = 0
        val gate = WallpaperOverlayShowDebouncer({ task, _ -> queued.add(task) }, {}, { shows++ }, { hides++ })
        gate.requestShow()
        gate.hideNow()
        gate.requestShow()
        queued[0].run()
        assertEquals(0, shows)
        queued[1].run()
        assertEquals(1, shows)
        gate.hideNow()
        assertEquals(2, hides)
    }

    @Test fun `连续显示请求只接受最新任务且不执行隐藏`() {
        val queued = mutableListOf<Runnable>()
        var shows = 0
        var hides = 0
        val gate = WallpaperOverlayShowDebouncer({ task, _ -> queued.add(task) }, {}, { shows++ }, { hides++ })
        gate.requestShow(); gate.requestShow()
        queued[0].run(); queued[1].run()
        assertEquals(1, shows)
        assertEquals(0, hides)
    }
}
