package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceprintSegmentMergerTest {
    @Test
    fun mergesAdjacentSegmentsWithSameCluster() {
        val merged = VoiceprintSegmentMerger.merge(
            listOf(
                VoiceprintSegmentMerger.DiarizedSegment(0f, 1f, 2),
                VoiceprintSegmentMerger.DiarizedSegment(1f, 2.5f, 2),
                VoiceprintSegmentMerger.DiarizedSegment(2.5f, 3f, 3)
            )
        )

        assertEquals(
            listOf(
                VoiceprintSegmentMerger.MergedSegment(0f, 2.5f, 2),
                VoiceprintSegmentMerger.MergedSegment(2.5f, 3f, 3)
            ),
            merged
        )
    }

    @Test
    fun skipsInvalidSegmentsAndKeepsUnknownBoundaries() {
        val merged = VoiceprintSegmentMerger.merge(
            listOf(
                VoiceprintSegmentMerger.DiarizedSegment(0f, 0f, 1),
                VoiceprintSegmentMerger.DiarizedSegment(1f, 2f, 1),
                VoiceprintSegmentMerger.DiarizedSegment(2f, 1f, 1),
                VoiceprintSegmentMerger.DiarizedSegment(2f, 3f, 1)
            )
        )

        assertEquals(
            listOf(
                VoiceprintSegmentMerger.MergedSegment(1f, 2f, 1),
                VoiceprintSegmentMerger.MergedSegment(2f, 3f, 1)
            ),
            merged
        )
    }
}
