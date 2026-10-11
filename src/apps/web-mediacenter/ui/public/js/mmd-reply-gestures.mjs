// Emoji、语义别名、按钮和骨骼模板共用此目录，新增动作不再维护多份分支。
const bone = (name, operation, value) => [name, operation, value];
const head = (operation, value) => bone('head', operation, value);
const both = (arm, elbow, wrist = 0) => ['l', 'r'].flatMap(side => [
    bone('arm_' + side, 'bend forward', arm), bone('elbow_' + side, 'bend forward', elbow),
    bone('wrist_' + side, 'bend forward', wrist)]);
const paws = (arm, elbow, wrist = 0) => [...both(arm, elbow, wrist),
    ...['l', 'r'].map(side => bone('arm_' + side, 'turn left', 60))];
const right = (arm, elbow, wrist = 0) => [bone('arm_r', 'bend backward', arm),
    bone('elbow_r', 'bend forward', elbow), bone('wrist_r', 'sway right', wrist)];
const entries = [
    ['点头', '🙂‍↕️', 'nod', '', [head('bend forward', 0)], [head('bend forward', 20)]],
    ['摇头', '🙂‍↔️', 'shake', '', [head('turn left', 20)], [head('turn right', 20)]],
    ['挥手', '👋', '招手,wave', '', [...right(65, 65), bone('wrist_r', 'sway left', 20)], right(65, 65, 20)],
    ['鞠躬', '🙇', 'bow', '', [bone('upper_body', 'bend forward', 0), head('bend forward', 0)], [bone('upper_body', 'bend forward', 25), head('bend forward', 10)]],
    ['歪头', '🤨', 'tilt', '', [head('sway right', 0)], [head('sway right', 16)]],
    ['开心', '😊', '高兴,快乐,微笑,笑,happy,smile', '开心', [head('sway right', 5)], [head('sway left', 5)]],
    ['悲伤', '😢', '难过,伤心,哭,sad', '悲伤', [head('bend forward', 8)], [head('bend forward', 14)]],
    ['生气', '😠', '愤怒,angry', '生气', [head('turn left', 6)], [head('turn right', 6)]],
    ['惊讶', '😲', '吃惊,surprised', '惊讶', [head('bend backward', 5)], [head('bend backward', 10)]],
    ['害羞', '😳', '脸红,shy', '害羞', [head('bend forward', 8)], [head('sway right', 8), head('bend forward', 8)]],
    ['眨眼', '😉', 'wink', '眨眼', [head('sway right', 5)], [head('sway right', 0)]],
    ['平静', '😐', '正常,恢复,neutral', '平静', [head('bend forward', 0)], [head('bend forward', 0)]],
    ['比心', '🫶', '爱心,heart,love', '害羞', paws(45, 125, -15), paws(42, 125, -10)],
    ['亲亲', '😘', '飞吻,亲吻,kiss', '害羞', [...right(10, 95, 10), head('sway right', 5)], right(15, 65, 15)],
    ['猫爪', '🐾', '爪爪,paw', '开心', paws(35, 120, 15), paws(32, 115, -10)],
    ['猫咪撒娇', '🐱', '猫咪,猫,撒娇,喵,cat', '害羞', [head('sway right', 12), ...paws(35, 115, 10)], [head('sway left', 12), ...paws(35, 120, -5)]],
    ['拥抱', '🤗', '抱抱,抱,hug', '开心', both(0, 40), both(10, 75)],
    ['思考', '🤔', '想想,疑惑,think', '', [head('sway right', 12), ...right(5, 100)], [head('sway right', 8), ...right(5, 95)]],
    ['嘘', '🤫', '安静,shush', '', [head('bend forward', 5), ...right(5, 100)], [head('bend forward', 0), ...right(5, 100)]],
    ['晚安', '😴', '睡觉,困,打哈欠,sleep', '闭眼', [head('bend forward', 12), head('sway right', 8)], [head('bend forward', 16), head('sway right', 12)]],
    ['庆祝', '🎉', '欢呼,胜利,celebrate', '开心', both(-40, 55), both(-55, 65)],
    ['闪亮', '✨', '闪耀,星星,sparkle', '开心', [head('sway right', 8), ...right(35, 50, 15)], [head('sway left', 8), ...right(40, 55, -15)]],
    ['赞同', '👍', '赞,同意,点赞,赞成,approve', '开心', [head('bend forward', 5), ...right(15, 80)], [head('bend forward', 12), ...right(15, 85)]],
    ['加油', '💪', '鼓励,打气,cheer', '开心', right(35, 90), right(45, 100)],
    ['合十', '🙏', '祈祷,谢谢,感谢,pray', '', [...both(10, 95), head('bend forward', 8)], [...both(10, 95), head('bend forward', 15)]],
    ['敬礼', '🫡', 'salute', '', right(40, 100), right(45, 95)],
    ['摊手', '🤷', '耸肩,无奈,shrug', '', [head('sway right', 8), ...both(5, 70, -15)], [head('sway left', 8), ...both(0, 80, -20)]],
    ['拒绝', '🙅', '不要,不行,拒绝手势,no', '', [head('turn left', 12), ...both(15, 80)], [head('turn right', 12), ...both(20, 90)]],
];
const emotionNames = new Set(['开心', '悲伤', '生气', '惊讶', '害羞', '眨眼', '平静']);
export const ADVANCED_GESTURES = Object.freeze(entries.map(([name, icon, aliases, expression, first, second]) => Object.freeze({
    name, icon, aliases: Object.freeze([name, ...aliases.split(',').filter(Boolean)]), expression,
    kind: emotionNames.has(name) ? 'emotion' : 'action',
    first: Object.freeze(first.map(Object.freeze)), second: Object.freeze(second.map(Object.freeze))
})));
export const GESTURES = new Map(ADVANCED_GESTURES.map(entry => [entry.name, entry]));
export const EMOTIONS = Object.freeze(Object.fromEntries(ADVANCED_GESTURES.filter(entry => entry.kind === 'emotion').map(entry => [entry.name, entry.aliases])));
export const ACTIONS = Object.freeze(Object.fromEntries(ADVANCED_GESTURES.map(entry => [entry.name, entry.aliases])));
export const normalizeReplySymbol = value => value.replace(/[\uFE0E\uFE0F\p{Emoji_Modifier}]/gu, '').replace(/\u200D[♀♂]$/u, '');
const symbols = new Map();
function add(name, icons) {
    const entry = GESTURES.get(name);
    for (const icon of icons) symbols.set(normalizeReplySymbol(icon), [entry.kind, name]);
}
for (const entry of ADVANCED_GESTURES) add(entry.name, [entry.icon]);
for (const [name, icons] of Object.entries({
    开心: ['😄', '😀', '😆', '🙂', '😃', '😁', '😂', '🤣', '😅', '🥰', '😍', '😌', '😇', '😺', '😸', '😹', '(*^▽^*)', '(^_^)'],
    悲伤: ['😭', '😞', '🥺', '😔', '😥', '😿', '😓', '😟', '😖', '😣', '🙁', '☹', '💔', '(T_T)'],
    生气: ['😡', '😤', '🤬', '😾', '😒'], 惊讶: ['😮', '😯', '😱', '🤯', '😨', '😧', '🙀'],
    害羞: ['☺', '🤭', '🫣', '🥹'], 眨眼: ['😜', '😝', '😛'], 平静: ['😑', '😶'],
    比心: ['❤', '♥', '♡', '💕', '💖', '💓', '💜', '💛', '💙', '💚', '🧡', '🖤', '🤍', '🤎', '🩷', '🩵', '🩶', '💗', '💝', '💞', '💘', '💟'],
    亲亲: ['😚', '😙', '😗', '😽', '💋'], 猫咪撒娇: ['🐈', '🐈‍⬛', '😻', '😼', '🦊', '(=^･ω･^=)', '(=^ω^=)', '(=^_^=)'],
    挥手: ['(｡･ω･｡)ﾉ', '🙋', '🖐', '✋'], 拥抱: ['🫂'], 思考: ['🧐', '😕', '💡'],
    晚安: ['🌙', '💤', '🥱'], 庆祝: ['🥳', '🎊', '🙌', '✌', '👏'], 闪亮: ['🌟', '💫', '⭐', '🌸'],
    赞同: ['👌', '✅', '☑'], 加油: ['👊', '✊', '🤞'], 合十: ['🤲'], 摊手: ['🙄'], 拒绝: ['👎', '🚫'],
})) add(name, icons);
export const REPLY_SYMBOLS = symbols;
