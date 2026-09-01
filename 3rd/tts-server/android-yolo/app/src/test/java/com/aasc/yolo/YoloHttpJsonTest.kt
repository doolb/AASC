package com.aasc.yolo

import org.junit.Assert.assertTrue
import org.junit.Test

class YoloHttpJsonTest {
    @Test
    fun errorJsonEscapesQuotesAndNewlines() {
        val json = YoloHttpJson.error("bad \"model\"\n")

        assertTrue(json.contains("bad \\\"model\\\"\\n"))
    }

    @Test
    fun benchmarkJsonContainsAllTimingFields() {
        val result = YoloBenchmarkStats.summarize(
            YoloModel.N,
            5L,
            listOf(YoloTiming(1L, 2L, 3L)),
            0
        )
        val json = YoloHttpJson.benchmark(YoloBenchmarkResult(2, 1, listOf(result)))

        assertTrue(json.contains("loadModelMs"))
        assertTrue(json.contains("p50TotalMs"))
        assertTrue(json.contains("p95TotalMs"))
        assertTrue(json.contains("fps"))
    }
}
