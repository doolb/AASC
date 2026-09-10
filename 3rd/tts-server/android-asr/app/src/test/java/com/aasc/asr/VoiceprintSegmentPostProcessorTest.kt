package com.aasc.asr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceprintSegmentPostProcessorTest {
    @Test
    fun mergesShortUnknownTailWhenCombinedAudioMatchesPreviousSpeaker() {
        val segments = listOf(
            matched(0f, 2f, 1, "z", 0.92f),
            matched(2f, 2.56f, 2, null, 0.47f)
        )

        val resolved = VoiceprintSegmentPostProcessor.resolve(segments) { start, end, clusterId ->
            matched(start, end, clusterId, "z", 0.94f)
        }

        assertEquals(
            listOf(matched(0f, 2.56f, 1, "z", 0.94f)),
            resolved
        )
    }

    @Test
    fun keepsShortUnknownSegmentWhenCombinedAudioDoesNotMatchTargetSpeaker() {
        val segments = listOf(
            matched(0f, 2f, 1, "z", 0.92f),
            matched(2f, 2.56f, 2, null, 0.47f)
        )

        val resolved = VoiceprintSegmentPostProcessor.resolve(segments) { start, end, clusterId ->
            matched(start, end, clusterId, "other", 0.62f)
        }

        assertEquals(2, resolved.size)
        assertEquals("z", resolved[0].match.speaker)
        assertNull(resolved[1].match.speaker)
        assertEquals(2.56f, resolved[1].end, 0.00001f)
    }

    @Test
    fun doesNotMergeUnknownSegmentBetweenDifferentKnownSpeakers() {
        val segments = listOf(
            matched(0f, 1.5f, 1, "z", 0.91f),
            matched(1.5f, 2f, 2, null, 0.42f),
            matched(2f, 3.5f, 3, "y", 0.9f)
        )

        var rematchCount = 0
        val resolved = VoiceprintSegmentPostProcessor.resolve(segments) { start, end, clusterId ->
            rematchCount += 1
            matched(start, end, clusterId, "z", 0.95f)
        }

        assertEquals(3, resolved.size)
        assertEquals(0, rematchCount)
    }

    @Test
    fun mergesAdjacentSegmentsWhenTheyMatchTheSameRegisteredSpeaker() {
        val segments = listOf(
            matched(0f, 1.4f, 1, "z", 0.91f),
            matched(1.4f, 2.8f, 2, "z", 0.78f)
        )

        val resolved = VoiceprintSegmentPostProcessor.resolve(segments) { start, end, clusterId ->
            matched(start, end, clusterId, "z", 0.93f)
        }

        assertEquals(
            listOf(matched(0f, 2.8f, 1, "z", 0.93f)),
            resolved
        )
    }

    @Test
    fun mergesUnknownGapBetweenTwoSegmentsOfTheSameRegisteredSpeaker() {
        val segments = listOf(
            matched(0f, 1.2f, 1, "z", 0.91f),
            matched(1.2f, 1.5f, 2, null, 0.42f),
            matched(1.5f, 2.7f, 3, "z", 0.89f)
        )

        val resolved = VoiceprintSegmentPostProcessor.resolve(segments) { start, end, clusterId ->
            matched(start, end, clusterId, "z", 0.94f)
        }

        assertEquals(
            listOf(matched(0f, 2.7f, 1, "z", 0.94f)),
            resolved
        )
    }

    private fun matched(
        start: Float,
        end: Float,
        clusterId: Int,
        speaker: String?,
        score: Float
    ): VoiceprintSegmentPostProcessor.MatchedSegment =
        VoiceprintSegmentPostProcessor.MatchedSegment(
            start = start,
            end = end,
            clusterId = clusterId,
            match = VoiceprintMatchResult(speaker, score, 0.5f)
        )
}
