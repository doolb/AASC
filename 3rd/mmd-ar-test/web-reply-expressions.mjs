// 通用语义映射只返回当前PMX真实索引，绝不套用米娅的固定编号。
const choices = {
    开心: [['にこり', '微笑眉', 'happy'], ['笑い', '笑眼', 'smile_eye'], ['口角上げ', '微笑', 'smile']],
    悲伤: [['困る', '悲伤', 'sad'], ['なごみ', 'sad_eye']],
    生气: [['怒り', '怒', 'angry']],
    惊讶: [['上', '驚き', '惊讶', 'surprised'], ['びっくり', '見開き']],
    害羞: [['照れ', '赤面', '害羞', 'blush'], ['にこり'], ['笑い']],
    眨眼: [['ウィンク', 'ウィンク２', 'ｳｨﾝｸ', 'wink']],
};
const key = name => String(name).trim().toLowerCase();
export function resolveReplyExpression(items, name) {
    if (name === '平静') return { weights: [], names: [], missing: false };
    const supported = items.filter(item => item.supported);
    const exact = supported.filter(item => item.name === name);
    if (exact.length > 1) return { weights: [], names: [], missing: true, reason: '表情重名，需要更换无歧义名称' };
    if (exact.length === 1) return { weights: [[exact[0].index, 1]], names: [exact[0].name], missing: false };
    const selected = [];
    for (const group of choices[name] || []) {
        for (const candidate of group) {
            const matching = supported.filter(item => key(item.name) === key(candidate) || (item.englishName && key(item.englishName) === key(candidate)));
            if (matching.length === 1) { selected.push(matching[0]); break; }
        }
    }
    const unique = [...new Map(selected.map(item => [item.index, item])).values()];
    return { weights: unique.map(item => [item.index, 1]), names: unique.map(item => item.name), missing: !unique.length,
        reason: !unique.length ? '当前PMX没有匹配的可用表情' : '' };
}
export function replyExpressionWeights(events, seconds) {
    const weights = new Map();
    // 后出现的情绪取代前一情绪，带短淡入淡出；手动调试和口型由控制器另行合成。
    let current;
    for (let index = events.length - 1; index >= 0; index--) {
        if (events[index].at <= seconds) { current = events[index]; break; }
    }
    if (!current || current.missing || seconds >= current.at + current.duration) return [];
    const ramp = Math.min(0.2, current.duration / 3);
    const amount = current.strength * Math.min(1, (seconds - current.at) / ramp, (current.at + current.duration - seconds) / ramp);
    for (const [index, weight] of current.weights) weights.set(index, Math.max(0, weight * amount));
    return [...weights];
}
