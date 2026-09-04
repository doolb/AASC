import { satisfiesOcr } from './action-selector.js';
const isMatched = (match) => match.matched && match.rect !== null;
const stateScore = (matches) => (matches.reduce((score, match) => Math.min(score, match.score), 1));
const stateMatches = (state, matches, ocrResult) => state.markers.every((template, index) => (isMatched(matches[index] ?? unmatched('template'))
    && satisfiesOcr(template.descriptor, ocrResult)));
const unmatched = (method) => ({
    score: 0,
    rect: null,
    matched: false,
    method,
});
/** 在所有 State 中寻找当前截图对应的状态；一个 State 的标记必须全部命中。 */
export const locateState = async (frame, states, options, ocrResult) => {
    const matches = [];
    for (const state of states) {
        const stateMatchesResult = await options.matcher.matchAll(frame, state.markers, options.method);
        if (stateMatches(state, stateMatchesResult, ocrResult)) {
            matches.push({ state, score: stateScore(stateMatchesResult) });
        }
    }
    if (matches.length === 0) {
        return { state: null, score: 0, reason: 'no-state' };
    }
    matches.sort((left, right) => right.score - left.score || left.state.id.localeCompare(right.state.id));
    const best = matches[0];
    const second = matches[1];
    const margin = options.ambiguityMargin ?? 0.03;
    if (second && best.score - second.score < margin) {
        return { state: null, score: best.score, reason: 'ambiguous' };
    }
    return { state: best.state, score: best.score, reason: 'matched' };
};
/** 只从已经确认的 State 的 match 目录中选择未完成子目标。 */
export const selectStateMatch = (state, matches, completedSubgoals, ocrResult) => {
    const candidates = state.matchTemplates
        .map((template, index) => ({
        descriptor: template.descriptor,
        match: matches[index] ?? unmatched('template'),
    }))
        .filter((candidate) => (candidate.descriptor.matchId !== undefined
        && candidate.descriptor.gotoFlow !== undefined
        && candidate.descriptor.queue >= 0
        && isMatched(candidate.match)
        && !completedSubgoals.has(candidate.descriptor.matchId)
        && satisfiesOcr(candidate.descriptor, ocrResult)));
    const ranked = candidates.sort((left, right) => (right.descriptor.queue - left.descriptor.queue
        || right.match.score - left.match.score
        || left.descriptor.name.localeCompare(right.descriptor.name)));
    return ranked[0] ?? null;
};
