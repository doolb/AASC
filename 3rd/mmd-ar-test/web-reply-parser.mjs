// 回复标记只识别有限字典；普通括号、Markdown和代码不会被推断为动作。
export const EMOTIONS = Object.freeze({
    开心: ['开心', '高兴', '快乐', '微笑', '笑', 'happy', 'smile'],
    悲伤: ['悲伤', '难过', '伤心', '哭', 'sad'],
    生气: ['生气', '愤怒', 'angry'],
    惊讶: ['惊讶', '吃惊', 'surprised'],
    害羞: ['害羞', '脸红', 'shy'],
    眨眼: ['眨眼', 'wink'],
    平静: ['平静', '正常', '恢复', 'neutral'],
});
export const ACTIONS = Object.freeze({
    点头: ['点头', 'nod'], 摇头: ['摇头', 'shake'],
    挥手: ['挥手', '招手', 'wave'], 鞠躬: ['鞠躬', 'bow'],
    歪头: ['歪头', 'tilt'],
});
const symbols = new Map([
    ['😊', ['emotion', '开心']], ['😄', ['emotion', '开心']], ['😀', ['emotion', '开心']],
    ['😆', ['emotion', '开心']], ['🙂', ['emotion', '开心']], ['😢', ['emotion', '悲伤']],
    ['😭', ['emotion', '悲伤']], ['😞', ['emotion', '悲伤']], ['😠', ['emotion', '生气']],
    ['😡', ['emotion', '生气']], ['😲', ['emotion', '惊讶']], ['😮', ['emotion', '惊讶']],
    ['😳', ['emotion', '害羞']], ['☺', ['emotion', '害羞']], ['😉', ['emotion', '眨眼']],
    ['👋', ['action', '挥手']], ['🙇', ['action', '鞠躬']],
    ['(*^▽^*)', ['emotion', '开心']], ['(^_^)', ['emotion', '开心']],
    ['(｡･ω･｡)ﾉ', ['action', '挥手']], ['(T_T)', ['emotion', '悲伤']],
]);
// 常见回复Emoji采用同一语义白名单；装饰图标不推断动作。
for (const [name, icons] of Object.entries({
    开心: ['😃', '😁', '😂', '🤣', '😅', '🥰', '😍', '😌', '😇'],
    悲伤: ['🥺', '😔', '😥', '😿'], 生气: ['😤', '🤬'],
    惊讶: ['😯', '😱', '🤯', '😨'], 害羞: ['🤭', '🫣', '😚', '😘'],
})) for (const icon of icons) symbols.set(icon, ['emotion', name]);
const aliases = (groups, input) => Object.entries(groups).find(([, names]) => names.includes(input.toLowerCase()))?.[0];
function parameters(value) {
    const options = { duration: 2, strength: 0.7, count: 1 };
    let name = value.trim();
    if (name.startsWith('"')) {
        const match = name.match(/^"(?:[^"\\]|\\.)*"/u);
        if (!match) throw new Error('标记名称引号未闭合');
        options.name = JSON.parse(match[0]);
        name = name.slice(match[0].length);
    }
    const option = /(?:^|[\s,，]+)(时长|duration|强度|strength|次数|count)\s*=\s*([\d.]+)/gu;
    name = name.replace(option, (_, key, number) => {
        const field = ({ 时长: 'duration', duration: 'duration', 强度: 'strength', strength: 'strength', 次数: 'count', count: 'count' })[key];
        const value = Number(number);
        if (!Number.isFinite(value)) throw new Error('标记参数必须是有限数字');
        options[field] = value;
        return '';
    }).trim();
    if (options.name !== undefined && name) throw new Error('标记包含未知参数');
    options.name ??= name;
    if (!options.name || options.name.length > 100) throw new Error('标记名称为空或过长');
    if (options.duration < 0.2 || options.duration > 15 || options.strength < 0 || options.strength > 1
        || !Number.isInteger(options.count) || options.count < 1 || options.count > 8) throw new Error('标记参数范围：时长0.2–15秒，强度0–1，次数1–8');
    return options;
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const symbolPattern = [...symbols.keys()].sort((a, b) => b.length - a.length).map(escape).join('|');
const protectedPattern = /```([^\n]*)\r?\n([\s\S]*?)```|`[^`\n]+`|^>[^\n]*(?:\n|$)|\[MPL\]([\s\S]*?)\[\/MPL\]|\[(表情|动作)[:：]([^\]\n]+)\]|(?<!\*)\*(?!\*)([^*\n]{1,80})\*(?!\*)/u;
const pattern = new RegExp(protectedPattern.source + '|(?:' + symbolPattern
    + String.raw`)[\uFE0E\uFE0F\p{Emoji_Modifier}]*|[（(]([^（）()\n]{1,80})[）)]`, 'gimu');

export function parseReply(value) {
    const text = String(value || '');
    if (!text.trim() || new TextEncoder().encode(text).length > 65536) throw new Error('回复不能为空，最多64KiB');
    let speech = '', cursor = 0;
    const events = [], warnings = [];
    pattern.lastIndex = 0;
    const add = (kind, options, raw) => {
        events.push({ kind, ...options, offset: Array.from(speech).length, raw });
        if (events.length > 64) throw new Error('单次回复最多64个表情/动作标记');
    };
    for (const match of text.matchAll(pattern)) {
        speech += text.slice(cursor, match.index);
        cursor = match.index + match[0].length;
        const [raw, language, code, mpl, explicit, detail, starred, bracketed] = match;
        let handled = false;
        if ((language !== undefined && language.trim().toLowerCase() === 'mpl') || mpl !== undefined) {
            add('mpl', { source: code ?? mpl }, raw);
            handled = true;
        } else if (language !== undefined || raw.startsWith('`') || raw.startsWith('>')) {
            // 保护普通代码内容，其中的Emoji和标记不会被执行。
        } else if (explicit) {
            try {
                const opts = parameters(detail);
                const kind = explicit === '表情' ? 'emotion' : 'action';
                const canonical = aliases(kind === 'emotion' ? EMOTIONS : ACTIONS, opts.name);
                if (kind === 'action' && !canonical) warnings.push(`未支持高级动作：${opts.name}`);
                else add(kind, { ...opts, name: canonical || opts.name }, raw);
                handled = true;
            } catch (error) { warnings.push(error.message); handled = true; }
        } else {
            const symbol = symbols.get(raw.replace(/[\uFE0F\uFE0E\p{Emoji_Modifier}]/gu, ''));
            const name = starred || bracketed || '';
            const emotion = aliases(EMOTIONS, name), action = aliases(ACTIONS, name);
            if (symbol) { add(symbol[0], { name: symbol[1], duration: 2, strength: 0.7, count: 1 }, raw); handled = true; }
            else if (emotion || action) { add(emotion ? 'emotion' : 'action', { name: emotion || action, duration: 2, strength: 0.7, count: 1 }, raw); handled = true; }
        }
        if (!handled) speech += raw;
    }
    speech += text.slice(cursor);
    const leading = Array.from(speech.match(/^\s*/u)?.[0] || '').length;
    speech = speech.trim().replace(/^[\uFE0F\uFE0E\u200D]+|[\uFE0F\uFE0E\u200D]+$/gu, '');
    for (const event of events) event.offset = Math.max(0, event.offset - leading);
    if (events.filter(event => event.kind !== 'emotion').length > 16) throw new Error('单次回复最多16段身体动作');
    return { text, speech, events, warnings };
}
