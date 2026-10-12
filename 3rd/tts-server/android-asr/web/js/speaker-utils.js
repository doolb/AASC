// Sherpa 测试网页多人流程的纯数据算法，与 APK 的分段合并/短未知段回查保持一致。
(function attachSpeakerUtils(global, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.AsrWebSpeakerUtils = api;
})(typeof globalThis === 'object' ? globalThis : this, function createSpeakerUtils() {
  const MAX_SHORT_UNKNOWN_SECONDS = 0.8;
  const MAX_MERGE_GAP_SECONDS = 0.5;

  function mergeDiarizedSegments(segments) {
    const ordered = [...segments].sort((left, right) => left.start - right.start);
    const merged = [];
    let previousSpeaker = null;
    for (const segment of ordered) {
      if (!(segment.end > segment.start)) {
        previousSpeaker = null;
        continue;
      }
      const previous = merged[merged.length - 1];
      if (previousSpeaker === segment.speaker && previous?.clusterId === segment.speaker) {
        previous.end = segment.end;
      } else {
        merged.push({ start: segment.start, end: segment.end, clusterId: segment.speaker });
      }
      previousSpeaker = segment.speaker;
    }
    return merged;
  }

  function findMerge(previous, current, next) {
    const previousSpeaker = previous?.match?.speaker || null;
    const nextSpeaker = next?.match?.speaker || null;
    const currentUnknown = !current.match?.speaker;

    if (currentUnknown) {
      if (current.end - current.start > MAX_SHORT_UNKNOWN_SECONDS) return null;
      if (previousSpeaker && nextSpeaker && previousSpeaker !== nextSpeaker) return null;
      if (previousSpeaker && canJoin(previous, current)) {
        if (nextSpeaker === previousSpeaker && canJoin(current, next)) {
          return {
            start: Math.min(previous.start, current.start),
            end: Math.max(current.end, next.end),
            clusterId: previous.clusterId,
            targetSpeaker: previousSpeaker,
            replacesPrevious: true,
            consumedCount: 2,
          };
        }
        return {
          start: Math.min(previous.start, current.start),
          end: Math.max(previous.end, current.end),
          clusterId: previous.clusterId,
          targetSpeaker: previousSpeaker,
          replacesPrevious: true,
          consumedCount: 1,
        };
      }
      if (nextSpeaker && canJoin(current, next)) {
        return {
          start: Math.min(current.start, next.start),
          end: Math.max(current.end, next.end),
          clusterId: next.clusterId,
          targetSpeaker: nextSpeaker,
          replacesPrevious: false,
          consumedCount: 2,
        };
      }
      return null;
    }

    if (previousSpeaker === current.match.speaker && canJoin(previous, current)) {
      return {
        start: Math.min(previous.start, current.start),
        end: Math.max(previous.end, current.end),
        clusterId: previous.clusterId,
        targetSpeaker: previousSpeaker,
        replacesPrevious: true,
        consumedCount: 1,
      };
    }
    return null;
  }

  function canJoin(left, right) {
    return Boolean(left && right) && right.start - left.end <= MAX_MERGE_GAP_SECONDS;
  }

  async function resolveMatchedSegments(segments, rematch) {
    const resolved = [];
    let index = 0;
    while (index < segments.length) {
      const current = segments[index];
      const previous = resolved[resolved.length - 1] || null;
      const next = segments[index + 1] || null;
      const merge = findMerge(previous, current, next);
      if (!merge) {
        resolved.push(current);
        index += 1;
        continue;
      }

      const rematched = await rematch(merge.start, merge.end, merge.clusterId);
      if (rematched.match?.speaker !== merge.targetSpeaker) {
        resolved.push(current);
        index += 1;
        continue;
      }
      const normalized = {
        ...rematched,
        start: merge.start,
        end: merge.end,
        clusterId: merge.clusterId,
      };
      if (merge.replacesPrevious) resolved[resolved.length - 1] = normalized;
      else resolved.push(normalized);
      index += merge.consumedCount;
    }
    return resolved;
  }

  function cosineSimilarity(left, right) {
    if (!left?.length || left.length !== right?.length) return null;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
      const leftValue = left[index];
      const rightValue = right[index];
      dot += leftValue * rightValue;
      leftNorm += leftValue * leftValue;
      rightNorm += rightValue * rightValue;
    }
    const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
    if (denominator <= 0) return null;
    const score = dot / denominator;
    return Number.isFinite(score) ? score : null;
  }

  return {
    MAX_SHORT_UNKNOWN_SECONDS,
    MAX_MERGE_GAP_SECONDS,
    mergeDiarizedSegments,
    resolveMatchedSegments,
    cosineSimilarity,
  };
});
