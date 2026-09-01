package com.aasc.yolo

import org.junit.Assert.assertEquals
import org.junit.Test

class YoloBenchmarkTest {
    @Test
    fun summarizesAveragePercentilesAndFps() {
        val summary = YoloBenchmarkStats.summarize(
            model = YoloModel.N,
            loadModelMs = 120L,
            samples = listOf(
                YoloTiming(10L, 20L, 10L),
                YoloTiming(20L, 30L, 10L),
                YoloTiming(30L, 40L, 10L),
                YoloTiming(40L, 50L, 10L)
            ),
            detectionCount = 3
        )

        assertEquals(120L, summary.loadModelMs)
        assertEquals(25.0, summary.averagePreprocessMs, 0.001)
        assertEquals(35.0, summary.averageInferenceMs, 0.001)
        assertEquals(10.0, summary.averagePostprocessMs, 0.001)
        assertEquals(70.0, summary.averageTotalMs, 0.001)
        assertEquals(60.0, summary.p50TotalMs, 0.001)
        assertEquals(100.0, summary.p95TotalMs, 0.001)
        assertEquals(1000.0 / 70.0, summary.fps, 0.001)
        assertEquals(3, summary.detectionCount)
    }

    @Test(expected = IllegalArgumentException::class)
    fun zeroRunsAreRejected() {
        YoloBenchmark.validateParameters(warmup = 2, runs = 0)
    }
}
