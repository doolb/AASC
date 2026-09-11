package com.aasc.display

// 声纹分段后处理器：用注册声纹结果修正过短、未知或被错误切开的相邻分段。
object VoiceprintSegmentPostProcessor {
    // 半秒左右的短语音通常不足以稳定提取声纹，允许与相邻片段合并后重试。
    const val MAX_SHORT_UNKNOWN_SECONDS = 0.8f

    // 仅允许相邻或存在很短间隔的片段合并，避免跨越长静音吞并真实换人。
    private const val MAX_MERGE_GAP_SECONDS = 0.5f

    data class MatchedSegment(
        val start: Float,
        val end: Float,
        val clusterId: Int,
        val match: VoiceprintMatchResult,
        val error: String? = null
    ) {
        val duration: Float
            get() = end - start

        val isUnknown: Boolean
            get() = match.speaker.isNullOrBlank()
    }

    /**
     * 按注册说话人合并分段，并在每次候选合并后重新执行声纹匹配。
     *
     * 只有重新匹配仍然得到目标说话人时才接受合并，避免把不同说话人的短片段
     * 仅凭时间相邻关系强行归入同一个人。回调由 NativeBridge 提供，用于执行真实
     * embedding 提取，并在合并成功时返回新的相似度分数。
     */
    fun resolve(
        segments: List<MatchedSegment>,
        maxShortUnknownSeconds: Float = MAX_SHORT_UNKNOWN_SECONDS,
        rematch: (start: Float, end: Float, clusterId: Int) -> MatchedSegment
    ): List<MatchedSegment> {
        val resolved = mutableListOf<MatchedSegment>()
        var index = 0
        while (index < segments.size) {
            val current = segments[index]
            val previous = resolved.lastOrNull()
            val next = segments.getOrNull(index + 1)
            val merge = findMerge(previous, current, next, maxShortUnknownSeconds)
            if (merge != null) {
                val rematched = rematch(merge.start, merge.end, merge.clusterId)
                if (rematched.match.speaker == merge.targetSpeaker) {
                    val normalized = rematched.copy(
                        start = merge.start,
                        end = merge.end,
                        clusterId = merge.clusterId
                    )
                    if (merge.replacesPrevious) {
                        resolved[resolved.lastIndex] = normalized
                    } else {
                        resolved += normalized
                    }
                    index += merge.consumedCount
                    continue
                }
            }

            resolved += current
            index += 1
        }
        return resolved
    }

    private data class MergePlan(
        val start: Float,
        val end: Float,
        val clusterId: Int,
        val targetSpeaker: String,
        val replacesPrevious: Boolean,
        val consumedCount: Int
    )

    private fun findMerge(
        previous: MatchedSegment?,
        current: MatchedSegment,
        next: MatchedSegment?,
        maxShortUnknownSeconds: Float
    ): MergePlan? {
        val previousSpeaker = previous?.match?.speaker?.takeIf { it.isNotBlank() }
        val nextSpeaker = next?.match?.speaker?.takeIf { it.isNotBlank() }
        if (current.isUnknown) {
            if (current.duration > maxShortUnknownSeconds) return null
            if (previousSpeaker != null && nextSpeaker != null && previousSpeaker != nextSpeaker) return null
            if (previousSpeaker != null && canJoin(previous, current)) {
                if (nextSpeaker == previousSpeaker && canJoin(current, next)) {
                    return MergePlan(
                        start = minOf(previous.start, current.start),
                        end = maxOf(current.end, next.end),
                        clusterId = previous.clusterId,
                        targetSpeaker = previousSpeaker,
                        replacesPrevious = true,
                        consumedCount = 2
                    )
                }
                return MergePlan(
                    start = minOf(previous.start, current.start),
                    end = maxOf(previous.end, current.end),
                    clusterId = previous.clusterId,
                    targetSpeaker = previousSpeaker,
                    replacesPrevious = true,
                    consumedCount = 1
                )
            }
            if (nextSpeaker != null && canJoin(current, next)) {
                return MergePlan(
                    start = minOf(current.start, next.start),
                    end = maxOf(current.end, next.end),
                    clusterId = next.clusterId,
                    targetSpeaker = nextSpeaker,
                    replacesPrevious = false,
                    consumedCount = 2
                )
            }
            return null
        }

        val currentSpeaker = current.match.speaker?.takeIf { it.isNotBlank() }
        if (currentSpeaker != null && previousSpeaker == currentSpeaker && canJoin(previous, current)) {
            return MergePlan(
                start = minOf(previous.start, current.start),
                end = maxOf(previous.end, current.end),
                clusterId = previous.clusterId,
                targetSpeaker = previousSpeaker,
                replacesPrevious = true,
                consumedCount = 1
            )
        }
        return null
    }

    private fun canJoin(left: MatchedSegment, right: MatchedSegment): Boolean =
        right.start - left.end <= MAX_MERGE_GAP_SECONDS
}
